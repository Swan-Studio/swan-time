import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // Auth
  authStatus: () => ipcRenderer.invoke('auth:status'),
  authStart: () => ipcRenderer.invoke('auth:start'),
  authSetManualToken: (token: string) => ipcRenderer.invoke('auth:setManual', token),
  authSignOut: () => ipcRenderer.invoke('auth:signOut'),

  // Monday data
  listClients: () => ipcRenderer.invoke('monday:clients'),
  listTimeTrackerBoards: () => ipcRenderer.invoke('monday:listTimeTrackerBoards'),
  setBoard: (boardId: number, boardName?: string) =>
    ipcRenderer.invoke('monday:setBoard', boardId, boardName),
  todayEntries: () => ipcRenderer.invoke('monday:today'),
  recentEntries: (daysBack?: number) => ipcRenderer.invoke('monday:recent', daysBack),
  lastLogStatus: () => ipcRenderer.invoke('monday:lastLogStatus'),
  deleteEntry: (id: number) => ipcRenderer.invoke('monday:delete', id),

  // Timer
  getRunning: () => ipcRenderer.invoke('timer:get'),
  startTimer: (payload: any) => ipcRenderer.invoke('timer:start', payload),
  updateTimer: (patch: any) => ipcRenderer.invoke('timer:update', patch),
  stopTimer: () => ipcRenderer.invoke('timer:stop'),
  cancelTimer: () => ipcRenderer.invoke('timer:cancel'),

  // Recents + settings
  getRecents: () => ipcRenderer.invoke('recents:get'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: any) => ipcRenderer.invoke('settings:set', patch),

  // AI
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  suggestCategory: (name: string) => ipcRenderer.invoke('ai:suggest', name),
  dailySummary: () => ipcRenderer.invoke('ai:summary'),

  // Batch
  batchOpen: () => ipcRenderer.invoke('batch:open'),
  batchClose: () => ipcRenderer.invoke('batch:close'),
  batchParse: (text: string) => ipcRenderer.invoke('batch:parse', text),
  batchPost: (rows: any[]) => ipcRenderer.invoke('batch:post', rows),

  // Window
  hide: () => ipcRenderer.invoke('window:hide'),
  quit: () => ipcRenderer.invoke('app:quit'),

  // Events
  onTimerTick: (cb: (seconds: number) => void): (() => void) => {
    const handler = (_: unknown, s: number) => cb(s);
    ipcRenderer.on('timer:tick', handler);
    return () => {
      ipcRenderer.off('timer:tick', handler);
    };
  },
  onShow: (cb: () => void): (() => void) => {
    const handler = () => cb();
    ipcRenderer.on('window:show', handler);
    return () => {
      ipcRenderer.off('window:show', handler);
    };
  },
  onWidgetMode: (cb: (mode: 'compact' | 'batch') => void): (() => void) => {
    const handler = (_: unknown, mode: 'compact' | 'batch') => cb(mode);
    ipcRenderer.on('widget:mode', handler);
    return () => {
      ipcRenderer.off('widget:mode', handler);
    };
  }
};

contextBridge.exposeInMainWorld('swan', api);
export type SwanApi = typeof api;
