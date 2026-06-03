import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, screen, dialog, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
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
  listClients,
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

const isDev = !app.isPackaged;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let tickInterval: NodeJS.Timeout | null = null;
let nudgeTimeout: NodeJS.Timeout | null = null;
let widgetMode: 'compact' | 'batch' | 'nudge' = 'compact';
let lastBounds: Electron.Rectangle | null = null;

const COMPACT_SIZE = { width: 380, height: 480 };
const BATCH_SIZE = { width: 760, height: 560 };
const NUDGE_SIZE = { width: 380, height: 56 };

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
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.on('blur', () => {
    if (widgetMode === 'nudge') return; // nudges close only via 30s timer or expand; don't pollute lastBounds with nudge size
    if (win) lastBounds = win.getBounds();
    if (store.get('settings').closeOnBlur !== false) win?.hide();
  });
}

// Anchor a window of the given size near the tray icon. Default below; flip
// above when the tray sits in the lower half of the work area (Windows
// taskbar-at-bottom case). Always clamped inside workArea so the popover
// can't end up off-screen.
function placeNearTray(size: { width: number; height: number }): { x: number; y: number } | null {
  if (!tray) return null;
  const trayBounds = tray.getBounds();
  const work = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y }).workArea;
  const x = Math.round(
    Math.min(
      Math.max(trayBounds.x + trayBounds.width / 2 - size.width / 2, work.x + 8),
      work.x + work.width - size.width - 8
    )
  );
  const preferAbove = trayBounds.y + trayBounds.height / 2 > work.y + work.height / 2;
  const rawY = preferAbove ? trayBounds.y - size.height - 6 : trayBounds.y + trayBounds.height + 6;
  const y = Math.round(Math.min(Math.max(rawY, work.y + 8), work.y + work.height - size.height - 8));
  return { x, y };
}

function setWidgetMode(mode: 'compact' | 'batch' | 'nudge') {
  if (!win) return;
  widgetMode = mode;
  win.setResizable(mode === 'batch');
  if (mode === 'batch') {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const x = Math.round(display.workArea.x + (display.workArea.width - BATCH_SIZE.width) / 2);
    const y = Math.round(display.workArea.y + (display.workArea.height - BATCH_SIZE.height) / 2);
    win.setBounds({ x, y, ...BATCH_SIZE }, true);
    win.setAlwaysOnTop(false);
  } else {
    const size = mode === 'nudge' ? NUDGE_SIZE : COMPACT_SIZE;
    win.setAlwaysOnTop(true);
    const placement = placeNearTray(size);
    if (placement) {
      win.setBounds({ ...placement, ...size }, true);
    } else {
      win.setSize(size.width, size.height);
    }
  }
  win.webContents.send('widget:mode', mode);
}

function positionNearTray() {
  if (!win || !tray) return;
  const winBounds = win.getBounds();
  const placement = placeNearTray({ width: winBounds.width, height: winBounds.height });
  if (placement) win.setPosition(placement.x, placement.y, false);
}

