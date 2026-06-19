import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, screen, shell } from 'electron';
import { setupUpdater, getUpdateState, installUpdate } from './updater';
import path from 'node:path';
import fs from 'node:fs';
import { store, pushRecent, type RunningTimer } from './store';

// Tiny dotenv shim — loads .env.local from the project root in dev so Swan's
// shared API keys can be set once without shell exports. No dependency added.
function loadEnvLocal() {
  const candidates = [
    path.join(__dirname, '..', '.env.local'),
    path.join(process.cwd(), '.env.local')
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
      if (!m) continue;
      const [, key, rawVal] = m;
      const val = rawVal.replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
    return;
  }
}
loadEnvLocal();
import { startOAuth, getToken, clearToken, setManualToken } from './oauth';
import { TRAY_ICON_PNG_1X, TRAY_ICON_PNG_2X } from './trayIconData';
import {
  whoAmI,
  getAccountSlug,
  findUserBoard,
  listClientsForBoard,
  listCategoriesForBoard,
  CATEGORIES,
  listCreatives,
  listTimeTrackerBoards,
  logEntry,
  todayEntries,
  recentEntries,
  lastLogStatus,
  deleteEntry,
  getBoardUrl,
  getBoardCols,
  getStats,
  updateEntry,
  clearColumnCache,
  clearClientsCache,
  clearCreativesCache,
  clearEntriesCache
} from './monday';
import { suggestCategory, dailySummary, aiStatus, parseBatch } from './ai';
import { shortlistCreatives, resolveCreativeByName, type CreativeRef } from './creativeMatch';
import { targetBoundsFor, COMPACT_SIZE, type WidgetMode } from './windowBounds';

const isDev = !app.isPackaged;
let win: BrowserWindow | null = null;
let quitting = false; // set in before-quit so the close→hide interception doesn't block app exit
let tray: Tray | null = null;
let tickInterval: NodeJS.Timeout | null = null;
let nudgeTimeout: NodeJS.Timeout | null = null;
let widgetMode: WidgetMode = 'compact';
let lastBounds: Electron.Rectangle | null = null;

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

