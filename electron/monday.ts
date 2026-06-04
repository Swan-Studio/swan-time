import { getToken } from './oauth';
import { store } from './store';

const ENDPOINT = 'https://api.monday.com/v2';

// Column IDs are board-specific in Monday — every duplicated board gets fresh
// IDs. So we discover them at runtime per user board, keyed off type (and for
// the two label/status columns, the label-set contents) rather than hardcoding
// one user's IDs. See discoverBoardColumns below.
type ColumnMap = {
  client: string | null;
  creative: string | null;
  person: string | null;
  date: string | null;
  timeTracking: string | null;
  division: string | null;
  category: string | null;
};

const colsCache = new Map<number, ColumnMap>();

export function clearColumnCache(boardId?: number) {
  if (boardId) colsCache.delete(boardId);
  else colsCache.clear();
}

export const CLIENTS_BOARD_ID = 1909942413;
export const CREATIVES_BOARD_ID = 1909945576;

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
  'Revising Edit',
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

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Exponential backoff with jitter: ~0.5s, 1s, 2s (capped 8s), spread ±25% so a
// burst of failing requests doesn't retry in lockstep.
function backoffMs(attempt: number): number {
  const base = Math.min(8_000, 500 * 2 ** attempt);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

// Single GraphQL call against Monday with a hard timeout, status-aware errors,
// and retry-with-backoff for transient failures.
//
// Retry safety: rate-limit rejections (HTTP 429 and Monday's 200+complexity
// errors) are ALWAYS safe to retry — the request was throttled before it ran.
// Ambiguous failures (network drop, timeout, 5xx, non-JSON gateway page) might
// mean the server already applied the change, so we only retry those for
// queries, never mutations — retrying a create_item there would double-post.
async function gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error('Not authenticated with Monday.com');

  const isMutation = query.trimStart().startsWith('mutation');

  let lastErr: Error = new Error('Monday.com request failed.');
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const isLast = attempt === MAX_RETRIES;
    // An ambiguous failure may have already mutated server state — only retry
    // when this is a read.
    const canRetryAmbiguous = !isLast && !isMutation;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token,
          'API-Version': '2024-10'
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timer);
      const e = err as Error;
      lastErr = e.name === 'AbortError'
        ? new Error('Monday.com request timed out. Check your connection and try again.')
        : new Error(`Network error reaching Monday.com: ${e.message}`);
      if (!canRetryAmbiguous) throw lastErr;
      await sleep(backoffMs(attempt));
      continue;
    } finally {
      clearTimeout(timer);
    }

    // 429 = throttled before execution → always safe to retry (honor Retry-After).
    if (res.status === 429) {
      lastErr = new Error('Monday.com rate limit hit (HTTP 429).');
      if (isLast) throw new Error('Monday.com rate limit hit. Please try again shortly.');
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoffMs(attempt));
      continue;
    }

    // 5xx = ambiguous (server may have applied the write) → reads only.
    if (res.status >= 500) {
      lastErr = new Error(`Monday.com returned HTTP ${res.status}. Please try again shortly.`);
      if (!canRetryAmbiguous) throw lastErr;
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoffMs(attempt));
      continue;
    }

    if (!res.ok) throw new Error(`Monday.com returned HTTP ${res.status}.`);

    let json: any;
    try {
      json = await res.json();
    } catch {
      // Usually a transient gateway HTML page rather than JSON — ambiguous.
      lastErr = new Error('Monday.com returned an unexpected (non-JSON) response.');
      if (!canRetryAmbiguous) throw lastErr;
      await sleep(backoffMs(attempt));
      continue;
    }

    if (json.errors) {
      const msg = json.errors.map((e: any) => e.message).join('; ');
      // Monday signals rate/complexity limits as HTTP 200 with an errors array.
      // The request was rejected, not applied, so this is safe to retry even for
      // mutations.
      if (/complexity|rate.?limit|throttl|too many|budget/i.test(msg) && !isLast) {
        lastErr = new Error(msg);
        await sleep(backoffMs(attempt) * 2);
        continue;
      }
      throw new Error(msg);
    }
    return json.data;
  }
  throw lastErr;
}

