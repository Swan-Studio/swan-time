# Swan Time — Update notify + auto-download design

**Date:** 2026-06-04
**Status:** Approved pending user review
**Approach:** electron-updater check-only + background DMG download, gentle reminder UI ("Approach C")

## Problem

Swan Time is distributed as a manually-shared DMG. Once a copy is installed there is
no way to tell the user a newer version exists, so old builds (with old Monday API
logic) linger indefinitely. `electron-updater` is already a dependency and
`setupAutoUpdater()` exists in `electron/main.ts`, but it is dormant: `package.json`
has `"publish": null`, so no `app-update.yml` is packaged and the setup bails early.

## Constraints & decisions

| Decision | Choice | Why |
|---|---|---|
| Code signing | None, not planned | No Apple Developer ID → Squirrel.Mac refuses unsigned installs → silent autoupdate impossible on macOS. Notify + manual drag-install instead. |
| Feed & hosting | GitHub Releases, public repo `Swan-Studio/swan-time` | Anonymous API access, no token baked into builds. Repo created 2026-06-04. |
| Enforcement | Gentle reminder only | Tray menu item + dismissible in-app banner. No dialogs, no nags, no version floor. |
| Key exposure | Accepted with spend cap | Public DMGs mean anyone can extract `SWAN_ANTHROPIC_KEY` + Monday client secret. Mitigation: monthly spend cap at console.anthropic.com, rotate on abuse. Monday secret risk low (redirect URI locked to `swan-time://`). |
| Secrets in history | Verified clean 2026-06-04 | `sharedKey.ts`, `mondayOAuth.ts`, `.env.local` never committed in any revision; no token patterns in history. Safe to push public. |

## Design

### 1. Publishing & feed

- `package.json` → `"publish": { "provider": "github", "owner": "Swan-Studio", "repo": "swan-time" }` (replaces `"publish": null`).
- Add a `zip` target alongside `dmg` for mac. Guarantees `latest-mac.yml` generation
  and future-proofs true autoupdate for when signing happens.
- Release flow unchanged from ROLLOUT.md: `npm version patch && GH_TOKEN=... npm run package -- --publish always`.

### 2. New module: `electron/updater.ts`

Extracts and replaces `setupAutoUpdater()` from `main.ts`.

State machine: `idle → checking → downloading → ready`.

- `autoUpdater.autoDownload = false` — electron-updater is used **only to check**
  (it reads `latest-mac.yml`); its install path is never invoked on macOS.
- On `update-available`: pick the `.dmg` entry from `updateInfo.files`, build the
  GitHub release download URL
  (`https://github.com/Swan-Studio/swan-time/releases/download/v<version>/<file>`),
  download via Electron `net` to `<userData>/updates/`, verify the **sha512 from
  the yml** against the downloaded file.
- On verified download → state `ready`, notify tray + renderer.
- Fallback: if download or checksum fails, still go `ready`, but the install action
  opens the browser download URL instead of a local file.
- Startup cleanup: delete files in `<userData>/updates/` not matching the current
  pending version.
- Cadence unchanged: first check 10 s after launch, then every 4 h.
- If a newer version appears mid-state, restart the download for the newest.
- **Windows:** electron-updater installs fine unsigned → keep the native path
  (`autoDownload = true`, `autoInstallOnAppQuit = true`). Same gentle UI; the
  action label is "Restart to update" and triggers `quitAndInstall()`.

Exports: `setupUpdater()`, `getUpdateState()`, `installUpdate()`,
`onUpdateReady(cb)` for main-process consumers.

### 3. UI — gentle, zero interruptions

- **Tray menu** (built per right-click in `createTray()`, `electron/main.ts`):
  when state is `ready`, prepend `⬇ Update available — v<X>` + separator.
  Click → `installUpdate()`.
- **Renderer banner:** main sends `update:ready` `{ version }` over IPC; preload
  exposes `onUpdateReady(cb)` and `installUpdate()` on the existing `window.swan`
  API; a slim dismissible banner appears in the app window. Dismissal is
  per-version, stored in renderer `localStorage`
  (`updateBannerDismissed = "<version>"`), so the banner returns for the
  *next* release.
- The existing `dialog.showMessageBoxSync` restart prompt is removed.

### 4. Install action (macOS)

`installUpdate()` → `shell.openPath(downloadedDmg)` (mounts DMG with
drag-to-Applications visible) → `app.quit()` after ~1 s so Finder can replace the
bundle cleanly. Timer state persists via electron-store, so quitting is safe —
consistent with the existing "your timer state will be preserved" promise.

### 5. Error handling

- All updater errors: `console.warn` + retry on next 4 h cycle (matches existing
  pattern). Never user-facing.
- Check requires network; offline is silently skipped.

### 6. Testing

- Dev: `autoUpdater.forceDevUpdateConfig = true` + a `dev-app-update.yml` pointing
  at the real repo, to exercise check → download → ready without packaging.
- One manual end-to-end: package a lower-version build, publish a higher version
  to GitHub Releases, confirm tray item + banner + DMG-open flow.
- Checksum-failure path: corrupt the cached file, confirm browser-URL fallback.

## Out of scope

- Silent autoupdate on macOS (needs Apple Developer ID; flipping
  `autoDownload = true` later upgrades this design without rework).
- Version floors / forced updates (user chose gentle-only).
- Linux targets.
