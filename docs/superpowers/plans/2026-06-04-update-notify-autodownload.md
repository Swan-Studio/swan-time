# Update Notify + Auto-Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a newer Swan Time release exists on GitHub, gently surface it (tray menu item + dismissible in-app banner), background-download the DMG, and let one click mount it for drag-install.

**Architecture:** `electron-updater` is used check-only on macOS (unsigned apps can't silent-install); we download the DMG ourselves via Electron `net`, verify sha512 from `latest-mac.yml`, and `shell.openPath` it on click. Windows keeps electron-updater's native install (works unsigned). Pure logic lives in `electron/updaterCore.ts` (unit-tested); Electron wiring in `electron/updater.ts`.

**Tech Stack:** Electron 31, electron-updater 6, electron-builder 24 (GitHub provider), vitest (new devDep), React renderer.

**Spec:** `docs/superpowers/specs/2026-06-04-auto-update-design.md`

**File map:**
| File | Action | Responsibility |
|---|---|---|
| `electron/updaterCore.ts` | Create | Pure helpers: pick DMG asset, build download URL, sha512 — no Electron imports |
| `tests/updaterCore.test.ts` | Create | Unit tests for the above |
| `electron/updater.ts` | Create | State machine, check schedule, download, install action, Windows path |
| `electron/main.ts` | Modify | Remove old `setupAutoUpdater` (lines ~698–721), wire new module: tray item, IPC, push event |
| `electron/preload.ts` | Modify | Expose `updateStatus`, `installUpdate`, `onUpdateReady` |
| `src/App.tsx` | Modify | Dismissible bottom banner |
| `package.json` | Modify | `publish` config, mac `zip` target, vitest, `test` script |
| `dev-app-update.yml` | Create | Dev-mode updater feed config for manual testing |
| `ROLLOUT.md` | Modify | Reflect repo creation + new update UX |

---

### Task 1: Test infrastructure (vitest)

**Files:**
- Modify: `package.json` (scripts + devDependencies)

- [ ] **Step 1: Install vitest**

```bash
cd "/Users/jake/Documents/Urban Swan/swan-time"
npm install -D vitest@^3
```

- [ ] **Step 2: Add test script**

In `package.json` `"scripts"`, after the `"rebuild"` entry, add:

```json
"test": "vitest run"
```

- [ ] **Step 3: Verify vitest runs (no tests yet → exits cleanly)**

Run: `npm test`
Expected: "No test files found" with exit code 1 — that's fine; confirms the runner works. (It goes green in Task 2.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest test runner"
```

---

### Task 2: Pure updater helpers (TDD)

**Files:**
- Create: `electron/updaterCore.ts`
- Test: `tests/updaterCore.test.ts`

Note: `tests/` lives at the repo root, OUTSIDE `electron/`, so `tsc -p electron/tsconfig.json` (which includes `electron/**/*.ts` and emits to `dist-electron/`) never compiles test files into the app bundle.

- [ ] **Step 1: Write the failing tests**

Create `tests/updaterCore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pickDmgAsset, buildDownloadUrl, sha512Of } from '../electron/updaterCore';

describe('pickDmgAsset', () => {
  it('picks the .dmg entry when zip and dmg are both listed', () => {
    const files = [
      { url: 'Swan-Time-1.0.7-universal-mac.zip', sha512: 'zzz' },
      { url: 'Swan-Time-1.0.7-universal.dmg', sha512: 'ddd' }
    ];
    expect(pickDmgAsset(files)).toEqual({ url: 'Swan-Time-1.0.7-universal.dmg', sha512: 'ddd' });
  });

  it('matches case-insensitively', () => {
    expect(pickDmgAsset([{ url: 'App.DMG' }])).toEqual({ url: 'App.DMG' });
  });

  it('returns undefined when no dmg is listed', () => {
    expect(pickDmgAsset([{ url: 'Swan-Time-1.0.7-universal-mac.zip' }])).toBeUndefined();
  });
});

describe('buildDownloadUrl', () => {
  it('builds the GitHub release asset URL with v-prefixed tag', () => {
    expect(
      buildDownloadUrl('Swan-Studio', 'swan-time', '1.0.7', 'Swan-Time-1.0.7-universal.dmg')
    ).toBe(
      'https://github.com/Swan-Studio/swan-time/releases/download/v1.0.7/Swan-Time-1.0.7-universal.dmg'
    );
  });

  it('URL-encodes unusual file names', () => {
    expect(buildDownloadUrl('o', 'r', '1.0.0', 'a b.dmg')).toBe(
      'https://github.com/o/r/releases/download/v1.0.0/a%20b.dmg'
    );
  });
});