function parseStatusLabels(settingsStr: string | null | undefined): Set<string> {
  if (!settingsStr) return new Set();
  try {
    const settings = JSON.parse(settingsStr);
    const labels = settings?.labels;
    if (!labels) return new Set();
    // Monday returns labels as either { "0": "Active" } or { "0": { name: "Active" } }.
    return new Set(
      Object.values(labels)
        .map((v: any) => (typeof v === 'string' ? v : v?.name))
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
    );
  } catch {
    return new Set();
  }
}

async function discoverBoardColumns(boardId: number): Promise<ColumnMap> {
  const data = await gql<{
    boards: Array<{
      columns: Array<{ id: string; title: string; type: string; settings_str: string | null }> | null;
    }>;
  }>(
    `query ($ids: [ID!]) {
      boards(ids: $ids) {
        columns { id title type settings_str }
      }
    }`,
    { ids: [String(boardId)] }
  );
  const columns = data.boards?.[0]?.columns ?? [];

  const byType = (type: string) => columns.filter(c => c.type === type);
  const singleId = (type: string) => byType(type)[0]?.id ?? null;

  // A board can now carry two board_relation columns — one connecting to the
  // Clients board, one to the Creatives board. Disambiguate by parsing each
  // column's settings for the board it links to, rather than taking the first.
  const relationBoardIds = (settingsStr: string | null | undefined): number[] => {
    if (!settingsStr) return [];
    try {
      const ids = JSON.parse(settingsStr)?.boardIds;
      return Array.isArray(ids) ? ids.map(Number) : [];
    } catch {
      return [];
    }
  };
  const relations = byType('board_relation');
  const creative = relations.find(c => relationBoardIds(c.settings_str).includes(CREATIVES_BOARD_ID))?.id ?? null;
  const client =
    relations.find(c => relationBoardIds(c.settings_str).includes(CLIENTS_BOARD_ID))?.id ??
    // Legacy fallback: a single relation column with unparseable settings is
    // the client column (pre-creatives behaviour).
    relations.find(c => c.id !== creative)?.id ??
    null;

  // For the two status/label columns, classify by which canonical label set
  // each column's settings contain. Falls back to title match if the labels
  // don't line up (e.g. board still empty or renamed).
  const statuses = [...byType('status'), ...byType('color')]; // some legacy boards report 'color'
  let division: string | null = null;
  let category: string | null = null;
  let divisionScore = 0;
  let categoryScore = 0;
  for (const s of statuses) {
    const labels = parseStatusLabels(s.settings_str);
    const dScore = DIVISIONS.reduce((n, d) => n + (labels.has(d) ? 1 : 0), 0);
    const cScore = CATEGORIES.reduce((n, c) => n + (labels.has(c) ? 1 : 0), 0);
    if (dScore > cScore && dScore > divisionScore) {
      division = s.id;
      divisionScore = dScore;
    } else if (cScore > dScore && cScore > categoryScore) {
      category = s.id;
      categoryScore = cScore;
    }
  }
  if (!division) division = statuses.find(s => /division/i.test(s.title))?.id ?? null;
  if (!category) category = statuses.find(s => /category/i.test(s.title))?.id ?? null;

  return {
    client,
    creative,
    person: singleId('people') ?? singleId('person'), // 'person' is the legacy type
    date: singleId('date'),
    timeTracking: singleId('time_tracking'),
    division,
    category
  };
}

export async function getBoardCols(boardId: number): Promise<ColumnMap> {
  const cached = colsCache.get(boardId);
  if (cached) return cached;
  const cols = await discoverBoardColumns(boardId);
  colsCache.set(boardId, cols);
  return cols;
}

function missingColsMessage(cols: ColumnMap): string | null {
  const missing: string[] = [];
  if (!cols.person) missing.push('Person');
  if (!cols.date) missing.push('Date');
  if (!cols.division) missing.push('Division (status column)');
  if (!cols.category) missing.push('Category (status column)');
  if (missing.length === 0) return null;
  return `Your board is missing required columns: ${missing.join(', ')}. Ask an admin to add them.`;
}

