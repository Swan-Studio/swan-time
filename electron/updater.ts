// Update check + notify + background DMG download.
//
// macOS: the app is unsigned, so Squirrel.Mac refuses electron-updater's
// install path. We use electron-updater ONLY to check latest-mac.yml, then
// download the DMG ourselves and hand it to the user (shell.openPath mounts
// it with drag-to-Applications visible).
//
// Windows: unsigned installs work natively, so electron-updater handles
// download + install there; our "install" action is just quitAndInstall().
import { app, net, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'node:path';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pickDmgAsset, buildDownloadUrl, sha512Of, type UpdateAsset } from './updaterCore';

const OWNER = 'Swan-Studio';
const REPO = 'swan-time';
const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'downloading'; version: string }
  | { phase: 'ready'; version: string; dmgPath: string | null; fallbackUrl: string };

let state: UpdateState = { phase: 'idle' };
let notifyReady: ((version: string) => void) | null = null;

export function getUpdateState(): UpdateState {
  return state;
}

function updatesDir(): string {
  return path.join(app.getPath('userData'), 'updates');
}

function cleanUpdatesDir() {
  try {
    fs.rmSync(updatesDir(), { recursive: true, force: true });
  } catch (err) {
    console.warn('updater cleanup failed:', (err as Error).message);
  }
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await net.fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);
  await pipeline(
    Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream),
    fs.createWriteStream(dest)
  );
}

async function handleUpdateAvailable(version: string, files: UpdateAsset[]) {
  // Already downloading or holding this version — nothing to do. A NEWER
  // version mid-state falls through and restarts the download.
  if (state.phase !== 'idle' && state.version === version) return;

  const fallbackUrl = `https://github.com/${OWNER}/${REPO}/releases/latest`;
  const asset = pickDmgAsset(files);
  if (!asset) {
    // No DMG in the release (shouldn't happen) — still surface the update.
    state = { phase: 'ready', version, dmgPath: null, fallbackUrl };
    notifyReady?.(version);
    return;
  }

  state = { phase: 'downloading', version };
  const dest = path.join(updatesDir(), asset.url);
  try {
    cleanUpdatesDir(); // drop any older pending download
    fs.mkdirSync(updatesDir(), { recursive: true });
    await downloadTo(buildDownloadUrl(OWNER, REPO, version, asset.url), dest);
    if (asset.sha512 && (await sha512Of(dest)) !== asset.sha512) {
      throw new Error('sha512 mismatch');
    }
    state = { phase: 'ready', version, dmgPath: dest, fallbackUrl };
  } catch (err) {
    console.warn('updater download failed:', (err as Error).message);
    // Surface the update anyway; the install action opens the browser instead.
    state = { phase: 'ready', version, dmgPath: null, fallbackUrl };
  }
  notifyReady?.(version);
}

export async function installUpdate(): Promise<void> {
  if (state.phase !== 'ready') return;
  if (process.platform === 'win32') {
    autoUpdater.quitAndInstall();
    return;
  }
  if (state.dmgPath && fs.existsSync(state.dmgPath)) {
    await shell.openPath(state.dmgPath); // mounts the DMG
    // Give Finder a beat to mount, then quit so the bundle can be replaced.
    // Timer state is persisted in electron-store, so quitting is safe.
    setTimeout(() => app.quit(), 1000);
  } else {
    await shell.openExternal(state.fallbackUrl);
  }
}

export function setupUpdater(onReady: (version: string) => void): void {
  // Dev escape hatch: SWAN_TEST_UPDATES=1 npm run dev exercises the real
  // check/download flow against dev-app-update.yml in the project root.
  if (!app.isPackaged) {
    if (!process.env.SWAN_TEST_UPDATES) return;
    autoUpdater.forceDevUpdateConfig = true;
  } else {
    // Skip when no publish channel was baked in (local builds without publish).
    const updateConfig = path.join(process.resourcesPath, 'app-update.yml');
    if (!fs.existsSync(updateConfig)) return;
  }

  notifyReady = onReady;
  cleanUpdatesDir();

  autoUpdater.on('error', err => console.warn('updater error:', err.message));

  if (process.platform === 'win32') {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-downloaded', info => {
      state = { phase: 'ready', version: info.version, dmgPath: null, fallbackUrl: '' };
      notifyReady?.(info.version);
    });
  } else {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on('update-available', info => {
      void handleUpdateAvailable(info.version, info.files as UpdateAsset[]);
    });
  }

  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), FIRST_CHECK_DELAY_MS);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), CHECK_INTERVAL_MS);
}