function createWindow() {
  win = new BrowserWindow({
    width: COMPACT_SIZE.width,
    height: COMPACT_SIZE.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    hasShadow: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setWindowButtonVisibility?.(false);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  if (isDev) {
    // SWAN_DEV_URL lets the dev stack run on an alternate port when 5173 is
    // taken by another project's vite.
    win.loadURL(process.env.SWAN_DEV_URL || 'http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.on('blur', () => {
    if (widgetMode === 'nudge') return; // nudges close only via 30s timer or expand; don't pollute lastBounds with nudge size
    if (store.get('settings').closeOnBlur !== false) hideWindow();
    else if (win) lastBounds = win.getBounds();
  });

  // ⌘W is live via Electron's default application menu even though LSUIElement
  // hides the menu bar — and a closed window used to brick the tray ("Object
  // has been destroyed" at the next toggle, crashed live 2026-06-04). This is
  // a menubar app: close means hide; the window's lifetime is the app's.
  win.on('close', e => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
  });
  // Defense in depth: if the window is ever destroyed anyway, drop the stale
  // reference so showWindow/toggleWindow recreate it instead of crashing.
  win.on('closed', () => {
    win = null;
  });
}

// THE single owner of window geometry + visibility. Invariants:
//   1. every show declares its mode (no path can show a stale-size window)
//   2. resizes never animate (mode morphs snap; no macOS grow effect)
//   3. closing goes hide-first, resize-after via hideWindow()
function applyWidgetMode(
  mode: WidgetMode,
  opts: { show?: boolean; focus?: boolean; showInactive?: boolean } = {}
) {
  // Recreate on demand — a destroyed window must never brick the tray/hotkey.
  if (!win || win.isDestroyed()) createWindow();
  if (!win) return;
  widgetMode = mode;
  win.setResizable(mode === 'batch');
  win.setAlwaysOnTop(mode !== 'batch');
  const trayBounds = tray ? tray.getBounds() : null;
  const anchorPoint =
    mode === 'batch' || !trayBounds
      ? screen.getCursorScreenPoint()
      : { x: trayBounds.x, y: trayBounds.y };
  const workArea = screen.getDisplayNearestPoint(anchorPoint).workArea;
  const target = targetBoundsFor(mode, { trayBounds, workArea });
  // Sticky-widget mode restores the last *position*; size always follows mode.
  const sticky = mode === 'compact' && store.get('settings').closeOnBlur === false && lastBounds;
  if (sticky && lastBounds) {
    win.setBounds(
      { x: lastBounds.x, y: lastBounds.y, width: target.width, height: target.height },
      false
    );
  } else if (target.x !== undefined && target.y !== undefined) {
    win.setBounds({ x: target.x, y: target.y, width: target.width, height: target.height }, false);
  } else {
    win.setSize(target.width, target.height, false);
  }
  win.webContents.send('widget:mode', mode);
  if (opts.show) {
    win.show();
    if (opts.focus) win.focus();
    win.webContents.send('window:show');
  } else if (opts.showInactive) {
    win.showInactive();
  }
}

function showWindow() {
  applyWidgetMode('compact', { show: true, focus: true });
}

// Hide first, normalize size while invisible — the next show is always
// pre-sized and the user never sees a resize animation.
function hideWindow() {
  if (!win || win.isDestroyed()) return;
  if (widgetMode !== 'nudge') lastBounds = win.getBounds();
  win.hide();
  applyWidgetMode('compact');
}

function toggleWindow() {
  if (win && !win.isDestroyed() && win.isVisible()) {
    // Tray click while the nudge banner is up means "open the widget",
    // not "dismiss" — morph in place (snap, invariant 2).
    if (widgetMode === 'nudge') applyWidgetMode('compact', { show: true, focus: true });
    else hideWindow();
  } else {
    applyWidgetMode('compact', { show: true, focus: true });
  }
}

function buildTrayIcon(): Electron.NativeImage {
  const img = nativeImage.createFromBuffer(TRAY_ICON_PNG_1X, { scaleFactor: 1.0 });
  img.addRepresentation({ scaleFactor: 2.0, buffer: TRAY_ICON_PNG_2X });
  img.setTemplateImage(true);
  return img;
}

const SHORTCUT_HINT = process.platform === 'darwin' ? '⌘⌥T' : 'Ctrl+Alt+T';

function createTray() {
  tray = new Tray(buildTrayIcon());
  tray.setToolTip(`Swan Time — ${SHORTCUT_HINT}`);
  tray.on('click', () => toggleWindow());
  tray.on('right-click', () => {
    const update = getUpdateState();
    const updateItems: Electron.MenuItemConstructorOptions[] =
      update.phase === 'ready'
        ? [
            {
              label:
                process.platform === 'win32'
                  ? `⬇ Restart to update — v${update.version}`
                  : `⬇ Update available — v${update.version}`,
              click: () => void installUpdate()
            },
            { type: 'separator' }
          ]
        : [];
    const menu = Menu.buildFromTemplate([
      ...updateItems,
      { label: 'Show', click: () => showWindow() },
      {
        label: 'Batch entry…',
        accelerator: 'CommandOrControl+Shift+B',
        click: () => applyWidgetMode('batch', { show: true, focus: true })
      },
      { type: 'separator' },
      { label: 'Sign out', click: async () => { await clearToken(); store.clear(); clearColumnCache(); clearClientsCache(); clearCreativesCache(); clearEntriesCache(); } },
      { label: 'Quit Swan Time', role: 'quit' }
    ]);
    tray?.popUpContextMenu(menu);
  });
  refreshTrayTitle();
}

function runningElapsedMs(r: NonNullable<RunningTimer>): number {
  const acc = r.accumulatedMs ?? 0;
  if (r.pausedAt) return acc;
  return acc + (Date.now() - r.startedAt);
}

function refreshTrayTitle() {
  if (!tray) return;
  const running = store.get('running');
  if (!running) {
    if (process.platform === 'darwin') tray.setTitle('');
    tray.setToolTip(`Swan Time — ${SHORTCUT_HINT}`);
    return;
  }
  const elapsed = Math.floor(runningElapsedMs(running) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  const indicator = running.pausedAt ? '⏸' : '●';
  const status = `${indicator} ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  // macOS shows the live timer inline next to the menubar icon. Windows/Linux
  // have no equivalent, so we surface the timer in the tray tooltip instead —
  // updates on next hover, which is the conventional Electron fallback.
  if (process.platform === 'darwin') {
    tray.setTitle(` ${status}`);
  } else {
    tray.setToolTip(`Swan Time ${status} — ${SHORTCUT_HINT}`);
  }
}

function startTickLoop() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(() => {
    const running = store.get('running');
    if (!running) return;
    const seconds = Math.floor(runningElapsedMs(running) / 1000);
    win?.webContents.send('timer:tick', seconds);
    refreshTrayTitle();
  }, 1000);
}

// Compute the next :00 or :30 boundary that falls within the 9:00–17:00
// local-time window (inclusive of 17:00). Recomputed each fire so it self-
// corrects after sleep/wake or DST transitions.
function nextNudgeFromNow(now: Date = new Date()): Date {
  const t = new Date(now.getTime() + 1000); // 1s slop avoids re-firing the boundary we just hit
  t.setSeconds(0, 0);
  if (t.getMinutes() < 30) t.setMinutes(30);
  else { t.setMinutes(0); t.setHours(t.getHours() + 1); }
  for (let i = 0; i < 96; i++) {
    const h = t.getHours(), m = t.getMinutes();
    if ((h >= 9 && h < 17) || (h === 17 && m === 0)) return t;
    t.setMinutes(t.getMinutes() + 30);
  }
  return t;
}

function fireNudge() {
  if (!win) return;
  if (store.get('settings').nudgesEnabled === false) return;
  // If the user is already in the widget, don't yank them into the small banner.
  if (win.isVisible()) return;
  // showInactive avoids stealing focus from whatever they're working in.
  applyWidgetMode('nudge', { showInactive: true });
}

function scheduleNextNudge() {
  if (nudgeTimeout) clearTimeout(nudgeTimeout);
  const delay = Math.max(1000, nextNudgeFromNow().getTime() - Date.now());
  nudgeTimeout = setTimeout(() => {
    fireNudge();
    scheduleNextNudge();
  }, delay);
}

// Deterministic test-mode stats so the streak UI can be inspected as a
// hypothetical seasoned user. Triggered when displayNameOverride is set.
function mockStatsForName(name: string): { streak: number } {
  let seed = 0;
  for (let i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) | 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) | 0;
    return ((seed >>> 0) % 10000) / 10000;
  };
  const streak = 3 + Math.floor(rand() * 25);
  return { streak };
}

// Creative candidates for AI suggestion — best-effort: any failure (no board,
// no creative column, cache miss) just means no creative gets suggested.
async function creativeCandidateRefs(): Promise<CreativeRef[]> {
  try {
    const boardId = store.get('boardId');
    if (!boardId || !(await getBoardCols(boardId)).creative) return [];
    return await listCreatives();
  } catch {
    return [];
  }
}

// Client list for AI context — same best-effort rule: boards without a client
// column (e.g. guest setups) just get no client names in the prompt.
async function clientCandidates(): Promise<Array<{ id: number; name: string }>> {
  try {
    const boardId = store.get('boardId');
    if (!boardId) return [];
    return await listClientsForBoard(boardId);
  } catch {
    return [];
  }
}

function registerIpc() {
  // Updates
  ipcMain.handle('update:status', () => getUpdateState());
  ipcMain.handle('update:install', () => installUpdate());

  // Auth
  ipcMain.handle('auth:status', async () => {
    const token = await getToken();
    if (!token) return { authed: false };
    return {
      authed: true,
      userId: store.get('userId'),
      userName: store.get('userName'),
      userEmail: store.get('userEmail'),
      boardId: store.get('boardId')
    };
  });

  ipcMain.handle('auth:start', async () => {
    await startOAuth();
    return resolveUser();
  });

  ipcMain.handle('auth:setManual', async (_e, token: string) => {
    await setManualToken(token);
    return resolveUser();
  });

  ipcMain.handle('auth:signOut', async () => {
    await clearToken();
    store.delete('userId');
    store.delete('userName');
    store.delete('userEmail');
    store.delete('boardId');
    clearColumnCache();
    clearClientsCache();
    clearCreativesCache();
    clearEntriesCache();
    return { authed: false };
  });

  // Monday
  ipcMain.handle('monday:clients', async () => {
    const boardId = store.get('boardId');
    if (!boardId) return [];
    return listClientsForBoard(boardId);
  });
  ipcMain.handle('monday:creatives', () => listCreatives());
  // Category picker options, read live from the user's board (its Category
  // status column) so each board can define its own set. Falls back to the
  // bundled CATEGORIES list when no board is selected or it can't be read.
  ipcMain.handle('monday:categories', async () => {
    const boardId = store.get('boardId');
    if (!boardId) return [...CATEGORIES];
    return listCategoriesForBoard(boardId);
  });
  // Capability check: the Creative picker only renders when the user's board
  // carries a board_relation column connected to the Creatives board. Boards
  // without the column see no UI change at all.
  ipcMain.handle('monday:creativesEnabled', async () => {
    const boardId = store.get('boardId');
    if (!boardId) return false;
    try {
      return (await getBoardCols(boardId)).creative !== null;
    } catch {
      return false;
    }
  });
  // Same capability check for the Client picker — boards without a client
  // board_relation column (e.g. guest boards) hide client selection entirely.
  ipcMain.handle('monday:clientsEnabled', async () => {
    const boardId = store.get('boardId');
    if (!boardId) return false;
    try {
      return (await getBoardCols(boardId)).client !== null;
    } catch {
      return false;
    }
  });
  ipcMain.handle('monday:listTimeTrackerBoards', () => listTimeTrackerBoards());
  ipcMain.handle('monday:setBoard', (_e, boardId: number, boardName?: string) => {
    const prev = store.get('boardId');
    if (prev && prev !== boardId) {
      clearColumnCache(prev);
      clearEntriesCache();
    }
    store.set('boardId', boardId);
    if (boardName) store.set('userName', store.get('userName')); // keep
    return { boardId };
  });
  ipcMain.handle('monday:today', () => {
    const boardId = store.get('boardId');
    if (!boardId) return [];
    return todayEntries(boardId);
  });
  ipcMain.handle('monday:recent', (_e, daysBack?: number) => {
    const boardId = store.get('boardId');
    if (!boardId) return [];
    return recentEntries(boardId, daysBack ?? 14);
  });
  ipcMain.handle('monday:lastLogStatus', () => {
    const boardId = store.get('boardId');
    if (!boardId) return { lastDate: null, daysSince: null };
    return lastLogStatus(boardId);
  });
  ipcMain.handle('monday:stats', () => {
    const boardId = store.get('boardId');
    if (!boardId) return { streak: 0 };
    const override = store.get('settings').displayNameOverride?.trim();
    if (override) return mockStatsForName(override);
    return getStats(boardId);
  });
  ipcMain.handle('monday:delete', (_e, id: number) => deleteEntry(id));
  ipcMain.handle('monday:update', async (_e, patch: {
    itemId: number;
    name: string;
    clientId?: number;
    creativeId?: number;
    division: string;
    category: string;
    durationMinutes: number;
    date?: string;
  }) => {
    const boardId = store.get('boardId');
    if (!boardId) return { ok: false, error: 'No board selected' };
    try {
      const res = await updateEntry({ boardId, ...patch });
      return { ok: true, ...res };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  // Timer
  ipcMain.handle('timer:get', () => store.get('running'));

  ipcMain.handle('timer:start', (_e, payload: any) => {
    store.set('running', {
      startedAt: Date.now(),
      name: payload.name,
      clientId: payload.clientId,
      clientName: payload.clientName,
      creativeId: payload.creativeId,
      creativeName: payload.creativeName,
      division: payload.division,
      category: payload.category,
      accumulatedMs: 0
    });
    startTickLoop();
    refreshTrayTitle();
    return store.get('running');
  });

  ipcMain.handle('timer:update', (_e, patch: any) => {
    const cur = store.get('running');
    if (!cur) return null;
    store.set('running', { ...cur, ...patch });
    return store.get('running');
  });

  ipcMain.handle('timer:pause', () => {
    const cur = store.get('running');
    if (!cur || cur.pausedAt) return cur;
    const now = Date.now();
    store.set('running', {
      ...cur,
      pausedAt: now,
      accumulatedMs: (cur.accumulatedMs ?? 0) + (now - cur.startedAt)
    });
    refreshTrayTitle();
    const next = store.get('running');
    if (next) win?.webContents.send('timer:tick', Math.floor(runningElapsedMs(next) / 1000));
    return next;
  });

  ipcMain.handle('timer:resume', () => {
    const cur = store.get('running');
    if (!cur || !cur.pausedAt) return cur;
    // Drop pausedAt; reset startedAt so tick math resumes from now.
    const { pausedAt: _drop, ...rest } = cur;
    store.set('running', { ...rest, startedAt: Date.now() });
    refreshTrayTitle();
    return store.get('running');
  });

  ipcMain.handle('timer:stop', async (_event, overrideMinutes?: number) => {
    const cur = store.get('running');
    if (!cur) return { ok: false, error: 'No running timer' };
    if (!cur.division || !cur.category) return { ok: false, error: 'Need division + category' };
    const boardId = store.get('boardId');
    const userId = store.get('userId');
    if (!boardId || !userId) return { ok: false, error: 'Not authenticated' };

    const endedAt = Date.now();
    // User-edited duration from the StopGate. Defensive clamp — the renderer
    // already disables Log for invalid input.
    const override =
      typeof overrideMinutes === 'number' && Number.isFinite(overrideMinutes)
        ? Math.min(1440, Math.max(1, Math.round(overrideMinutes)))
        : undefined;
    // Pass an effective startedAt so logEntry's (endedAt - startedAt) yields the
    // tracked duration minus any paused time — or the user's edited override.
    const effectiveMs = override !== undefined ? override * 60_000 : runningElapsedMs(cur);
    let result;
    try {
      result = await logEntry({
        boardId,
        userId,
        name: cur.name,
        clientId: cur.clientId,
        creativeId: cur.creativeId,
        division: cur.division,
        category: cur.category,
        startedAt: endedAt - effectiveMs,
        endedAt
      });
    } catch (e) {
      // Surface the Monday error to the UI instead of leaving it stuck on
      // "Logging…". Keep the running timer in store so the user doesn't lose
      // their elapsed time and can retry.
      console.error('timer:stop logEntry failed:', e);
      return { ok: false, error: (e as Error).message || 'Failed to log entry' };
    }
    pushRecent({
      name: cur.name,
      clientId: cur.clientId,
      clientName: cur.clientName,
      creativeId: cur.creativeId,
      creativeName: cur.creativeName,
      division: cur.division,
      category: cur.category
    });
    store.set('running', null);
    refreshTrayTitle();
    return { ok: true, ...result };
  });

  ipcMain.handle('timer:cancel', () => {
    store.set('running', null);
    refreshTrayTitle();
    return true;
  });

  // Recents + settings
  ipcMain.handle('recents:get', () => store.get('recents'));
  ipcMain.handle('settings:get', () => store.get('settings'));
  ipcMain.handle('settings:set', (_e, patch: any) => {
    store.set('settings', { ...store.get('settings'), ...patch });
    return store.get('settings');
  });

  // AI
  ipcMain.handle('ai:status', () => aiStatus());
  ipcMain.handle('ai:suggest', async (_e, name: string) => {
    const recents = store.get('recents').map(r => ({ name: r.name, clientName: r.clientName }));
    const clients = await clientCandidates();
    const candidates = shortlistCreatives(name, await creativeCandidateRefs());
    const suggestion = await suggestCategory(name, {
      recents,
      clients: clients.map(c => c.name),
      creativeCandidates: candidates.map(c => c.name)
    });
    // Attach the id for the renderer; an unknown/hallucinated name resolves
    // to undefined and the suggestion degrades to client/division/category.
    const resolved = resolveCreativeByName(suggestion.creativeName, candidates);
    // Ambiguous path: resolve each candidate name to {id, name, clientName}
    // for the chooser dropdown. Names that fail to resolve are dropped.
    const clientNameById = new Map(clients.map(c => [c.id, c.name]));
    const candidateRefs = (suggestion.candidateNames ?? [])
      .map(n => resolveCreativeByName(n, candidates))
      .filter((r): r is { creativeId: number; creativeName: string } => Boolean(r))
      .map(r => {
        const ref = candidates.find(c => c.id === r.creativeId);
        return {
          id: r.creativeId,
          name: r.creativeName,
          clientName: ref?.clientId !== undefined ? clientNameById.get(ref.clientId) : undefined
        };
      });
    return {
      ...suggestion,
      creativeName: resolved?.creativeName,
      creativeId: resolved?.creativeId,
      candidates: candidateRefs.length >= 2 ? candidateRefs : undefined,
      candidateNames: undefined
    };
  });
  ipcMain.handle('ai:summary', async () => {
    const boardId = store.get('boardId');
    if (!boardId) return 'Sign in first.';
    const entries = await todayEntries(boardId);
    return dailySummary(entries);
  });

  // Batch
  ipcMain.handle('batch:open', () => applyWidgetMode('batch', { show: true, focus: true }));
  ipcMain.handle('batch:close', () => applyWidgetMode('compact', { show: true, focus: true }));

  // Nudge
  ipcMain.handle('nudge:expand', () => applyWidgetMode('compact', { show: true, focus: true }));
  // Hide first, then normalize size while invisible (invariant 3) — closing
  // the banner must never play a grow animation.
  ipcMain.handle('nudge:close', () => hideWindow());

  ipcMain.handle('batch:parse', async (_e, text: string) => {
    const clients = await clientCandidates();
    // Use LOCAL date — UTC was making "yesterday" off by a day for users in
    // AU/Asia timezones where the local day is ahead of UTC.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const primaryDivision = store.get('settings').primaryDivision;
    const candidates = shortlistCreatives(text, await creativeCandidateRefs(), { cap: 25 });
    const rows = await parseBatch(text, {
      clients: clients.map(c => c.name),
      today,
      primaryDivision,
      creativeCandidates: candidates.map(c => c.name)
    });
    // Attach ids; drop a creative that contradicts the row's matched client —
    // the client↔creative consistency rule the pickers enforce manually.
    return rows.map(row => {
      const resolved = resolveCreativeByName(row.creativeName, candidates);
      if (!resolved) return { ...row, creativeName: undefined };
      const ref = candidates.find(c => c.id === resolved.creativeId);
      const ownerName = ref?.clientId ? clients.find(c => c.id === ref.clientId)?.name : undefined;
      const clientOk = !row.clientName || !ownerName || ownerName === row.clientName;
      return clientOk
        ? { ...row, creativeName: resolved.creativeName, creativeId: resolved.creativeId }
        : { ...row, creativeName: undefined };
    });
  });

  ipcMain.handle('batch:post', async (_e, rows: Array<{
    date: string;
    name: string;
    durationMinutes: number;
    clientId?: number;
    clientName?: string;
    creativeId?: number;
    creativeName?: string;
    division: string;
    category: string;
  }>) => {
    const boardId = store.get('boardId');
    const userId = store.get('userId');
    if (!boardId || !userId) return { ok: false, error: 'Not authenticated', results: [] };

    const results: Array<{ ok: boolean; error?: string; minutes?: number }> = [];
    for (const row of rows) {
      try {
        const startedAt = new Date(`${row.date}T09:00:00`).getTime();
        const endedAt = startedAt + row.durationMinutes * 60_000;
        const r = await logEntry({
          boardId,
          userId,
          name: row.name,
          clientId: row.clientId,
          creativeId: row.creativeId,
          division: row.division,
          category: row.category,
          startedAt,
          endedAt
        });
        pushRecent({
          name: row.name,
          clientId: row.clientId,
          clientName: row.clientName,
          creativeId: row.creativeId,
          creativeName: row.creativeName,
          division: row.division,
          category: row.category
        });
        results.push({ ok: true, minutes: r.minutes });
        // Small delay between writes to avoid Monday rate-limit pressure.
        await new Promise(r => setTimeout(r, 250));
      } catch (e) {
        results.push({ ok: false, error: (e as Error).message });
      }
    }
    return { ok: results.every(r => r.ok), results };
  });

  // Window
  ipcMain.handle('window:hide', () => win?.hide());
  ipcMain.handle('app:quit', () => app.quit());

  ipcMain.handle('monday:openBoard', async () => {
    const boardId = store.get('boardId');
    if (!boardId) return { ok: false, error: 'No board selected' };
    // Ask Monday for the canonical board URL — the slug-less monday.com domain
    // 404s on the marketing site, so guessing the workspace subdomain is unsafe.
    let url: string | null = null;
    try {
      url = await getBoardUrl(boardId);
    } catch {
      // fall through to slug-based stitching
    }
    if (!url) {
      let slug = store.get('accountSlug');
      if (!slug) {
        slug = (await getAccountSlug()) ?? undefined;
        if (slug) store.set('accountSlug', slug);
      }
      if (!slug) return { ok: false, error: 'Could not resolve board URL' };
      url = `https://${slug}.monday.com/boards/${boardId}`;
    }
    await shell.openExternal(url);
    return { ok: true };
  });
}

