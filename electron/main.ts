import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, screen, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'node:path';
import fs from 'node:fs';
import { store, pushRecent } from './store';

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
import { setupProtocolHandler, startOAuth, getToken, clearToken, setManualToken } from './oauth';
import {
  whoAmI,
  findUserBoard,
  listClients,
  listTimeTrackerBoards,
  logEntry,
  todayEntries,
  recentEntries,
  lastLogStatus,
  deleteEntry
} from './monday';
import { suggestCategory, dailySummary, aiStatus, parseBatch } from './ai';

const isDev = !app.isPackaged;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let tickInterval: NodeJS.Timeout | null = null;
let widgetMode: 'compact' | 'batch' = 'compact';

const COMPACT_SIZE = { width: 380, height: 480 };
const BATCH_SIZE = { width: 760, height: 560 };

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
    // Stay open in batch mode — user will switch apps to copy info.
    if (widgetMode === 'batch') return;
    if (!isDev) win?.hide();
  });
}

function setWidgetMode(mode: 'compact' | 'batch') {
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
    win.setAlwaysOnTop(true);
    if (tray) {
      const trayBounds = tray.getBounds();
      const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
      const x = Math.round(
        Math.min(
          Math.max(trayBounds.x + trayBounds.width / 2 - COMPACT_SIZE.width / 2, display.workArea.x + 8),
          display.workArea.x + display.workArea.width - COMPACT_SIZE.width - 8
        )
      );
      const y = Math.round(trayBounds.y + trayBounds.height + 6);
      win.setBounds({ x, y, ...COMPACT_SIZE }, true);
    } else {
      win.setSize(COMPACT_SIZE.width, COMPACT_SIZE.height);
    }
  }
  win.webContents.send('widget:mode', mode);
}

function positionNearTray() {
  if (!win || !tray) return;
  const trayBounds = tray.getBounds();
  const winBounds = win.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const x = Math.round(
    Math.min(
      Math.max(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2, display.workArea.x + 8),
      display.workArea.x + display.workArea.width - winBounds.width - 8
    )
  );
  const y = Math.round(trayBounds.y + trayBounds.height + 6);
  win.setPosition(x, y, false);
}

function showWindow() {
  if (!win) return;
  positionNearTray();
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
  // 16x16 template PNG: filled black circle on transparent background.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA' +
      'YElEQVQ4jc2SwQ3AIAhFXyfo/iN1kHaCuoEnE2NtEW2T+i8E' +
      '4QGCKY/STGYBmiZbAfCgB4GU0bj5qQAVA0wOyGZmOxhJrsBO' +
      'r3YA0lW6VR+w5gC6P8Bf/8AbPJfwAA1IBQVPTvwwAAAAAElF' +
      'TkSuQmCC',
    'base64'
  );
  const img = nativeImage.createFromBuffer(png);
  img.setTemplateImage(true);
  return img;
}

function createTray() {
  tray = new Tray(buildTrayIcon());
  tray.setToolTip('Swan Time — ⌘⇧T');
  tray.setTitle(' Swan'); // always-visible label until a real icon ships
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
      { label: 'Sign out', click: async () => { await clearToken(); store.clear(); } },
      { label: 'Quit Swan Time', role: 'quit' }
    ]);
    tray?.popUpContextMenu(menu);
  });
  refreshTrayTitle();
}

function refreshTrayTitle() {
  if (!tray) return;
  const running = store.get('running');
  if (!running) {
    tray.setTitle(' Swan');
    return;
  }
  const elapsed = Math.floor((Date.now() - running.startedAt) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  tray.setTitle(` ● ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
}

function startTickLoop() {
  if (tickInterval) clearInterval(tickInterval);
  tickInterval = setInterval(() => {
    const running = store.get('running');
    if (!running) return;
    const seconds = Math.floor((Date.now() - running.startedAt) / 1000);
    win?.webContents.send('timer:tick', seconds);
    refreshTrayTitle();
  }, 1000);
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
    store.delete('boardId');
    return { authed: false };
  });

  // Monday
  ipcMain.handle('monday:clients', () => listClients());
  ipcMain.handle('monday:listTimeTrackerBoards', () => listTimeTrackerBoards());
  ipcMain.handle('monday:setBoard', (_e, boardId: number, boardName?: string) => {
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
  ipcMain.handle('monday:delete', (_e, id: number) => deleteEntry(id));

  // Timer
  ipcMain.handle('timer:get', () => store.get('running'));

  ipcMain.handle('timer:start', (_e, payload: any) => {
    store.set('running', {
      startedAt: Date.now(),
      name: payload.name,
      clientId: payload.clientId,
      clientName: payload.clientName,
      division: payload.division,
      category: payload.category
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

  ipcMain.handle('timer:stop', async () => {
    const cur = store.get('running');
    if (!cur) return { ok: false, error: 'No running timer' };
    if (!cur.division || !cur.category) return { ok: false, error: 'Need division + category' };
    const boardId = store.get('boardId');
    const userId = store.get('userId');
    if (!boardId || !userId) return { ok: false, error: 'Not authenticated' };

    const endedAt = Date.now();
    const result = await logEntry({
      boardId,
      userId,
      name: cur.name,
      clientId: cur.clientId,
      division: cur.division,
      category: cur.category,
      startedAt: cur.startedAt,
      endedAt
    });
    pushRecent({
      name: cur.name,
      clientId: cur.clientId,
      clientName: cur.clientName,
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
    const recents = store.get('recents').map(r => r.name);
    return suggestCategory(name, recents);
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
          division: row.division,
          category: row.category,
          startedAt,
          endedAt
        });
        pushRecent({
          name: row.name,
          clientId: row.clientId,
          clientName: row.clientName,
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
}

async function resolveUser() {
  const me = await whoAmI();
  store.set('userId', Number(me.id));
  store.set('userName', me.name);
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
  // Initial check after the window has settled, then every 4 hours.
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide();
  setupProtocolHandler();
  createWindow();
  createTray();
  registerIpc();
  setupAutoUpdater();

  const hotkey = store.get('settings').hotkey;
  globalShortcut.register(hotkey, () => toggleWindow());

  if (store.get('running')) startTickLoop();

  // Auto-show only on first run (no token yet) or if a timer is mid-flight.
  // Otherwise, stay out of the way — user summons via tray click or hotkey.
  setTimeout(async () => {
    const token = await getToken();
    if (!token || store.get('running')) showWindow();
  }, 400);
});

app.on('window-all-closed', () => {
  // Keep app alive on macOS — it's a menubar app, no windows is normal.
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (tickInterval) clearInterval(tickInterval);
});