describe('sha512Of', () => {
  it('returns the base64 sha512 of file contents', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'swan-test-'));
    const file = path.join(dir, 'blob.bin');
    writeFileSync(file, 'hello swan');
    const expected = createHash('sha512').update('hello swan').digest('base64');
    await expect(sha512Of(file)).resolves.toBe(expected);
  });

  it('rejects for a missing file', async () => {
    await expect(sha512Of('/nonexistent/nope.bin')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../electron/updaterCore'` (or equivalent resolve error).

- [ ] **Step 3: Implement `electron/updaterCore.ts`**

```ts
// Pure helpers for the updater — no Electron imports, so these are unit-testable
// under plain Node (see tests/updaterCore.test.ts).
import fs from 'node:fs';
import crypto from 'node:crypto';

export interface UpdateAsset {
  url: string; // file name as listed in latest-mac.yml, e.g. "Swan-Time-1.0.7-universal.dmg"
  sha512?: string; // base64
}

export function pickDmgAsset(files: UpdateAsset[]): UpdateAsset | undefined {
  return files.find(f => f.url.toLowerCase().endsWith('.dmg'));
}

export function buildDownloadUrl(owner: string, repo: string, version: string, fileName: string): string {
  return `https://github.com/${owner}/${repo}/releases/download/v${version}/${encodeURIComponent(fileName)}`;
}

export function sha512Of(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    fs.createReadStream(filePath)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')))
      .on('error', reject);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 7 tests green.

- [ ] **Step 5: Verify electron build still compiles**

Run: `npm run build:electron`
Expected: clean exit; `dist-electron/updaterCore.js` exists.

- [ ] **Step 6: Commit**

```bash
git add electron/updaterCore.ts tests/updaterCore.test.ts
git commit -m "feat: pure updater helpers (asset pick, download URL, sha512)"
```

---

### Task 3: Updater wiring module

**Files:**
- Create: `electron/updater.ts`

This module is Electron-bound (app lifecycle, net, shell) so it has no unit tests; it's exercised by the manual verification in Task 7.

- [ ] **Step 1: Create `electron/updater.ts`**

```ts
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
```

- [ ] **Step 2: Create `dev-app-update.yml`** (project root — used only with `SWAN_TEST_UPDATES=1`)

```yaml
provider: github
owner: Swan-Studio
repo: swan-time
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build:electron`
Expected: clean exit; `dist-electron/updater.js` exists.

- [ ] **Step 4: Commit**

```bash
git add electron/updater.ts dev-app-update.yml
git commit -m "feat: updater state machine with background DMG download"
```

---

### Task 4: main.ts integration

**Files:**
- Modify: `electron/main.ts` (import line 1–2, `createTray()` at ~194, `registerIpc()` at ~335, `setupAutoUpdater` at ~698–721, call at ~728)

- [ ] **Step 1: Swap imports**

Line 1: remove `dialog` from the electron import (its only use is in the function being deleted):

```ts
import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, nativeImage, screen, shell } from 'electron';
```

Line 2: replace `import { autoUpdater } from 'electron-updater';` with:

```ts
import { setupUpdater, getUpdateState, installUpdate } from './updater';
```

- [ ] **Step 2: Delete the old `setupAutoUpdater()` function** (the whole block from `function setupAutoUpdater() {` through its closing `}`, currently lines 698–721 — including the `dialog.showMessageBoxSync` restart prompt).

- [ ] **Step 3: Replace the call in `app.whenReady()`**

Change `setupAutoUpdater();` to:

```ts
setupUpdater(version => {
  win?.webContents.send('update:ready', version);
});
```

- [ ] **Step 4: Add the tray menu item**

In `createTray()`, replace the `tray.on('right-click', …)` handler body so the template is prefixed with a conditional update item:

```ts
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
```

(Only the `updateItems` prefix is new — the rest of the template is unchanged from the current code.)

- [ ] **Step 5: Add IPC handlers**

At the top of `registerIpc()` (line ~335), before the `// Auth` block, add:

```ts
// Updates
ipcMain.handle('update:status', () => getUpdateState());
ipcMain.handle('update:install', () => installUpdate());
```

- [ ] **Step 6: Verify it compiles**

Run: `npm run build:electron`
Expected: clean exit, no TS errors (a leftover `autoUpdater`/`dialog` reference would fail here).

- [ ] **Step 7: Commit**

```bash
git add electron/main.ts
git commit -m "feat: wire updater into tray menu and IPC, drop blocking restart dialog"
```

---

### Task 5: Preload API + renderer banner

**Files:**
- Modify: `electron/preload.ts` (api object, ~line 60 and events at ~68)
- Modify: `src/App.tsx` (state ~line 33, effects ~line 97, JSX after the `boardWarning` block at ~119)

- [ ] **Step 1: Extend preload API**

In `electron/preload.ts`, after the `// Window` section (`hide`/`quit`), add:

```ts
// Updates
updateStatus: () => ipcRenderer.invoke('update:status'),
installUpdate: () => ipcRenderer.invoke('update:install'),
```

And in the `// Events` section, after `onWidgetMode`, add:

```ts
onUpdateReady: (cb: (version: string) => void): (() => void) => {
  const handler = (_: unknown, v: string) => cb(v);
  ipcRenderer.on('update:ready', handler);
  return () => {
    ipcRenderer.off('update:ready', handler);
  };
}
```

(Remember the comma after the `onWidgetMode` closing brace.)

- [ ] **Step 2: Add banner state + subscription to `src/App.tsx`**

Below the existing `const [lastLog, …]` state declaration, add:

```ts
const [updateVersion, setUpdateVersion] = useState<string | null>(null);
```

Below the existing keyboard-shortcut `useEffect` (ends ~line 109), add:

```ts
useEffect(() => {
  function showUpdateBanner(version: string) {
    if (localStorage.getItem('updateBannerDismissed') === version) return;
    setUpdateVersion(version);
  }
  swan.updateStatus().then((s: { phase: string; version?: string }) => {
    if (s.phase === 'ready' && s.version) showUpdateBanner(s.version);
  });
  return swan.onUpdateReady(showUpdateBanner);
}, []);
```

- [ ] **Step 3: Add the banner JSX**

Immediately after the `boardWarning` block (closes at line ~119), add:

```tsx
{updateVersion && screen !== 'loading' && screen !== 'nudge' && (
  <div className="absolute bottom-0 inset-x-0 px-4 py-1.5 bg-accent/10 text-[10px] z-50 flex items-center justify-between">
    <span className="text-accent">Update ready — v{updateVersion}</span>
    <span className="flex items-center gap-2">
      <button className="text-accent underline" onClick={() => swan.installUpdate()}>
        Install
      </button>
      <button
        className="text-mute"
        aria-label="Dismiss update banner"
        onClick={() => {
          localStorage.setItem('updateBannerDismissed', updateVersion);
          setUpdateVersion(null);
        }}
      >
        ✕
      </button>
    </span>
  </div>
)}
```

Bottom-anchored so it never collides with the top `boardWarning` banner; hidden in the tiny `nudge` layout. Dismissal is per-version: `updateBannerDismissed` stores the dismissed version string, so the next release shows the banner again (per spec §3).

- [ ] **Step 4: Verify both builds compile**

Run: `npm run build`
Expected: vite build + tsc both clean.

- [ ] **Step 5: Commit**

```bash
git add electron/preload.ts src/App.tsx
git commit -m "feat: update-ready banner in renderer with per-version dismissal"
```

---

### Task 6: Publish config + zip target

**Files:**
- Modify: `package.json` (`build.mac.target`, `build.publish`)

- [ ] **Step 1: Add the zip target** (guarantees `latest-mac.yml` generation; future-proofs signed autoupdate)

In `build.mac.target`, change:

```json
"target": [
  { "target": "dmg", "arch": ["universal"] },
  { "target": "zip", "arch": ["universal"] }
]
```

- [ ] **Step 2: Set the publish feed**

Replace `"publish": null` with:

```json
"publish": {
  "provider": "github",
  "owner": "Swan-Studio",
  "repo": "swan-time"
}
```

(The `package` scripts keep `--publish never`, so local packaging never uploads; releases use `npm run package -- --publish always` per ROLLOUT.md.)

- [ ] **Step 3: Packaging smoke test**

Run: `npm run package`
Expected: `release/Swan-Time-1.0.6-universal.dmg` and `…-mac.zip` built. Verify the updater config is now bundled:

```bash
ls "release/mac-universal/Swan Time.app/Contents/Resources/app-update.yml"
```

Expected: file exists and contains `owner: Swan-Studio`.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat: publish to Swan-Studio/swan-time GitHub releases, add mac zip target"
```

---

### Task 7: Manual verification (dev harness)

No files — exercises the real check → download → ready flow. **Requires at least one published GitHub release**; if none exists yet, do Task 8 first, cut the v1.0.7 release, then return here.

- [ ] **Step 1: Simulate an old install**

Temporarily edit `package.json` `"version"` to `"0.9.0"` (do NOT commit this).

- [ ] **Step 2: Run with the dev updater enabled**

```bash
SWAN_TEST_UPDATES=1 npm run dev
```

Expected within ~15 s of window appearing:
- Terminal: no `updater error:` lines
- File appears: `ls ~/Library/Application\ Support/swan-time/updates/` → one `.dmg`
- App window: bottom banner "Update ready — v1.0.7 · Install ✕"
- Tray right-click: top item "⬇ Update available — v1.0.7"

- [ ] **Step 3: Test install action**

Click **Install** → the DMG mounts in Finder with drag-to-Applications, app quits ~1 s later.

- [ ] **Step 4: Test dismissal**

Relaunch (`SWAN_TEST_UPDATES=1 npm run dev`), wait for banner, click ✕ → banner gone. Relaunch again → banner stays gone (same version dismissed). Tray item still present (dismissal only hides the banner).

- [ ] **Step 5: Test checksum-failure fallback**

While in `downloading` state is hard to catch; instead corrupt after the fact: edit `electron/updater.ts` temporarily to append `+ 'x'` to the expected sha512 comparison, rerun — expected: terminal logs `updater download failed: sha512 mismatch`, banner still appears, Install opens the GitHub releases page in the browser. **Revert the temporary edit.**

- [ ] **Step 6: Restore version**

Revert `package.json` version to its real value: `git checkout package.json` would lose Task 6 work if uncommitted — Task 6 is already committed, so `git checkout -- package.json` is safe. Verify with `git diff` (clean) and `grep '"version"' package.json`.

---

### Task 8: ROLLOUT.md + push to GitHub

**Files:**
- Modify: `ROLLOUT.md`

- [ ] **Step 1: Update ROLLOUT.md**

- In **"✅ Already done in code"**, replace the auto-update bullet with:
  `- [x] Update notify + auto-download — checks GitHub Releases every 4 hours, downloads the DMG in the background, and shows a gentle tray item + in-app banner (no forced dialogs). Windows builds true-autoupdate.`
- Add to the same list: `- [x] GitHub repo created: https://github.com/Swan-Studio/swan-time (public — history scanned clean of secrets 2026-06-04)`
- In **"### 3. Set up the GitHub repo"**, replace the body with: repo already exists at `Swan-Studio/swan-time`; remaining step is just `git remote add origin git@github.com:Swan-Studio/swan-time.git && git push -u origin main`.
- In **"### 5. Host the landing page"**, update the example download URL owner to `Swan-Studio`.
- In **Troubleshooting**, replace the "No update detected" entry's fix with: confirm `npm version patch` was run and `latest-mac.yml` exists in the GitHub Release; the in-app reminder appears within 4 h (or relaunch the app to check within 10 s).

- [ ] **Step 2: Commit**

```bash
git add ROLLOUT.md
git commit -m "docs: rollout notes for GitHub releases + gentle update reminders"
```

- [ ] **Step 3: Push to the public repo** (history already verified clean of secrets — see spec)

```bash
git remote add origin git@github.com:Swan-Studio/swan-time.git
git push -u origin main
```

Expected: `main` visible at https://github.com/Swan-Studio/swan-time

Note: `electron/monday.ts` has uncommitted local changes unrelated to this feature — they stay local; do not commit them as part of this plan.

- [ ] **Step 4: Cut the first release** (enables Task 7 verification and arms the updater for every install)

```bash
npm version patch   # 1.0.6 → 1.0.7
GH_TOKEN=<PAT with repo scope> npm run package -- --publish always
git push && git push --tags
```

Expected: GitHub release `v1.0.7` with `Swan-Time-1.0.7-universal.dmg`, `…-mac.zip`, and `latest-mac.yml`.

---

## Verification checklist (after all tasks)

- [ ] `npm test` — green
- [ ] `npm run build` — clean
- [ ] Task 7 manual flow completed against a real release
- [ ] Spec requirements each mapped: feed (Task 6), check-only mac + download + sha512 + fallback + cleanup + Windows native (Task 3), tray + banner + per-version dismissal + no dialog (Tasks 4–5), DMG mount + quit (Task 3), dev-test harness (Tasks 3, 7)
- [ ] User follow-up (outside repo): set Anthropic spend cap at console.anthropic.com