export async function whoAmI() {
  const data = await gql<{
    me: { id: string; name: string; email: string | null };
  }>(`query { me { id name email } }`);
  return data.me;
}

// Account slug — only needed as a fallback when constructing a board URL.
// Querying `account` may require a scope the OAuth token wasn't granted, so
// this is best-effort and never throws.
export async function getAccountSlug(): Promise<string | null> {
  try {
    const data = await gql<{ account: { slug: string | null } }>(
      `query { account { slug } }`
    );
    return data.account?.slug ?? null;
  } catch {
    return null;
  }
}

async function listAccessibleBoards(): Promise<Array<{ id: string; name: string }>> {
  // Try `me.boards` first — OAuth-issued tokens return more reliable results
  // here than the top-level `boards` query, which sometimes filters down to
  // empty for non-developer users despite valid `boards:read` scope.
  try {
    const data = await gql<{ me: { boards: Array<{ id: string; name: string }> } }>(
      `query ($limit: Int) { me { boards(limit: $limit) { id name } } }`,
      { limit: 500 }
    );
    if (data.me?.boards?.length) {
      console.log(`[monday] me.boards returned ${data.me.boards.length} boards`);
      return data.me.boards;
    }
    console.log('[monday] me.boards returned 0; falling back to top-level boards query');
  } catch (e) {
    console.warn('[monday] me.boards query failed:', (e as Error).message);
  }
  const data = await gql<{ boards: Array<{ id: string; name: string }> }>(
    `query ($limit: Int) { boards(limit: $limit) { id name } }`,
    { limit: 500 }
  );
  console.log(`[monday] boards (top-level) returned ${data.boards?.length ?? 0} boards`);
  return data.boards ?? [];
}

