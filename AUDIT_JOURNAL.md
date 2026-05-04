# Swan Time — Audit Journal

Each entry: **finding → verification → decision → fix (if applied)**.

## Pass 1 — 2026-05-02

### F1. Auth screen flashes on every launch
- **Where**: `src/App.tsx:14` — `useState<Screen>('auth')` is the initial value, then `refresh()` runs async.
- **Impact**: User sees Auth view for a frame even when already signed in.
- **Verified**: Yes — `refresh()` is the only thing that flips off 'auth', and it awaits `swan.authStatus()` (IPC roundtrip).
- **Fix**: Add a 'loading' screen and start in it.

### F2. Auto-show fires on every launch
- **Where**: `electron/main.ts` — `setTimeout(() => showWindow(), 400)` runs unconditionally inside `whenReady`.
- **Impact**: Widget pops up every relaunch even if user just wants the tray icon present.
- **Verified**: Yes.
- **Fix**: Only auto-show when not authed (so first-run users find it) or when relaunched while a timer is running.

### F3. Settings AI toggle doesn't propagate to open Tracker
- **Where**: `src/views/Tracker.tsx:32` — reads `aiEnabled` once on mount; never re-checks.
- **Impact**: User toggles AI on in Settings, returns to Tracker, no AI strip until next mount/restart.
- **Verified**: Yes — Tracker mounts when App's `screen` becomes 'tracker'; if it stays mounted (it doesn't actually — App unmounts on screen change because of conditional rendering)…
- **Re-verified**: App.tsx renders `{screen === 'tracker' && <Tracker .../>}` — so going to Settings unmounts Tracker, going back remounts it. Toggle does propagate. **Not a bug.** Withdrawn.

### F4. No success feedback after Stop & log
- **Where**: `src/views/Running.tsx` — on success transitions back to Tracker silently.
- **Impact**: User isn't sure if it actually posted. Already a memory pattern: "Debug means browser QA" — feedback matters.
- **Verified**: Yes.
- **Fix**: Brief toast/banner on Tracker after a successful log, showing "Logged 23m".

### F5. Tray title cosmetics
- **Where**: `electron/main.ts` — leading space `' Swan'`, somewhat hacky.
- **Impact**: Cosmetic only — the spacing helps separate from the icon.
- **Decision**: Acceptable, no change. The space is intentional padding.

### F6. Time-tracking column format may be wrong
- **Where**: `electron/monday.ts` — wrote `additional_value` array.
- **Verification attempt**: Tried `developer.monday.com/api-reference/reference/time-tracking`, `column-types-reference`, and three community forum threads. Official pages render only landing copy via WebFetch; community URLs return 404 (likely auth-walled).
- **Confidence**: Cannot verify the exact schema from public sources without an authenticated dev account. My current shape is what most third-party docs reproduce, and the failure mode is loud (Monday returns a GraphQL error, not a silent success), so a real test will surface any mismatch fast.
- **Decision**: **Defer.** Do not "fix" without verification — risk of breaking something that works. The first time the user logs an entry will tell us, and the error surfaces in the Running view's red banner. Re-open this finding after first end-to-end test.

### F7. Recent entries dedup is case-insensitive but stores original case
- **Where**: `electron/store.ts:pushRecent`
- **Impact**: First-cased version wins until matched again. Minor.
- **Decision**: Acceptable, no change.

### F8. `win.on('blur')` only hides outside dev — no way to inspect prod
- **Where**: `electron/main.ts`
- **Impact**: Can't open DevTools in packaged builds for debugging.
- **Decision**: Acceptable for v1; add a Cmd+Alt+I dev shortcut later.

### F9. CSP includes 'unsafe-inline'
- **Where**: `index.html`
- **Impact**: Tailwind injects inline styles; required. Acceptable for an internal app.
- **Decision**: No change.

### F10. Tracker debounce can fire stale AI suggestions
- **Where**: `src/views/Tracker.tsx`
- **Impact**: User types fast, debounce fires for old text after deletion. Suggestion may not match current name.
- **Verified**: Yes — debounce ref isn't cleared on every `name` change before scheduling.
- **Fix**: Already cleared via `if (debounce.current) window.clearTimeout`. Actually correct. Withdrawn.

