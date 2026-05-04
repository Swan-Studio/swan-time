import { getToken } from './oauth';

const ENDPOINT = 'https://api.monday.com/v2';

export const COLS = {
  client: 'connect_boards_mkkz26ew',
  person: 'person',
  date: 'date4',
  timeTracking: 'time_tracking_mkkz3eas',
  division: 'label_mkkz4cvz',
  category: 'label_mkkznzsa'
} as const;

export const CLIENTS_BOARD_ID = 1909942413;

export const DIVISIONS = [
  'Social Media Management',
  'Content Delivery',
  'Ads Management',
  'Production'
] as const;

export const CATEGORIES = [
  'Client Meeting',
  'Internal Meeting',
  'Research',
  'Scripting',
  'Editing',
  'Scheduling and Captioning',
  'Shooting',
  'Research Deck Preparation',
  'Ideating Concepts',
  'Creator Recruitment',
  'Editor & Creator Briefing',
  'Data Analysis',
  'Audit',
  'Health Check',
  'Ad Copy',
  'Campaign Upload',
  'Monthly Reporting',
  'Client Comms',
  'Reviewing',
  'Other'
] as const;

async function gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated with Monday.com');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
      'API-Version': '2024-10'
    },
    body: JSON.stringify({ query, variables })
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e: any) => e.message).join('; '));
  return json.data;
}

export async function whoAmI() {
  const data = await gql<{ me: { id: string; name: string; email: string } }>(
    `query { me { id name email } }`
  );
  return data.me;
}

export async function findUserBoard(firstName: string): Promise<{ id: number; name: string } | null> {
  const data = await gql<{ boards: Array<{ id: string; name: string }> }>(
    `query ($limit: Int) { boards(limit: $limit) { id name } }`,
    { limit: 500 }
  );
  const re = new RegExp(`^${firstName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?:'s)?\\s+time\\s+tracker$`, 'i');
  const match = data.boards.find(b => re.test(b.name));
  return match ? { id: Number(match.id), name: match.name } : null;
}