export async function findUserBoard(firstName: string): Promise<{ id: number; name: string } | null> {
  const boards = await listAccessibleBoards();
  // Matches the team naming conventions: "Jake's Time Tracker", "Jake's Time
  // Tracking Board", "Jake Time Tracker", etc. Anchored at start, requires the
  // first name and "time", then any "track…" word (tracker/tracking/tracked).
  const esc = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${esc}(?:'s)?\\s+time\\s+track\\w*`, 'i');
  const match = boards.find(b => re.test(b.name));
  return match ? { id: Number(match.id), name: match.name } : null;
}

export async function getBoardUrl(boardId: number): Promise<string | null> {
  const data = await gql<{ boards: Array<{ url: string | null }> }>(
    `query ($ids: [ID!]) { boards(ids: $ids) { url } }`,
    { ids: [String(boardId)] }
  );
  return data.boards?.[0]?.url ?? null;
}

// Lists all boards the user can access. Used for the manual picker fallback
// when the firstName regex doesn't auto-match. Filters to boards with
// "time track…" in the name to keep the list manageable (matches "tracker",
// "tracking", "tracked").
export async function listTimeTrackerBoards(): Promise<Array<{ id: number; name: string }>> {
  const boards = await listAccessibleBoards();
  return boards
    .filter(b => /time\s+track/i.test(b.name))
    .map(b => ({ id: Number(b.id), name: b.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Clients change rarely, but listClients() is called on every Tracker mount and
// on every AI suggestion (debounced while typing). Cache the result so those
// don't each trigger a 200-item Monday fetch. In-flight dedup collapses a burst
// of concurrent callers into a single request.
type ClientList = Array<{ id: number; name: string }>;
const CLIENTS_TTL_MS = 10 * 60_000;
let clientsCache: { at: number; data: ClientList } | null = null;
let clientsInflight: Promise<ClientList> | null = null;

export function clearClientsCache() {
  clientsCache = null;
}

export async function listClients(force = false): Promise<ClientList> {
  if (!force && clientsCache && Date.now() - clientsCache.at < CLIENTS_TTL_MS) {
    return clientsCache.data;
  }
  if (clientsInflight) return clientsInflight;
  clientsInflight = (async () => {
    const data = await gql<{ boards: Array<{ groups: Array<{ title: string; items_page: { items: Array<{ id: string; name: string }> } }> }> }>(
      `query ($ids: [ID!]) {
        boards(ids: $ids) {
          groups {
            title
            items_page(limit: 200) { items { id name } }
          }
        }
      }`,
      { ids: [String(CLIENTS_BOARD_ID)] }
    );
    const groups = data.boards[0]?.groups ?? [];
    // Only "Current" clients belong in the picker; fall back to every group
    // rather than an empty list if the group is ever renamed.
    const current = groups.find(g => g.title === 'Current');
    const items = current ? current.items_page.items : groups.flatMap(g => g.items_page.items);
    const list = items
      .map(i => ({ id: Number(i.id), name: i.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    clientsCache = { at: Date.now(), data: list };
    return list;
  })().finally(() => { clientsInflight = null; });
  return clientsInflight;
}

// ---------------------------------------------------------------------------
// Creatives index
//
// The Creatives board holds ~6k items — far too many to fetch per keystroke,
// and too many for a single items_page call. So we page through the whole
// board once (name + client link + status), keep only non-Done/non-Archived
// items, and persist the index to disk via electron-store. Search then runs
// entirely in-renderer against the local index: instant from the first
// keystroke, even on a cold app launch (stale index served immediately while
// a background refresh runs).
// ---------------------------------------------------------------------------
export type Creative = { id: number; name: string; clientId?: number };

// These two columns live on the shared Creatives board (one board for the
// whole org, like CLIENTS_BOARD_ID), so their IDs are stable and safe to pin.
const CREATIVES_STATUS_COL = 'status';
const CREATIVES_CLIENT_COL = 'link_to_clients';
const CREATIVES_EXCLUDED_STATUSES = new Set(['Done', 'Archived']);
const CREATIVES_TTL_MS = 15 * 60_000;
let creativesInflight: Promise<Creative[]> | null = null;

export function clearCreativesCache() {
  store.delete('creativesCache');
}

async function fetchAllCreatives(): Promise<Creative[]> {
  type Item = {
    id: string;
    name: string;
    // linked_item_ids comes from the BoardRelationValue fragment — on API
    // 2024-10 board_relation columns return text/value as null, so the
    // fragment is the only way to read the linked client.
    column_values: Array<{ id: string; text: string | null; linked_item_ids?: string[] }>;
  };
  const fields = `cursor items { id name column_values(ids: ["${CREATIVES_STATUS_COL}", "${CREATIVES_CLIENT_COL}"]) { id text ... on BoardRelationValue { linked_item_ids } } }`;

  const out: Creative[] = [];
  let cursor: string | null = null;
  // ~6k items / 500 per page → ~12 requests. Hard page cap as a safety net so
  // a cursor bug can never loop forever.
  for (let page = 0; page < 40; page++) {
    let pageData: { cursor: string | null; items: Item[] };
    if (cursor) {
      const data = await gql<{ next_items_page: { cursor: string | null; items: Item[] } }>(
        `query ($cursor: String!) { next_items_page(cursor: $cursor, limit: 500) { ${fields} } }`,
        { cursor }
      );
      pageData = data.next_items_page;
    } else {
      const data = await gql<{
        boards: Array<{ items_page: { cursor: string | null; items: Item[] } }>;
      }>(
        `query ($ids: [ID!]) { boards(ids: $ids) { items_page(limit: 500) { ${fields} } } }`,
        { ids: [String(CREATIVES_BOARD_ID)] }
      );
      pageData = data.boards[0]?.items_page ?? { cursor: null, items: [] };
    }
    for (const i of pageData.items) {
      const get = (id: string) => i.column_values.find(c => c.id === id);
      const status = get(CREATIVES_STATUS_COL)?.text ?? '';
      if (CREATIVES_EXCLUDED_STATUSES.has(status)) continue;
      const linkedId = Number(get(CREATIVES_CLIENT_COL)?.linked_item_ids?.[0]);
      out.push({
        id: Number(i.id),
        name: i.name,
        clientId: Number.isFinite(linkedId) ? linkedId : undefined
      });
    }
    cursor = pageData.cursor;
    if (!cursor) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listCreatives(force = false): Promise<Creative[]> {
  const cached = store.get('creativesCache');
  const fresh = cached && Date.now() - cached.at < CREATIVES_TTL_MS;
  if (!force && fresh) return cached.data;

  if (!creativesInflight) {
    creativesInflight = fetchAllCreatives()
      .then(list => {
        store.set('creativesCache', { at: Date.now(), data: list });
        return list;
      })
      .finally(() => { creativesInflight = null; });
  }
  // Stale-while-revalidate: serve the disk index immediately so search never
  // waits on a ~12-request paging pass; the refresh lands for next time.
  if (cached) {
    creativesInflight.catch(err =>
      console.warn('[monday] creatives refresh failed, serving stale index:', (err as Error).message)
    );
    return cached.data;
  }
  return creativesInflight;
}

type LogParams = {
  boardId: number;
  userId: number;
  name: string;
  clientId?: number;
  creativeId?: number;
  division: string;
  category: string;
  startedAt: number;
  endedAt: number;
};

export async function logEntry(p: LogParams) {
  const minutes = Math.max(1, Math.ceil((p.endedAt - p.startedAt) / 60_000));
  const durationSec = minutes * 60;
  const startedSec = Math.floor(p.startedAt / 1000);
  // LOCAL date — toISOString() returns UTC, which lands AU/Asia entries on the
  // previous day when timers start before ~10am Sydney (UTC+10/+11).
  const d = new Date(p.startedAt);
  const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const cols = await getBoardCols(p.boardId);
  const missing = missingColsMessage(cols);
  if (missing) throw new Error(missing);

  // Step 1: create the item WITHOUT the time_tracking column.
  // Monday rejects time_tracking in column_values with "This column type is not
  // supported yet in the API" on create_item — verified live. We encode duration
  // in the item name as "(Xm)" so the entry is always self-describing, then
  // attempt a best-effort follow-up write.
  const namedWithDuration = `${p.name} (${minutes}m)`;

  const columnValues: Record<string, unknown> = {
    [cols.person!]: { personsAndTeams: [{ id: p.userId, kind: 'person' }] },
    [cols.date!]: { date: isoDate },
    [cols.division!]: { label: p.division },
    [cols.category!]: { label: p.category }
  };
  if (p.clientId && cols.client) {
    columnValues[cols.client] = { item_ids: [p.clientId] };
  }
  if (p.creativeId && cols.creative) {
    columnValues[cols.creative] = { item_ids: [p.creativeId] };
  }

  // create_labels_if_missing: true so canonical Division/Category values from
  // the app's constants get auto-added to boards that don't yet have them,
  // rather than rejecting the whole write.
  const data = await gql<{ create_item: { id: string } }>(
    `mutation ($boardId: ID!, $name: String!, $cv: JSON!) {
      create_item(board_id: $boardId, item_name: $name, column_values: $cv, create_labels_if_missing: true) {
        id
      }
    }`,
    { boardId: String(p.boardId), name: namedWithDuration, cv: JSON.stringify(columnValues) }
  );
  const itemId = Number(data.create_item.id);

  // Step 2: best-effort time_tracking write. Try the documented additional_value
  // format via change_column_value. If Monday still refuses (column type
  // unsupported on update too), swallow — the duration lives in the name.
  if (cols.timeTracking) {
    try {
      await gql(
        `mutation ($boardId: ID!, $itemId: ID!, $colId: String!, $val: JSON!) {
          change_column_value(board_id: $boardId, item_id: $itemId, column_id: $colId, value: $val) { id }
        }`,
        {
          boardId: String(p.boardId),
          itemId: String(itemId),
          colId: cols.timeTracking,
          val: JSON.stringify({
            running: 'false',
            duration: durationSec,
            startDate: startedSec
          })
        }
      );
    } catch (err) {
      console.warn('time_tracking write skipped:', (err as Error).message);
    }
  }

  clearEntriesCache(); // new entry — let Today/stats refetch
  return { id: itemId, minutes };
}

type UpdateEntryParams = {
  boardId: number;
  itemId: number;
  name: string;
  clientId?: number;
  creativeId?: number;
  division: string;
  category: string;
  durationMinutes: number;
  date?: string;
};

export async function updateEntry(p: UpdateEntryParams) {
  const cols = await getBoardCols(p.boardId);
  const missing = missingColsMessage(cols);
  if (missing) throw new Error(missing);

  const namedWithDuration = `${p.name} (${p.durationMinutes}m)`;
  const columnValues: Record<string, unknown> = {
    [cols.division!]: { label: p.division },
    [cols.category!]: { label: p.category }
  };
  if (cols.client) {
    columnValues[cols.client] = p.clientId ? { item_ids: [p.clientId] } : null;
  }
  if (cols.creative) {
    columnValues[cols.creative] = p.creativeId ? { item_ids: [p.creativeId] } : null;
  }
  if (p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && cols.date) {
    columnValues[cols.date] = { date: p.date };
  }

  // Update item name.
  await gql(
    `mutation ($boardId: ID!, $itemId: ID!, $name: String!) {
      change_simple_column_value(board_id: $boardId, item_id: $itemId, column_id: "name", value: $name) { id }
    }`,
    { boardId: String(p.boardId), itemId: String(p.itemId), name: namedWithDuration }
  );

  // Update other columns in one shot.
  await gql(
    `mutation ($boardId: ID!, $itemId: ID!, $cv: JSON!) {
      change_multiple_column_values(board_id: $boardId, item_id: $itemId, column_values: $cv, create_labels_if_missing: true) { id }
    }`,
    {
      boardId: String(p.boardId),
      itemId: String(p.itemId),
      cv: JSON.stringify(columnValues)
    }
  );

  // Best-effort time_tracking update (Monday may reject this column type).
  if (cols.timeTracking) {
    try {
      await gql(
        `mutation ($boardId: ID!, $itemId: ID!, $colId: String!, $val: JSON!) {
          change_column_value(board_id: $boardId, item_id: $itemId, column_id: $colId, value: $val) { id }
        }`,
        {
          boardId: String(p.boardId),
          itemId: String(p.itemId),
          colId: cols.timeTracking,
          val: JSON.stringify({ running: 'false', duration: p.durationMinutes * 60 })
        }
      );
    } catch (err) {
      console.warn('time_tracking update skipped:', (err as Error).message);
    }
  }

  clearEntriesCache(); // edited entry — invalidate cached board page
  return { id: p.itemId, minutes: p.durationMinutes };
}

export type TodayEntry = {
  id: number;
  name: string;
  clientName?: string;
  creativeName?: string;
  division?: string;
  category?: string;
  minutes: number;
  date?: string;
};

function localTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function todayEntries(boardId: number): Promise<TodayEntry[]> {
  // Server-side filtering on Monday's date column via query_params.rules has
  // proven unreliable, so reuse the client-side filter pattern from
  // recentEntries and pick out today's rows by their column text.
  const recent = await recentEntries(boardId, 1);
  const today = localTodayIso();
  return recent.filter(e => e.date === today);
}

export async function deleteEntry(itemId: number) {
  await gql(`mutation ($id: ID!) { delete_item(item_id: $id) { id } }`, { id: String(itemId) });
  clearEntriesCache(); // removed entry — invalidate cached board page
}

// On open, the app fires getStats(90), lastLogStatus(30), and todayEntries(1)
// near-simultaneously — all reading the same board page, differing only by a
// client-side date cutoff. Fetch+parse the page once, cache it briefly, and let
// each caller filter from the cache. In-flight dedup collapses the open burst
// into a single network round-trip; writes invalidate the cache immediately.
const ENTRIES_TTL_MS = 30_000;
let entriesCache: { boardId: number; at: number; data: TodayEntry[] } | null = null;
const entriesInflight = new Map<number, Promise<TodayEntry[]>>();

export function clearEntriesCache() {
  entriesCache = null;
}

async function fetchBoardEntries(boardId: number): Promise<TodayEntry[]> {
  if (entriesCache && entriesCache.boardId === boardId && Date.now() - entriesCache.at < ENTRIES_TTL_MS) {
    return entriesCache.data;
  }
  const existing = entriesInflight.get(boardId);
  if (existing) return existing;

  const p = (async () => {
    const cols = await getBoardCols(boardId);
    const data = await gql<{
      boards: Array<{
        items_page: {
          items: Array<{
            id: string;
            name: string;
            // display_value comes from the BoardRelationValue fragment — on API
            // 2024-10 board_relation columns (client, creative) return text as
            // null, so the fragment is the only way to read the linked names.
            column_values: Array<{ id: string; text: string; value: string | null; display_value?: string | null }>;
          }>;
        };
      }>;
    }>(
      `query ($boardId: ID!) {
        boards(ids: [$boardId]) {
          items_page(limit: 100) {
            items {
              id name
              column_values { id text value ... on BoardRelationValue { display_value } }
            }
          }
        }
      }`,
      { boardId: String(boardId) }
    );
    const items = data.boards[0]?.items_page.items ?? [];

    const results: TodayEntry[] = [];
    for (const i of items) {
      const get = (id: string | null) => (id ? i.column_values.find(c => c.id === id) : undefined);
      const dateText = get(cols.date)?.text;
      if (!dateText || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) continue;

      const trackingRaw = get(cols.timeTracking)?.value;
      let minutes = 0;
      if (trackingRaw) {
        try {
          const parsed = JSON.parse(trackingRaw);
          const seconds = typeof parsed.duration === 'number' ? parsed.duration : 0;
          minutes = Math.round(seconds / 60);
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
        clientName: get(cols.client)?.display_value || get(cols.client)?.text || undefined,
        creativeName: get(cols.creative)?.display_value || get(cols.creative)?.text || undefined,
        division: get(cols.division)?.text || undefined,
        category: get(cols.category)?.text || undefined,
        minutes,
        date: dateText
      });
    }
    results.sort((a, b) => (b.date! > a.date! ? 1 : -1));
    entriesCache = { boardId, at: Date.now(), data: results };
    return results;
  })().finally(() => entriesInflight.delete(boardId));

  entriesInflight.set(boardId, p);
  return p;
}

// Entries from the last `daysBack` days (weekends included), most recent first.
// Used for "last logged" / "missed days" indicators and stats.
export async function recentEntries(
  boardId: number,
  daysBack = 14
): Promise<TodayEntry[]> {
  const all = await fetchBoardEntries(boardId);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  cutoff.setHours(0, 0, 0, 0);
  return all.filter(e => e.date && new Date(`${e.date}T00:00:00`) >= cutoff);
}

export type Stats = {
  streak: number;
  categoryMinutes: Record<string, number>;
};

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Walk back from today, skipping weekends, counting consecutive logged
// weekdays. If today isn't logged yet, start from yesterday so the streak
// doesn't reset until tomorrow morning.
export function computeStreak(loggedDates: Set<string>): number {
  let count = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!loggedDates.has(localIso(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  for (let safety = 0; safety < 1000; safety++) {
    const dow = cursor.getDay();
    if (dow === 0 || dow === 6) {
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    if (loggedDates.has(localIso(cursor))) {
      count++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return count;
}

export async function getStats(boardId: number): Promise<Stats> {
  const entries = await recentEntries(boardId, 90);
  const loggedDates = new Set<string>();
  const categoryMinutes: Record<string, number> = {};
  for (const e of entries) {
    if (e.date) loggedDates.add(e.date);
    if (e.category && e.minutes > 0) {
      categoryMinutes[e.category] = (categoryMinutes[e.category] || 0) + e.minutes;
    }
  }
  return { streak: computeStreak(loggedDates), categoryMinutes };
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