async function resolveUser() {
  const me = await whoAmI();
  store.set('userId', Number(me.id));
  store.set('userName', me.name);
  if (me.email) store.set('userEmail', me.email);
  // Best-effort — never fails resolution.
  getAccountSlug().then(slug => {
    if (slug) store.set('accountSlug', slug);
  });
  const firstName = me.name.split(/\s+/)[0];
  const board = await findUserBoard(firstName);
  if (!board) {
    return {
      authed: true,
      userId: Number(me.id),
      userName: me.name,
      boardId: undefined,
      boardError: `No board matching "${firstName} Time Tracker" — ask an admin to create yours.`
    };
  }
  store.set('boardId', board.id);
  return { authed: true, userId: Number(me.id), userName: me.name, boardId: board.id };
}


app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide();
  createWindow();
  createTray();
  registerIpc();
  setupUpdater(version => {
    win?.webContents.send('update:ready', version);
  });

  // Migrate the legacy default hotkey if still in place.
  const settings = store.get('settings');
  if (settings.hotkey === 'CommandOrControl+Shift+T') {
    store.set('settings', { ...settings, hotkey: 'CommandOrControl+Alt+T' });
  }
  const hotkey = store.get('settings').hotkey;
  globalShortcut.register(hotkey, () => toggleWindow());

  if (store.get('running')) startTickLoop();
  scheduleNextNudge();

  // Auto-show only on first run (no token yet) or if a timer is mid-flight.
  // Otherwise, stay out of the way — user summons via tray click or hotkey.
  setTimeout(async () => {
    const token = await getToken();
    if (!token || store.get('running')) showWindow();
  }, 400);

  // Warm the creatives index in the background so the first picker open is
  // instant even when the disk cache is stale or missing. Capability-gated:
  // boards without the creative column never trigger the paging pass.
  setTimeout(async () => {
    try {
      const boardId = store.get('boardId');
      if (!boardId) return;
      const cols = await getBoardCols(boardId);
      if (cols.creative) await listCreatives();
    } catch (e) {
      console.warn('creatives warm-up skipped:', (e as Error).message);
    }
  }, 2_000);
});

app.on('window-all-closed', () => {
  // Keep app alive on macOS — it's a menubar app, no windows is normal.
});

app.on('before-quit', () => {
  quitting = true; // let the close→hide interception stand down
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (tickInterval) clearInterval(tickInterval);
  if (nudgeTimeout) clearTimeout(nudgeTimeout);
});
