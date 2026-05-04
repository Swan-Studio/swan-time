# Swan Time

Mac menubar time tracker for Swan Studio. Posts entries to per-user Monday boards (e.g. "Dean Time Tracker").

## Setup

```bash
cd ~/swan-time
npm install
npm run rebuild   # rebuild keytar against Electron's Node ABI
```

### Configuration (.env.local)

Copy `.env.local.example` to `.env.local` and fill in:

- `SWAN_ANTHROPIC_KEY` — shared Anthropic key. When set, every user with AI enabled uses Swan's account by default. Per-user override is still available in Settings.
- `MONDAY_CLIENT_ID` / `MONDAY_CLIENT_SECRET` — optional OAuth. Skip and use the manual API token link instead.

The main process loads `.env.local` at startup automatically.

### For packaged builds

Before running `npm run package`, paste the Swan Anthropic key into `electron/sharedKey.ts` (gitignored). It gets bundled into the .asar. Anyone who unpacks the build can extract it — acceptable for internal team distribution only. Cap spend at the Anthropic console and rotate on suspected leak.

## Run (dev)

```bash
npm run dev
```

Vite serves the renderer on :5173 and Electron loads it. The dock icon is hidden — look for the tray icon in the menubar. Toggle the widget with **⌘+Shift+T**.

## Package

```bash
npm run package
```

Outputs a signed-style DMG to `release/`.

## How it maps to Monday

- Resolves your board by regex `^[FirstName]('s)?\s+time\s+tracker$`
- Writes to columns: `connect_boards_mkkz26ew` (Client), `person`, `date4`, `time_tracking_mkkz3eas`, `label_mkkz4cvz` (Division), `label_mkkznzsa` (Category)
- Time tracking column gets a single segment `{ startDate, endDate, status: 'active', manuallyEntered: true }`
- 1-min minimum, rounded up

## Keyboard

- `⌘+Shift+T` — toggle widget (global)
- `⌘+Enter` — start timer
- `⌘+,` — settings
- `Esc` — hide