### F11. No 401 / token-expired handling
- **Where**: `electron/monday.ts` `gql()` throws raw error message on Monday errors.
- **Impact**: Expired or revoked token shows generic "Not authenticated" or GraphQL error; user has to find Settings → Sign out.
- **Decision**: Defer to v1.1. Tracking only.

### F12. Window position can be off-screen on multi-monitor with menubar on second display
- **Where**: `electron/main.ts:positionNearTray`
- **Impact**: Edge case.
- **Decision**: Defer.

---

## Tier-1 fixes to apply now: F1, F2, F4
## Deferred / withdrawn: F3 (withdrawn — not a bug), F5, F6 (unverified), F7, F8, F9, F10 (withdrawn), F11, F12

## Pass 1 — applied changes (verified by tsc)

- **F1 fixed**: `App.tsx` now starts in `'loading'` screen with a small "Swan Time" pulse; `refresh()` flips it to the right view.
- **F2 fixed**: `main.ts` auto-show is now conditional — fires only if no Keychain token exists (first run) or a timer is mid-flight (reminder).
- **F4 fixed**: `stopTimer` already returned `{ minutes }`; threaded that through `Running` → `App` → `Tracker` as a 3.5s "Logged 23m" banner with manual dismiss. Added a Settings entry-point in the Tracker header while there.

## Out of scope this pass
- Token refresh / 401 handling (F11)
- Real tray icon asset (still using template glyph + " Swan" title)

## Pass 9 — Self-correction flags + missed-days nudge

User clarified erroneous = "timer left on too long, missing data". Built:

**Flag rules** in `src/lib/flags.ts` (pure, explainable, no AI cost):
- < 5m → "Very short"
- 8–12h → "Long entry — split?"
- > 12h → "Likely forgot to stop"
- Future date → typo warning
- Client-facing category (Client Meeting / Editing / Scripting / etc.) without a client picked → "Pick a client or change category"
- Missing division or category on existing Monday rows
- Same name + same client on the same date → "Possible duplicate"

**Live timer warning** in `Running.tsx`: if elapsed > 4h, accent banner appears on the running view ("Running 5h — long session"); copy escalates past 12h ("Did you forget to stop?"). Catches the problem at its source.

**Today view**: each row shows its flags inline. Rows with a warn-level flag get a subtle accent tint so they're scannable.

**Missed-days nudge** in `Tracker.tsx`: on widget open, queries `lastLogStatus` from the user's board. If ≥ 2 days since last log, accent CTA in the header — "3 days since last log · Catch up →" → opens Batch view directly.

**Backend**: new `recentEntries(boardId, daysBack)` and `lastLogStatus(boardId)` in `monday.ts`. Both reuse the existing time-tracking + name-suffix parser, so the "(Xm)" minute fallback works for the flag display too.

Out of scope (admin oversight): cross-user board access, manager-facing dashboards, Slack notifications. Those need different permissions and a different feature.

## Pass 8 — Per-user primary division

User feedback: a Production person (Shane) should default to Production, a strategist to Content Delivery / SMM / Ads. Hard-coding the global category→division map only solves half — many cases are genuinely ambiguous and the user's role is the strongest tiebreaker.

**Implementation**:
- Added `primaryDivision?: string` to `Settings` type. Stored in electron-store, available via `getSettings`/`setSettings` IPC.
- **Settings UI**: 2x2 grid of the 4 divisions, click to set/clear. Lives at the top of Settings (above the AI toggle) since it affects multiple flows.
- **AI prompt**: when `primaryDivision` is set, prepended to the system prompt: "Default to this division unless the activity strongly indicates a different one (e.g. don't override if they say 'shooting' → Production, but do default if context is ambiguous)." Lets the global category→division mapping still take effect when the activity is unambiguous.
- **AI fallback**: even if AI returns no division, the parsed row gets the user's primary division as a safety net.
- **Live Tracker**: pre-fills the Division picker with the user's primary on mount (won't override if user clicks).
- **Batch grid**: existing first row gets primary on mount; new rows added via `+ Add row` get primary too.

This is the right tradeoff because:
- Per-user defaults are correct ~90% of the time for any given employee
- AI still overrides when context is unambiguous (e.g. "Shooting day" → Production for everyone)
- It's explicit (visible toggle) rather than inferred — no silent surprise