// Lists all boards the user can access. Used for the manual picker fallback
// when the firstName regex doesn't auto-match. Filters to boards with
// "time tracker" in the name to keep the list manageable.
export async function listTimeTrackerBoards(): Promise<Array<{ id: number; name: string }>> {
  const data = await gql<{ boards: Array<{ id: string; name: string }> }>(
    `query ($limit: Int) { boards(limit: $limit) { id name } }`,
    { limit: 500 }
  );
  return data.boards
    .filter(b => /time\s+tracker/i.test(b.name))
    .map(b => ({ id: Number(b.id), name: b.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listClients(): Promise<Array<{ id: number; name: string }>> {
  const data = await gql<{ boards: Array<{ items_page: { items: Array<{ id: string; name: string }> } }> }>(
    `query ($ids: [ID!]) {
      boards(ids: $ids) {
        items_page(limit: 200) { items { id name } }
      }
    }`,
    { ids: [String(CLIENTS_BOARD_ID)] }
  );
  const items = data.boards[0]?.items_page.items ?? [];
  return items
    .map(i => ({ id: Number(i.id), name: i.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

type LogParams = {
  boardId: number;
  userId: number;
  name: string;
  clientId?: number;
  division: string;
  category: string;
  startedAt: number;
  endedAt: number;
};

export async function logEntry(p: LogParams) {
  const minutes = Math.max(1, Math.ceil((p.endedAt - p.startedAt) / 60_000));
  const startedSec = Math.floor(p.startedAt / 1000);
  const endedSec = startedSec + minutes * 60;
  const isoDate = new Date(p.startedAt).toISOString().slice(0, 10);

  // Step 1: create the item WITHOUT the time_tracking column.
  // Monday rejects time_tracking in column_values with "This column type is not
  // supported yet in the API" on create_item — verified live. We encode duration
  // in the item name as "(Xm)" so the entry is always self-describing, then
  // attempt a best-effort follow-up write.
  const namedWithDuration = `${p.name} (${minutes}m)`;

  const columnValues: Record<string, unknown> = {
    [COLS.person]: { personsAndTeams: [{ id: p.userId, kind: 'person' }] },
    [COLS.date]: { date: isoDate },
    [COLS.division]: { label: p.division },
    [COLS.category]: { label: p.category }
  };
  if (p.clientId) {
    columnValues[COLS.client] = { item_ids: [p.clientId] };
  }

  const data = await gql<{ create_item: { id: string } }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv, create_labels_if_missing: false) {
        id
      }
    }`,
    { boardId: String(p.boardId), name: namedWithDuration, cv: JSON.stringify(columnValues) }
  );
  const itemId = Number(data.create_item.id);

  // Step 2: best-effort time_tracking write. Try the documented additional_value
  // format via change_column_value. If Monday still refuses (column type
  // unsupported on update too), swallow — the duration lives in the name.
  try {
    await gql(
      `mutation ($boardId: ID!, $itemId: ID!, $colId: String!, $val: JSON!) {
        change_column_value(board_id: $boardId, item_id: $itemId, column_id: $colId, value: $val) { id }
      }`,
      {
        boardId: String(p.boardId),
        itemId: String(itemId),
        colId: COLS.timeTracking,
        val: JSON.stringify({
          additional_value: [
            {
              startDate: startedSec,
              endDate: endedSec,
              status: 'active',
              manuallyEntered: true,
              started_user_id: p.userId,
              ended_user_id: p.userId
            }
          ]
        })
      }
    );
  } catch (err) {
    console.warn('time_tracking write skipped:', (err as Error).message);
  }

  return { id: itemId, minutes };
}

export type TodayEntry = {
  id: number;
  name: string;
  clientName?: string;
  division?: string;
  category?: string;
  minutes: number;
  date?: string;
};

export async function todayEntries(boardId: number): Promise<TodayEntry[]> {
  const today = new Date().toISOString().slice(0, 10);
  const data = await gql<{
    boards: Array<{
      items_page: {
        items: Array<{
          id: string;
          name: string;
          column_values: Array<{ id: string; text: string; value: string | null }>;
        }>;
      };
    }>;
  }>(
    `query ($boardId: ID!, $rules: [ItemsQueryRule!]) {
      boards(ids: [$boardId]) {
        items_page(limit: 100, query_params: { rules: $rules }) {
          items {
            id name
            column_values { id text value }
          }
        }
      }
    }`,
    {
      boardId: String(boardId),
      rules: [{ column_id: COLS.date, compare_value: [today], operator: 'any_of' }]
    }
  );
  const items = data.boards[0]?.items_page.items ?? [];
  return items.map(i => {
    const get = (id: string) => i.column_values.find(c => c.id === id);
    const trackingRaw = get(COLS.timeTracking)?.value;
    let minutes = 0;
    if (trackingRaw) {
      try {
        const parsed = JSON.parse(trackingRaw);
        const total = (parsed.additional_value || []).reduce(
          (acc: number, seg: { startDate?: number; endDate?: number }) =>
            acc + Math.max(0, (seg.endDate ?? 0) - (seg.startDate ?? 0)),
          0
        );
        minutes = Math.round(total / 60);
      } catch {}
    }
    // Fallback: extract trailing "(Xm)" / "(X.Xh)" from name when time_tracking is empty.
    let displayName = i.name;
    if (minutes === 0) {
      const m = i.name.match(/\s\((\d+)m\)\s*$/);
      if (m) {
        minutes = Number(m[1]);
        displayName = i.name.slice(0, m.index).trimEnd();
      }
    } else {
      // Strip the duration suffix from display when we have real time tracking data.
      displayName = i.name.replace(/\s\(\d+m\)\s*$/, '');
    }
    return {
      id: Number(i.id),
      name: displayName,
      clientName: get(COLS.client)?.text || undefined,
      division: get(COLS.division)?.text || undefined,
      category: get(COLS.category)?.text || undefined,
      minutes
    };
  });
}

export async function deleteEntry(itemId: number) {
  await gql(`mutation ($id: ID!) { delete_item(item_id: $id) { id } }`, { id: String(itemId) });
}

// Returns the most recent entry date on the user's board, or null if none.
// Used for "last logged" / "missed days" indicators.
export async function recentEntries(
  boardId: number,
  daysBack = 14
): Promise<TodayEntry[]> {
  const data = await gql<{
    boards: Array<{
      items_page: {
        items: Array<{
          id: string;
          name: string;
          column_values: Array<{ id: string; text: string; value: string | null }>;
        }>;
      };
    }>;
  }>(
    `query ($boardId: ID!) {
      boards(ids: [$boardId]) {
        items_page(limit: 100) {
          items {
            id name
            column_values { id text value }
          }
        }
      }
    }`,
    { boardId: String(boardId) }
  );
  const items = data.boards[0]?.items_page.items ?? [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  cutoff.setHours(0, 0, 0, 0);

  const results: TodayEntry[] = [];
  for (const i of items) {
    const get = (id: string) => i.column_values.find(c => c.id === id);
    const dateText = get(COLS.date)?.text;
    if (!dateText || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) continue;
    const d = new Date(`${dateText}T00:00:00`);
    if (d < cutoff) continue;

    const trackingRaw = get(COLS.timeTracking)?.value;
    let minutes = 0;
    if (trackingRaw) {
      try {
        const parsed = JSON.parse(trackingRaw);
        const total = (parsed.additional_value || []).reduce(
          (acc: number, seg: { startDate?: number; endDate?: number }) =>
            acc + Math.max(0, (seg.endDate ?? 0) - (seg.startDate ?? 0)),
          0
        );
        minutes = Math.round(total / 60);
      } catch {}
    }
    let displayName = i.name;
    if (minutes === 0) {
      const m = i.name.match(/\s\((\d+)m\)\s*$/);
      if (m) {
        minutes = Number(m[1]);
        displayName = i.name.slice(0, m.index).trimEnd();
      }
    } else {
      displayName = i.name.replace(/\s\(\d+m\)\s*$/, '');
    }

    results.push({
      id: Number(i.id),
      name: displayName,
      clientName: get(COLS.client)?.text || undefined,
      division: get(COLS.division)?.text || undefined,
      category: get(COLS.category)?.text || undefined,
      minutes,
      date: dateText
    });
  }
  return results.sort((a, b) => (b.date! > a.date! ? 1 : -1));
}

export type LastLogStatus = {
  lastDate: string | null;
  daysSince: number | null;
};

export async function lastLogStatus(boardId: number): Promise<LastLogStatus> {
  const recent = await recentEntries(boardId, 30);
  if (recent.length === 0) return { lastDate: null, daysSince: null };
  const lastDate = recent[0].date!;
  const last = new Date(`${lastDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysSince = Math.round((today.getTime() - last.getTime()) / 86_400_000);
  return { lastDate, daysSince };
}
