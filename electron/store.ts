import Store from 'electron-store';

export type RecentEntry = {
  name: string;
  clientId?: number;
  clientName?: string;
  division?: string;
  category?: string;
  lastUsed: number;
};

export type RunningTimer = {
  startedAt: number;
  name: string;
  clientId?: number;
  clientName?: string;
  division?: string;
  category?: string;
} | null;

export type Settings = {
  aiEnabled: boolean;
  anthropicApiKey?: string;
  hotkey: string;
  primaryDivision?: string;
};

type Schema = {
  running: RunningTimer;
  recents: RecentEntry[];
  settings: Settings;
  boardId?: number;
  userId?: number;
  userName?: string;
};

export const store = new Store<Schema>({
  name: 'swan-time',
  defaults: {
    running: null,
    recents: [],
    settings: { aiEnabled: false, hotkey: 'CommandOrControl+Shift+T' }
  }
});

export function pushRecent(entry: Omit<RecentEntry, 'lastUsed'>) {
  const recents = store.get('recents');
  const filtered = recents.filter(r => r.name.toLowerCase() !== entry.name.toLowerCase());
  filtered.unshift({ ...entry, lastUsed: Date.now() });
  store.set('recents', filtered.slice(0, 8));
}