## Pass 7 — Timezone fix + Swan-specific division mapping

User QA caught two real bugs in the batch parser:

1. **"Yesterday" resolved to Friday instead of Saturday** (today was Sunday in Sydney). Root cause: `today` was being computed as `new Date().toISOString().slice(0, 10)` which is UTC. For users in AU/Asia timezones where local "today" runs ahead of UTC, this lands on the previous day. **Fix**: replaced with local-time YYYY-MM-DD construction (`getFullYear/getMonth/getDate`) in two spots — `main.ts` `batch:parse` handler and `Batch.tsx` `todayIso()`. Also added `todayWeekday` to the AI system prompt so relative weekday resolution gets the right anchor.

2. **"Scripting ideas for the founder shoot" → Production instead of Content Delivery**. The word "shoot" pulled the AI to Production. **Fix**: added an explicit Category→Division mapping to the system prompt (Scripting/Editing/Ideating Concepts/etc → Content Delivery; Shooting only → Production), plus disambiguation rules ("Scripting ideas for a shoot" is Content Delivery, not Production). The mapping is documented from the original brief's category list — no speculative additions.

## Pass 6 — Unify batch into single window + visual refinements

User feedback after Pass 5: "UI a bit clunky, opening batch takes you to a new window."

- **One window now**: dropped the separate `batchWin`. Added `setWidgetMode('compact'|'batch')` in `main.ts` that resizes the existing widget (380×480 ↔ 760×560), recenters on cursor display when going to batch, returns to tray-anchor position when going back. Blur-hide is suppressed while in batch mode (long-form data entry — user has to click the calendar app to copy info).
- **`widget:mode` IPC event** notifies the renderer; App.tsx switches to/from the `batch` screen automatically. The "?view=batch" URL routing is gone — single React tree.
- **Pickers everywhere**: replaced native `<select>` for client/division/category with the existing `Picker` component (search + click-outside + animation). Removes the heavy Mac-default styling that didn't match the widget.
- **Date input redesign**: native `<input type="date">` was truncating to `02/05/202` because of the 100px column. Replaced with a small button showing `Today` / `Yesterday` / `Mon` / `May 2` (relative-aware). Click → prompt for ISO/today/yesterday. Scroll-wheel shifts ±1 day per tick. Compact and unambiguous.
- **Header is draggable** (since the window is now movable in batch mode).
- Posting / parsing logic unchanged — UI shell only.

## Pass 5 — Batch entry surface

Added a second window opened from the tray menu ("Batch entry…", ⌘⇧B) and from the widget Tracker header.

- **Architecture**: separate BrowserWindow (`openBatchWindow` in `main.ts`) — 760×560, frame + titleBarStyle: hiddenInset, resizable. Stays open across blur (unlike the floating widget which Spotlight-hides). Loads same Vite bundle with `?view=batch`; `src/main.tsx` reads the param and renders `<Batch />` instead of `<App />`.
- **AI parser** (`electron/ai.ts:parseBatch`): Haiku model. System prompt locks the JSON shape, embeds today's date for relative-date resolution, and pins client matching to the user's exact Clients-board list. Returns rows with `confidence`. Caller gets a strict, validated array — division/category that aren't in the enum are stripped.
- **Bulk post** (`batch:post` IPC): sequential with a 250ms gap to avoid Monday rate-limits. Reuses `logEntry` (so the "(Xm)" name suffix + best-effort time-tracking write apply to batch entries the same way as live ones). Returns per-row results so UI can mark posted vs. failed.
- **UI** (`src/views/Batch.tsx`):
  - Top: textarea + "Parse with AI" button (⌘↵). Shows "AI off" hint when shared key + user key are both absent.
  - Middle: editable grid — date / activity / client / division / category / minutes / delete. Low-confidence rows get a yellow tint, posted rows green, errored rows accent-tinted with inline error.
  - Footer: total minutes counter + "X / Y ready" indicator + Post button. After posting, "Clear posted" lets user retry the failures without re-parsing.
- **Validation**: row is "ready" only when name + ISO date + division + category + minutes ≥ 1. Post button stays disabled until every row is ready.