function showWindow() {
  if (!win) return;
  // Sticky-widget mode: restore exact last bounds. Popover mode: re-anchor to tray.
  const sticky = store.get('settings').closeOnBlur === false;
  if (sticky && lastBounds) {
    win.setBounds(lastBounds);
  } else {
    positionNearTray();
  }
  win.show();
  win.focus();
  win.webContents.send('window:show');
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    showWindow();
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
    const menu = Menu.buildFromTemplate([
      { label: 'Show', click: () => showWindow() },
      {
        label: 'Batch entry…',
        accelerator: 'CommandOrControl+Shift+B',
        click: () => {
          showWindow();
          setWidgetMode('batch');
        }
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
  setWidgetMode('nudge');
  // showInactive avoids stealing focus from whatever they're working in.
  win.showInactive();
}

function scheduleNextNudge() {
  if (nudgeTimeout) clearTimeout(nudgeTimeout);
  const delay = Math.max(1000, nextNudgeFromNow().getTime() - Date.now());
  nudgeTimeout = setTimeout(() => {
    fireNudge();
    scheduleNextNudge();
  }, delay);
}

// Deterministic test-mode stats so the level UI can be inspected as a
// hypothetical seasoned user. Triggered when displayNameOverride is set.
const MOCK_CATEGORIES = [
  'Client Meeting',
  'Internal Meeting',
  'Research',
  'Scripting',
  'Editing',
  'Scheduling and Captioning',
  'Shooting',
  'Briefing',
  'Reviews',
  'Health Check',
  'Setup',
  'Production',
  'Pre-Production',
  'Post-Production',
  'Client Comms',
  'Other'
];

function mockStatsForName(name: string): {
  streak: number;
  categoryMinutes: Record<string, number>;
} {
  let seed = 0;
  for (let i = 0; i < name.length; i++) seed = (seed * 31 + name.charCodeAt(i)) | 0;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) | 0;
    return ((seed >>> 0) % 10000) / 10000;
  };
  const categoryMinutes: Record<string, number> = {};
  for (const c of MOCK_CATEGORIES) {
    const r = rand();
    // Most categories have meaningful time; ~10% sit at 0 to mimic real spread.
    const hours = r < 0.1 ? 0 : Math.floor(r * 220);
    categoryMinutes[c] = hours * 60;
  }
  const streak = 3 + Math.floor(rand() * 25);
  return { streak, categoryMinutes };
}

function registerIpc() {
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
  ipcMain.handle('monday:clients', () => listClients());
  ipcMain.handle('monday:creatives', () => listCreatives());
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
    if (!boardId) return { streak: 0, categoryMinutes: {} };
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

  ipcMain.handle('timer:stop', async () => {
    const cur = store.get('running');
    if (!cur) return { ok: false, error: 'No running timer' };
    if (!cur.division || !cur.category) return { ok: false, error: 'Need division + category' };
    const boardId = store.get('boardId');
    const userId = store.get('userId');
    if (!boardId || !userId) return { ok: false, error: 'Not authenticated' };

    const endedAt = Date.now();
    // Pass an effective startedAt so logEntry's (endedAt - startedAt) yields the
    // tracked duration minus any paused time.
    const effectiveMs = runningElapsedMs(cur);
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
    const clients = await listClients();
    return suggestCategory(name, { recents, clients: clients.map(c => c.name) });
  });
  ipcMain.handle('ai:summary', async () => {
    const boardId = store.get('boardId');
    if (!boardId) return 'Sign in first.';
    const entries = await todayEntries(boardId);
    return dailySummary(entries);
  });

  // Batch
  ipcMain.handle('batch:open', () => {
    showWindow();
    setWidgetMode('batch');
  });
  ipcMain.handle('batch:close', () => setWidgetMode('compact'));

  // Nudge
  ipcMain.handle('nudge:expand', () => {
    setWidgetMode('compact');
    win?.focus();
  });
  ipcMain.handle('nudge:close', () => {
    // Reset to compact size before hiding so the next show is the normal widget.
    setWidgetMode('compact');
    win?.hide();
  });

  ipcMain.handle('batch:parse', async (_e, text: string) => {
    const clients = await listClients();
    // Use LOCAL date — UTC was making "yesterday" off by a day for users in
    // AU/Asia timezones where the local day is ahead of UTC.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const primaryDivision = store.get('settings').primaryDivision;
    return parseBatch(text, { clients: clients.map(c => c.name), today, primaryDivision });
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

function setupAutoUpdater() {
  if (isDev) return;
  // No publish channel is configured (DMG distributed manually); skip the
  // updater entirely so it doesn't spam ENOENT for the missing app-update.yml.
  const updateConfig = path.join(process.resourcesPath, 'app-update.yml');
  if (!fs.existsSync(updateConfig)) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', err => console.warn('updater error:', err.message));
  autoUpdater.on('update-downloaded', info => {
    const choice = dialog.showMessageBoxSync({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Swan Time update ready',
      message: `Version ${info.version} downloaded.`,
      detail: 'Restart to install. Your timer state will be preserved.'
    });
    if (choice === 0) autoUpdater.quitAndInstall();
  });
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide();
  createWindow();
  createTray();
  registerIpc();
  setupAutoUpdater();

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

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (tickInterval) clearInterval(tickInterval);
  if (nudgeTimeout) clearTimeout(nudgeTimeout);
});
