import Store from 'electron-store';

export type RecentEntry = {
  name: string;
  clientId?: number;
  clientName?: string;
  creativeId?: number;
  creativeName?: string;
  division?: string;
  category?: string;
  lastUsed: number;
};

export type RunningTimer = {
  // Start of the current "run leg". Reset to Date.now() on each resume so the
  // tick math `accumulatedMs + (now - startedAt)` always reflects total elapsed.
  startedAt: number;
  name: string;
  clientId?: number;
  clientName?: string;
  creativeId?: number;
  creativeName?: string;
  division?: string;
  category?: string;
  pausedAt?: number;
  accumulatedMs?: number;
} | null;

export type Settings = {
  aiEnabled: boolean;
  anthropicApiKey?: string;
  hotkey: string;
  primaryDivision?: string;
  closeOnBlur: boolean;
  streaksEnabled: boolean;
  levelsEnabled: boolean;
  nudgesEnabled?: boolean;
  displayNameOverride?: string;
};

type Schema = {
  running: RunningTimer;
  recents: RecentEntry[];
  settings: Settings;
  boardId?: number;
  userId?: number;
  userName?: string;
  userEmail?: string;
  accountSlug?: string;
  // Disk-persisted Creatives board index — search stays instant on cold launch
  // while a background refresh replaces it. See listCreatives in monday.ts.
  creativesCache?: { at: number; data: Array<{ id: number; name: string; clientId?: number }> };
};

export const store = new Store<Schema>({
  name: 'swan-time',
  defaults: {
    running: null,
    recents: [],
    settings: {
      aiEnabled: false,
      hotkey: 'CommandOrControl+Alt+T',
      closeOnBlur: true,
      streaksEnabled: true,
      levelsEnabled: true
    }
  }
});

export function pushRecent(entry: Omit<RecentEntry, 'lastUsed'>) {
  const recents = store.get('recents');
  const filtered = recents.filter(r => r.name.toLowerCase() !== entry.name.toLowerCase());
  filtered.unshift({ ...entry, lastUsed: Date.now() });
  store.set('recents', filtered.slice(0, 8));
}