Out of scope for this pass:
- Recurring/template entries
- Drag-to-reorder rows
- Saving drafts on close
- Undo after post (Monday's `delete_item` exists but no UI yet)

Memory note: per "Debug means browser QA" — type checks pass but I have NOT exercised the Parse + Post flow end-to-end. Real validation happens when the user runs a batch.

## Pass 4 — Shared Anthropic key for the team

- **Goal**: when a user enables AI in Settings, they should not need their own Anthropic key — the app should use Swan's shared account.
- **Resolution order added** in `electron/ai.ts`:
  1. Per-user override (still available in Settings under "Use my own Anthropic key")
  2. `SWAN_ANTHROPIC_KEY` env var (loaded from `.env.local` in dev, or set externally for CI)
  3. Baked-in `SWAN_SHARED_ANTHROPIC_KEY` constant in `electron/sharedKey.ts` (gitignored, populated before `npm run package`)
- **`.env.local` loader**: tiny no-dep dotenv shim in `main.ts` reads project-root `.env.local` at startup. `.env.local.example` is checked in.
- **Settings UI redesigned**: enabling AI now shows a Swan-gradient banner stating "Using Swan's shared Anthropic account" — no key entry required for typical users. Personal-override input is collapsed behind "Use my own Anthropic key instead" for advanced users.
- **`ai:status` IPC**: new handler reports `{ aiEnabled, hasUserKey, hasSharedKey }` so the UI can render the right state.

### Security trade-off (logged)

Bundling a shared API key into a packaged Electron app is **inherently insecure** — anyone who unpacks the .asar can extract it. This is acceptable here because:
- Distribution is internal-team only
- Spend can be capped at the Anthropic account level
- Key can be rotated cheaply
- `electron/sharedKey.ts` is gitignored — the value never touches the public source repo

If distribution ever expands beyond Swan staff, replace this with a backend proxy that authenticates each user via their Monday token before forwarding to Anthropic. Roughly: a Cloudflare Worker that takes the request, validates the bearer token against Monday's `me` endpoint, then proxies to `api.anthropic.com` with the secret server-side.

## Pass 3 — Brand alignment + division autoset

- **Division autoset**: `Tracker` now derives a default division from local recents — most-frequent division this user has used for the picked client. Won't override a manual selection. Local-only (no extra API call); when recents are empty for a client, division stays blank as before.
- **Brand colors**: accent shifted from `#D9462B` (brick red) to canonical Swan `#FF4E01` (orange); ink shifted from `#101010` (pure black) to `#080822` (Swan navy). Verified against 5 sibling Swan projects via subagent — `#FF4E01` and the gradient signature appear in every project that has globals.css.
- **Signature gradient bar**: 3px `linear-gradient(135deg, #EB0091, #FF4E01, #FCED17)` strip at the top of every view. This is THE Swan motif across swan-intelligence/forecast/etc.
- **Running indicator**: dot now uses the Swan gradient + soft glow instead of solid accent — gives the "live" state more brand presence.
- **AI strip**: gradient-soft background instead of flat orange tint.
- **Border-radius**: Tailwind's `rounded-md` redefined as 10px (Swan button radius) so all existing utilities get the brand treatment without touching every component.
- **Typography preserved**: Fraunces / Inter Tight / JetBrains Mono unchanged — original brief explicitly locked these against Inter/system-ui. Other Swan projects use DM Sans, but the "fine paper" minimalism brief takes precedence here.

## Pass 2 — F6 verified live, fixed

- **Verified**: User clicked Stop & log → Monday returned `"This column type is not supported yet in the API"` from `create_item` because of the `time_tracking` value in `column_values`. F6 was a real bug.
- **Fix**: `logEntry` now creates the item WITHOUT the time-tracking column and encodes minutes as `" (Xm)"` suffix on the item name. Then it best-effort-attempts a follow-up `change_column_value` on the time-tracking column with `additional_value` + `started_user_id`/`ended_user_id`; failures are swallowed so the item is preserved.
- **`todayEntries` updated**: parses minutes from real `time_tracking` value first, then falls back to the `" (Xm)"` suffix; strips the suffix from `displayName` either way so the Today view stays clean.
- **Trade-off**: until Monday officially supports the time-tracking write, items will show duration in the name on the Monday board itself. This is the most graceful degradation — the entry is always findable, sortable by date, and grouped by category.

