# Swan Time — Rollout runbook

Single-page checklist for Dean. Everything else is automated. Stop at any step — partial setups still work, you just lose polish.

---

## ✅ Already done in code

- [x] App builds to a `.dmg` via `npm run package`
- [x] Auto-update plumbing (`electron-updater`) — checks GitHub Releases every 4 hours and prompts user to restart
- [x] Board picker fallback — when the firstName regex misses, user picks from a list once
- [x] AI shared key (`.env.local` → bundled into builds via `electron/sharedKey.ts`)
- [x] Landing page template (`landing/index.html`) — drop into Vercel/Cloudflare/Netlify as-is

---

## 🟡 What only you can do

These five steps unlock end-to-end self-serve installs. Each step is independent — do them in any order.

### 1. Register the Monday OAuth app  *(15 min)*

1. Go to **Monday → avatar → Developers → My Apps → Create App**
2. Set:
   - **App name**: Swan Time
   - **Redirect URI**: `swan-time://oauth/callback`
   - **Scopes**: `boards:read`, `boards:write`, `me:read`, `users:read`
3. Copy the **Client ID** and **Client Secret**
4. Paste into `~/swan-time/.env.local` (already gitignored):
   ```
   MONDAY_CLIENT_ID=...
   MONDAY_CLIENT_SECRET=...
   ```
5. For packaged builds, paste the same two lines into `electron/sharedKey.ts` (gitignored) — or set them in your CI environment if/when you set that up.

Once done: every employee just clicks "Sign in with Monday" — no manual API token needed.

### 2. Get an Apple Developer ID  *(2 days, $99/yr)*

Without this, employees see "macOS can't verify the developer" on first launch and have to right-click → Open. Workable but ugly.

1. Sign up at https://developer.apple.com/programs/
2. Create a **Developer ID Application** certificate (Xcode → Settings → Accounts → Manage Certificates)
3. Add to your local Keychain
4. Set in your shell when running `npm run package`:
   ```
   export CSC_NAME="Developer ID Application: Swan Studio (TEAMID)"
   export APPLE_ID=dean@swan.studio
   export APPLE_APP_SPECIFIC_PASSWORD=...   # generate at appleid.apple.com
   export APPLE_TEAM_ID=...
   ```
5. electron-builder will auto-sign + notarize. First build takes ~15 min for notarization.

### 3. Set up the GitHub repo  *(10 min)*

1. Create **private** repo at `github.com/swan-studio/swan-time` (or whatever org)
2. Push the code: `cd ~/swan-time && git init && git add . && git commit -m "initial" && git remote add origin git@github.com:swan-studio/swan-time.git && git push -u origin main`
3. If your org/repo name differs, update `package.json` → `"build" → "publish" → "owner"` and `"repo"`

### 4. Cut your first release  *(5 min)*

```
cd ~/swan-time
npm version patch                # bumps 1.0.0 → 1.0.1
GH_TOKEN=ghp_... npm run package -- --publish always
```

This builds the `.dmg`, uploads to GitHub Releases, generates `latest-mac.yml` (which the auto-updater reads).

The `GH_TOKEN` is a GitHub Personal Access Token with `repo` scope. Generate at github.com → Settings → Developer settings → PATs.

### 5. Host the landing page  *(5 min)*

The `landing/` folder has a static HTML page ready to deploy.

**Easiest**: install Vercel CLI, run `cd landing && npx vercel --prod`. Output is a public URL.

**Alternative**: drag the `landing/` folder into [Cloudflare Pages](https://pages.cloudflare.com/) or [Netlify Drop](https://app.netlify.com/drop).

After deploy, edit `landing/index.html` → bottom `<script>` → set `DOWNLOAD_URL` to:
```
https://github.com/swan-studio/swan-time/releases/latest/download/Swan-Time-1.0.0-universal.dmg
```
(replace `1.0.0` with your published version, or use the GitHub `/releases/latest` redirect).

---

## 🔁 Ongoing

When you ship a new version:

```
npm version patch  # or minor/major
GH_TOKEN=... npm run package -- --publish always
```

Every running copy of Swan Time auto-detects the update within 4 hours, downloads it in the background, and prompts the user to restart.

---

## Distribution Slack message template

> 🚀 **Swan Time is live**
>
> A floating timer that logs straight to your Monday board — no more clicking through rows. Press <kbd>⌘ ⇧ T</kbd> from anywhere.
>
> Install: https://swan-time.swan.studio
>
> Questions → me

---

## Troubleshooting

- **"App is damaged"** on first launch: the user is on macOS 13+ with a build that wasn't notarized. Right-click → Open works. Permanent fix: complete step 2 above.
- **Sign-in spinner hangs**: probably no `MONDAY_CLIENT_ID` baked in. Check the running build has it, or fall back to "Use a personal API token" in the Auth screen.
- **AI button greyed out in Batch**: AI off in Settings, or no key. The button itself tells you which.
- **No update detected**: confirm `package.json` version was actually bumped (`npm version patch`), and `latest-mac.yml` exists in the GitHub Release.
