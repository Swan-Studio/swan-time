# Widget mode management + AI creative chooser

**Date:** 2026-06-05
**Status:** Approved (Jake, in-session)

Two coupled pieces of work:

1. Reliable widget window height/mode management (fixes two shipped bugs).
2. AI creative suggestion offers a choice when the match is ambiguous (dropdown
   in the Tracker AI strip), backed by fuzzier creative shortlisting.

## Part 1 — Window mode management

### Bugs being fixed

- **Stuck nudge chip:** with the nudge banner visible, opening the widget via
  tray click or hotkey shows the window at nudge size (380×56) with the
  renderer still on the nudge screen. `showWindow()`/`toggleWindow()` never
  reset `widgetMode`.
- **Grow-then-close:** nudge "×" runs `setWidgetMode('compact')` (animated
  `setBounds`) *before* `win.hide()`, so the window visibly balloons to 480px
  and then vanishes.

Root cause: window geometry is mutated by scattered `setBounds`/`setSize`
calls; mode state lives independently in main (`widgetMode`) and the renderer
(`screen`), and some paths bypass the mode system entirely.

### Design

One function owns all geometry and visibility transitions:

```ts
applyWidgetMode(mode: 'compact' | 'batch' | 'nudge',
                opts?: { show?: boolean; focus?: boolean; showInactive?: boolean })
```

- Computes target bounds via a **pure helper** `targetBoundsFor(mode,
  trayBounds, workArea, cursorPoint)` (unit-testable; same placement rules as
  today: batch centered on cursor display, compact/nudge tray-anchored and
  clamped to the work area).
- **Invariant 1 — every show declares its mode.** Tray click / hotkey →
  `applyWidgetMode('compact', { show: true, focus: true })`. Nudge fire →
  `applyWidgetMode('nudge', { showInactive: true })`. Batch open →
  `applyWidgetMode('batch', { show: true, focus: true })`. Showing the window
  without a mode is no longer possible.
- **Invariant 2 — resizes never animate.** All `setBounds` calls pass
  `animate: false`. Visible mode morphs (nudge → expand) snap instantly.
- **Invariant 3 — hide first, resize second.** New `hideWindow()`: hide, then
  reset bounds to compact while invisible, then send `widget:mode compact`.
  Nudge "×" and blur-close route through it. The next show is always
  pre-sized.
- **Renderer screen is derived state.** App.tsx sets `screen` only from
  `widget:mode` events. Every show emits a mode, so the renderer cannot
  disagree with the window's real size. Sticky-widget mode (closeOnBlur ===
  false) keeps restoring the last *position*; size always comes from the mode.
- Existing behaviors preserved: `setResizable` only in batch,
  `setAlwaysOnTop(true)` for compact/nudge, 350ms ghost-click input shield in
  App.tsx on mode morphs.

## Part 2 — AI creative chooser

UX decisions (Jake):

- Chooser appears **only when ambiguous**; a confident single match keeps
  today's one-line Accept strip.
- **Full fuzzy** shortlisting (plurals/stems and small typos).
- Chooser is a **dropdown** (option C mockup): strip stays one line —
  "2 creatives match · Division · Category — Choose ▾" — opening a floating
  menu inside the widget.
- Menu ends with **"Search all creatives…"** which closes the menu and
  focuses the existing Creative picker (covers deliberate unrelated picks).
- **Tracker only.** Batch keeps auto-pick; odd rows are fixed via each row's
  creative field.

### Matching (`electron/creativeMatch.ts`, stays pure + unit-tested)

Token comparison becomes: exact, OR simple-stem equal (strip trailing
`s`/`es`: foodie ↔ foodies), OR Levenshtein distance ≤ 1 for tokens of length
≥ 5 (fodie → foodie; short tokens stay exact so cat ≠ car). Exact matches
score higher than fuzzy so ranking stays sane.

### Ambiguity (model-judged)

`suggestCategory` prompt: return a single `creativeName` only when one
candidate clearly fits the activity text; when several plausibly fit, return
`creativeCandidates` (≤ 3 names) instead; when none fit, return neither. All
returned names are validated against the local shortlist via
`resolveCreativeByName` — hallucinated names are dropped. If everything drops,
the suggestion degrades to client/division/category exactly as today.

### IPC

`ai:suggest` response gains `candidates?: Array<{ id: number; name: string;
clientName?: string }>` (client name resolved from the creative's clientId for
display). Existing fields unchanged.

### Renderer (Tracker)

`AiStrip` gains `candidates`, `onPickCandidate(id, name)`, `onSearchAll`:

- Confident match → unchanged.
- Ambiguous → "N creatives match · Division · Category — Choose ▾"; dropdown
  is an absolutely-positioned menu inside the compact widget (fixed 480px
  window from Part 1 guarantees room). Esc / outside click dismisses.
- Picking a candidate applies creative + auto-set client + division/category
  in one tap (same apply path as Accept).
- "Search all creatives…" closes the strip's menu and focuses the Creative
  field's search input.

## Testing

- Unit: fuzzy token matching (plural, stem, typo, short-token guard),
  `targetBoundsFor` placement/clamping, ambiguity payload validation.
- Manual: nudge fire → tray click (must open full compact view), nudge "×"
  (no grow animation), foodie scenario end-to-end via `SWAN_TEST_UPDATES=1`-
  style dev run.

## Out of scope

- Batch-row choosers, archived-creative matching (accepted gap), Windows
  nudge placement changes, any updater work.
