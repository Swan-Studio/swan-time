# Widget Mode Management + AI Creative Chooser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the stuck-nudge and grow-then-close window bugs by centralizing window geometry, and let the Tracker AI strip offer a dropdown of candidate creatives when the match is ambiguous, backed by fuzzy shortlisting.

**Architecture:** A new pure module `electron/windowBounds.ts` computes target bounds per widget mode; `applyWidgetMode()` in main.ts becomes the only code that sizes/shows the window (never animated, hide-before-resize). `creativeMatch.ts` gains fuzzy token matching. The AI prompt returns either one confident `creativeName` or ≤3 `creativeCandidates`; main.ts resolves them to ids and the AiStrip renders a "Choose ▾" dropdown.

**Tech Stack:** Electron 31, React 18, TypeScript, vitest. Spec: `docs/superpowers/specs/2026-06-05-widget-modes-and-ai-creative-chooser-design.md`.

**Commands:**
- Tests: `npm test` (vitest run) or `npx vitest run tests/<file>.test.ts`
- Typecheck: `npx tsc --noEmit -p .` AND `npx tsc --noEmit -p electron/tsconfig.json`
- Dev run: `npm run dev`

---

### Task 1: Fuzzy token matching in creativeMatch.ts

**Files:**
- Modify: `electron/creativeMatch.ts`
- Test: `tests/creativeMatch.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new describe block to `tests/creativeMatch.test.ts`:

```ts
describe('fuzzy matching', () => {
  it('matches plurals via stemming: "foodie" finds "New Foodies"', () => {
    const out = shortlistCreatives('foodie video', [
      { id: 20, name: 'New Foodies', clientId: 1 },
      { id: 21, name: 'Spring Sale', clientId: 2 }
    ]);
    expect(out.map(c => c.id)).toEqual([20]);
  });

  it('matches one-typo tokens of length >= 5: "fodie" finds "Foodie"', () => {
    const out = shortlistCreatives('fodie cut', [{ id: 22, name: 'Foodie Finds', clientId: 1 }]);
    expect(out.map(c => c.id)).toEqual([22]);
  });

  it('does NOT fuzzy-match short tokens: "cat" must not find "car"', () => {
    const out = shortlistCreatives('cat video', [{ id: 23, name: 'Car Review', clientId: 1 }]);
    expect(out).toEqual([]);
  });

  it('ranks exact token matches above fuzzy ones', () => {
    const out = shortlistCreatives('foodie video', [
      { id: 24, name: 'Foodies Abroad', clientId: 1 }, // stem match (1pt)
      { id: 25, name: 'Foodie Abroad', clientId: 1 }   // exact match (2pt)
    ]);
    expect(out.map(c => c.id)).toEqual([25, 24]);
  });

  it('stemming does not strip double-s: "boss" stays "boss"', () => {
    const out = shortlistCreatives('bos check', [{ id: 26, name: 'Boss Moves', clientId: 1 }]);
    expect(out).toEqual([]); // "bos" (3 chars) gets filtered by min length anyway; no stem collision
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/creativeMatch.test.ts`
Expected: the four new tests FAIL (`foodie` ≠ `foodies`, `fodie` ≠ `foodie`); existing tests still pass.

- [ ] **Step 3: Implement fuzzy matching**

In `electron/creativeMatch.ts`, add below `tokens()`:

```ts
// "foodies" → "foodie". Trailing-s only (not -ss): cheap plural handling
// without a real stemmer; typos are covered by withinOneEdit below.
function stem(t: string): string {
  return t.length >= 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t;
}

// True when insert/delete/substitute distance is <= 1. Single pass — no DP
// table needed for a bound of one edit.
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (l.length - s.length > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (s.length === l.length) {
      i++;
      j++;
    } else {
      j++; // skip the extra char in the longer string
    }
  }
  return edits + (l.length - j) <= 1;
}

// Short tokens stay exact — "cat"/"car" must not collide; one edit only
// becomes meaningful signal at >= 5 chars.
function fuzzyTokenMatch(a: string, b: string): boolean {
  if (stem(a) === stem(b)) return true;
  return a.length >= 5 && b.length >= 5 && withinOneEdit(a, b);
}
```

Replace the scoring loop in `shortlistCreatives` (currently `for (const t of tokens(c.name)) if (textTokens.has(t)) score++;`) with:

```ts
      const textTokenList = [...textTokens];
      for (const t of tokens(c.name)) {
        if (textTokens.has(t)) score += 2; // exact outranks fuzzy
        else if (textTokenList.some(x => fuzzyTokenMatch(x, t))) score += 1;
      }
```

(`textTokenList` is hoisted per-creative here; the candidate list is ~6k × ~4 tokens — fine.)

- [ ] **Step 4: Run the full creativeMatch suite**

Run: `npx vitest run tests/creativeMatch.test.ts`
Expected: ALL tests pass — including the pre-existing ones. Note: the existing test "ranks token+client matches above client-only matches" relies on relative order only, so the exact=2 scoring change is compatible.

- [ ] **Step 5: Commit**

```bash
git add electron/creativeMatch.ts tests/creativeMatch.test.ts
git commit -m "feat: fuzzy creative token matching (stems + one-edit typos)"
```

---

### Task 2: Pure window-bounds module

**Files:**
- Create: `electron/windowBounds.ts`
- Test: `tests/windowBounds.test.ts`
- Modify (later, Task 3): `electron/main.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/windowBounds.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { targetBoundsFor, COMPACT_SIZE, BATCH_SIZE, NUDGE_SIZE } from '../electron/windowBounds';

const WORK = { x: 0, y: 25, width: 1512, height: 925 }; // MBP work area, menu bar 25px
const TRAY = { x: 1200, y: 0, width: 24, height: 24 };  // macOS menu-bar tray (top)

describe('targetBoundsFor', () => {
  it('anchors compact below a top tray, horizontally centered on it', () => {
    const b = targetBoundsFor('compact', { trayBounds: TRAY, workArea: WORK });
    expect(b.width).toBe(COMPACT_SIZE.width);
    expect(b.height).toBe(COMPACT_SIZE.height);
    expect(b.x).toBe(Math.round(TRAY.x + TRAY.width / 2 - COMPACT_SIZE.width / 2));
    expect(b.y).toBe(TRAY.y + TRAY.height + 6);
  });

  it('anchors nudge at nudge size near the tray', () => {
    const b = targetBoundsFor('nudge', { trayBounds: TRAY, workArea: WORK });
    expect(b.width).toBe(NUDGE_SIZE.width);
    expect(b.height).toBe(NUDGE_SIZE.height);
  });

  it('places above the tray when the tray sits in the lower half (Windows taskbar)', () => {
    const tray = { x: 1200, y: 940, width: 24, height: 24 };
    const work = { x: 0, y: 0, width: 1512, height: 935 };
    const b = targetBoundsFor('compact', { trayBounds: tray, workArea: work });
    expect(b.y).toBe(Math.round(Math.min(
      Math.max(tray.y - COMPACT_SIZE.height - 6, work.y + 8),
      work.y + work.height - COMPACT_SIZE.height - 8
    )));
  });

  it('clamps x inside the work area for a tray at the screen edge', () => {
    const tray = { x: 1500, y: 0, width: 24, height: 24 };
    const b = targetBoundsFor('compact', { trayBounds: tray, workArea: WORK });
    expect(b.x! + COMPACT_SIZE.width).toBeLessThanOrEqual(WORK.x + WORK.width - 8);
  });

  it('centers batch in the work area', () => {
    const b = targetBoundsFor('batch', { trayBounds: TRAY, workArea: WORK });
    expect(b.width).toBe(BATCH_SIZE.width);
    expect(b.x).toBe(Math.round(WORK.x + (WORK.width - BATCH_SIZE.width) / 2));
    expect(b.y).toBe(Math.round(WORK.y + (WORK.height - BATCH_SIZE.height) / 2));
  });

  it('returns size without position when there is no tray', () => {
    const b = targetBoundsFor('compact', { trayBounds: null, workArea: WORK });
    expect(b.width).toBe(COMPACT_SIZE.width);
    expect(b.x).toBeUndefined();
    expect(b.y).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/windowBounds.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the module**

Create `electron/windowBounds.ts` — the placement math is MOVED verbatim from main.ts `placeNearTray` (same constants, same clamping):

```ts
// Pure geometry for the widget window — no Electron imports so vitest can
// exercise placement and clamping directly (tests/windowBounds.test.ts).

export type WidgetMode = 'compact' | 'batch' | 'nudge';
export type Rect = { x: number; y: number; width: number; height: number };

export const COMPACT_SIZE = { width: 380, height: 480 };
export const BATCH_SIZE = { width: 760, height: 560 };
export const NUDGE_SIZE = { width: 380, height: 56 };

export type TargetBounds = { width: number; height: number; x?: number; y?: number };

// Anchor a window of the given size near the tray icon. Default below; flip
// above when the tray sits in the lower half of the work area (Windows
// taskbar-at-bottom case). Always clamped inside workArea so the popover
// can't end up off-screen. Batch centers in the work area instead.
export function targetBoundsFor(
  mode: WidgetMode,
  env: { trayBounds: Rect | null; workArea: Rect }
): TargetBounds {
  const { trayBounds, workArea: work } = env;
  if (mode === 'batch') {
    return {
      ...BATCH_SIZE,
      x: Math.round(work.x + (work.width - BATCH_SIZE.width) / 2),
      y: Math.round(work.y + (work.height - BATCH_SIZE.height) / 2)
    };
  }
  const size = mode === 'nudge' ? NUDGE_SIZE : COMPACT_SIZE;
  if (!trayBounds) return { ...size };
  const x = Math.round(
    Math.min(
      Math.max(trayBounds.x + trayBounds.width / 2 - size.width / 2, work.x + 8),
      work.x + work.width - size.width - 8
    )
  );
  const preferAbove = trayBounds.y + trayBounds.height / 2 > work.y + work.height / 2;
  const rawY = preferAbove ? trayBounds.y - size.height - 6 : trayBounds.y + trayBounds.height + 6;
  const y = Math.round(Math.min(Math.max(rawY, work.y + 8), work.y + work.height - size.height - 8));
  return { ...size, x, y };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/windowBounds.test.ts`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add electron/windowBounds.ts tests/windowBounds.test.ts
git commit -m "feat: pure targetBoundsFor module for widget window geometry"
```

---

### Task 3: applyWidgetMode / hideWindow refactor in main.ts

**Files:**
- Modify: `electron/main.ts` (constants ~line 62, `placeNearTray` ~line 133, `setWidgetMode` ~line 149, `positionNearTray`/`showWindow`/`toggleWindow` ~lines 172–205, blur handler ~line 107, `fireNudge` ~line 311, tray click ~line 219, nudge/batch IPC ~lines 636–651, hotkey ~line 800)
- Modify: `src/App.tsx` (widget-mode handler, lines 71–98)

No new unit tests (Electron window calls aren't unit-testable here; geometry is covered by Task 2; behavior verified manually in Task 7).

- [ ] **Step 1: Replace constants and imports in main.ts**

Delete the local `COMPACT_SIZE`/`BATCH_SIZE`/`NUDGE_SIZE` consts (~line 62) and the whole `placeNearTray` function (~lines 129–147). Add to imports:

```ts
import { targetBoundsFor, COMPACT_SIZE, WidgetMode } from './windowBounds';
```

Change the mode variable's type annotation to use it:

```ts
let widgetMode: WidgetMode = 'compact';
```

- [ ] **Step 2: Replace setWidgetMode/positionNearTray/showWindow/toggleWindow**

Delete `setWidgetMode`, `positionNearTray`, `showWindow`, and `toggleWindow` (~lines 149–205) and add:

```ts
// THE single owner of window geometry + visibility. Invariants:
//   1. every show declares its mode (no path can show a stale-size window)
//   2. resizes never animate (mode morphs snap; no macOS grow effect)
//   3. closing goes hide-first, resize-after via hideWindow()
function applyWidgetMode(
  mode: WidgetMode,
  opts: { show?: boolean; focus?: boolean; showInactive?: boolean } = {}
) {
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
```

Note: `showWindow` keeps its name/signature because `second-instance` (~line 70) and auth flows call it.

- [ ] **Step 3: Route every mode/visibility call site through the new functions**

- Blur handler (~line 107-111): replace body so hides normalize the mode:

```ts
  win.on('blur', () => {
    if (widgetMode === 'nudge') return; // nudges close only via 30s timer or expand; don't pollute lastBounds with nudge size
    if (store.get('settings').closeOnBlur !== false) hideWindow();
    else if (win) lastBounds = win.getBounds();
  });
```

- `fireNudge` (~line 316): replace `setWidgetMode('nudge'); win.showInactive();` with `applyWidgetMode('nudge', { showInactive: true });`
- `batch:open` handler (~line 636): replace `showWindow(); setWidgetMode('batch');` with `applyWidgetMode('batch', { show: true, focus: true });`
- `batch:close` (~line 640): `ipcMain.handle('batch:close', () => applyWidgetMode('compact', { show: true, focus: true }));`
- `nudge:expand` (~line 643): replace body with `applyWidgetMode('compact', { show: true, focus: true });`
- `nudge:close` (~line 647): replace body with `hideWindow();` — this is the grow-then-close fix.
- Tracker view batch button path (~line 243, `setWidgetMode('batch')`): replace with `applyWidgetMode('batch', { show: true, focus: true });`
- Search the file for any remaining `setWidgetMode`/`positionNearTray` references: `grep -n "setWidgetMode\|positionNearTray\|placeNearTray\|BATCH_SIZE\|NUDGE_SIZE" electron/main.ts` — all must be gone (BATCH_SIZE/NUDGE_SIZE now live only in windowBounds.ts).

- [ ] **Step 4: App.tsx — screen purely derived from widget:mode, stopgate preserved**

In `src/App.tsx` replace the `offMode` handler (lines 79–92) with:

```ts
    const offMode = swan.onWidgetMode(async mode => {
      raiseShield();
      if (mode === 'batch') {
        setScreen('batch');
      } else if (mode === 'nudge') {
        const t = await swan.getRunning();
        setTimer(t);
        setScreen('nudge');
      } else {
        const t = await swan.getRunning();
        setTimer(t);
        // compact now fires on every show/hide-normalize; never stomp an
        // in-progress stop confirmation.
        setScreen(prev => (prev === 'stopgate' ? prev : t ? 'running' : 'tracker'));
      }
    });
```

And since every show now also emits `widget:mode`, slim the `onShow` handler (lines 73–78) to shield + timer refresh only (screen is mode-derived):

```ts
    const off = swan.onShow(async () => {
      raiseShield();
      setTimer(await swan.getRunning());
    });
```

Known acceptable change: re-opening the widget while on settings/today/levels returns to tracker/running (previously those screens survived a hide/show).

- [ ] **Step 5: Typecheck both projects and run all tests**

Run: `npx tsc --noEmit -p . && npx tsc --noEmit -p electron/tsconfig.json && npm test`
Expected: clean typecheck, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts electron/windowBounds.ts src/App.tsx
git commit -m "fix: centralize widget window geometry in applyWidgetMode

Fixes the stuck-nudge view (every show now declares its mode) and the
grow-then-close animation (hide first, resize while hidden, never animate)."
```

---

### Task 4: AI prompt returns creativeCandidates when ambiguous

**Files:**
- Modify: `electron/ai.ts` (CategorySuggestion type ~line 36, suggestCategory prompt + parsing ~lines 45–119)

- [ ] **Step 1: Extend the type**

In `electron/ai.ts`, add to `CategorySuggestion`:

```ts
export type CategorySuggestion = {
  clientName?: string;
  creativeId?: number; // resolved in main.ts via resolveCreativeByName — ai.ts only sees names
  creativeName?: string;
  candidateNames?: string[]; // set instead of creativeName when several candidates plausibly fit (<= 3, validated)
  division?: string;
  category?: string;
  confidence: number;
};
```

- [ ] **Step 2: Update the prompt**

Replace the `creativesHint` const (~line 60) with:

```ts
  const creativesHint = context.creativeCandidates?.length
    ? `\nCandidate creatives (only names from this list): ${context.creativeCandidates.join(', ')}.
Creative rules: set "creativeName" ONLY when exactly one candidate clearly matches the activity. When SEVERAL candidates plausibly match and you cannot tell which, set "creativeName" to null and list them (max 3) in "creativeCandidates". When none match, both are null. Never set both.`
    : '';
```

And update the JSON contract line (~line 70) to include the new field:

```ts
Return strict JSON only, no prose: {"clientName": string|null, "creativeName": string|null, "creativeCandidates": string[]|null, "division": string|null, "category": string|null, "confidence": 0..1}.
```

- [ ] **Step 3: Add a pure, tested validator in creativeMatch.ts**

The validation is pure list-filtering, so it lives in `creativeMatch.ts` where vitest reaches it. First the failing tests — append to `tests/creativeMatch.test.ts`:

```ts
import { validateCandidateNames } from '../electron/creativeMatch'; // extend the existing import line instead

describe('validateCandidateNames', () => {
  const ALLOWED = ['New Foodies', "Foodie's life hack", 'Spring Sale'];

  it('maps case-insensitively to exact-case allowed names', () => {
    expect(validateCandidateNames(['new foodies', "FOODIE'S LIFE HACK"], ALLOWED))
      .toEqual(['New Foodies', "Foodie's life hack"]);
  });

  it('drops hallucinated names, non-strings, and duplicates; caps at 3', () => {
    expect(validateCandidateNames(
      ['New Foodies', 'Nope', 42, 'new foodies', 'Spring Sale', "Foodie's life hack", 'Spring Sale'],
      ALLOWED
    )).toEqual(['New Foodies', 'Spring Sale', "Foodie's life hack"]);
  });

  it('returns [] for non-array input', () => {
    expect(validateCandidateNames('New Foodies', ALLOWED)).toEqual([]);
    expect(validateCandidateNames(null, ALLOWED)).toEqual([]);
  });
});
```

Run: `npx vitest run tests/creativeMatch.test.ts` — the new tests FAIL (function missing).

Then add to `electron/creativeMatch.ts`:

```ts
// Validate a model-returned candidate list: exact-case names from `allowed`
// only, deduped, capped at 3. Hallucinated names and junk entries drop out.
export function validateCandidateNames(raw: unknown, allowed: string[]): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .filter((n): n is string => typeof n === 'string')
        .map(n => allowed.find(c => c.toLowerCase() === n.toLowerCase()))
        .filter((n): n is string => Boolean(n))
    )
  ].slice(0, 3);
}
```

Run again — PASS.

- [ ] **Step 4: Use the validator in the response parsing**

In `electron/ai.ts`, import it (`import { validateCandidateNames } from './creativeMatch';`) and replace the return block of `suggestCategory` (~line 108). Candidates are suppressed when a single creative was confidently named:

```ts
    const candidateNames =
      !creativeMatch && context.creativeCandidates
        ? validateCandidateNames(parsed.creativeCandidates, context.creativeCandidates)
        : [];
    return {
      clientName: clientMatch,
      creativeName: creativeMatch,
      candidateNames: candidateNames.length >= 2 ? candidateNames : undefined,
      division: DIVISIONS.includes(parsed.division) ? parsed.division : undefined,
      category: CATEGORIES.includes(parsed.category) ? parsed.category : undefined,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0))
    };
```

Edge case handled by the `>= 2` guard: if the model listed 2 candidates but validation drops one (hallucination), a single survivor is NOT ambiguous — but it's also not confident enough to auto-apply, so it is simply dropped (degrades to division/category, same as today's unknown-name path). Task 5 does not promote single survivors.

- [ ] **Step 5: Typecheck + tests**

Run: `npx tsc --noEmit -p electron/tsconfig.json && npx vitest run tests/creativeMatch.test.ts`
Expected: clean, all pass. (ai.ts itself stays untested — it is a network module; all its validation logic is now in the tested pure helper.)

- [ ] **Step 6: Commit**

```bash
git add electron/ai.ts electron/creativeMatch.ts tests/creativeMatch.test.ts
git commit -m "feat: AI suggestion returns creativeCandidates when the match is ambiguous"
```

---

### Task 5: ai:suggest resolves candidates to ids + client names

**Files:**
- Modify: `electron/main.ts` (`ai:suggest` handler, ~lines 614–627)

- [ ] **Step 1: Replace the handler**

```ts
  ipcMain.handle('ai:suggest', async (_e, name: string) => {
    const recents = store.get('recents').map(r => ({ name: r.name, clientName: r.clientName }));
    const clients = await listClients();
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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p electron/tsconfig.json`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "feat: ai:suggest ships resolved candidate creatives for the chooser"
```

---

### Task 6: AiStrip dropdown + Tracker wiring + Picker openSignal

**Files:**
- Modify: `src/components/AiStrip.tsx`
- Modify: `src/components/Picker.tsx` (add `openSignal` prop)
- Modify: `src/views/Tracker.tsx` (suggestion state type, AiStrip props, Creative Picker)

- [ ] **Step 1: Picker gains an imperative-open signal**

In `src/components/Picker.tsx` add to `Props`:

```ts
  /** Increment to open the dropdown programmatically (e.g. AI strip's "Search all…"). */
  openSignal?: number;
```

Destructure `openSignal` in the component signature and add after the existing outside-click effect:

```ts
  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);
```

(The panel's search input has `autoFocus`, so opening focuses search for free.)

- [ ] **Step 2: Rewrite AiStrip with the candidates dropdown**

Replace `src/components/AiStrip.tsx` entirely:

```tsx
import { useEffect, useRef, useState } from 'react';

type Candidate = { id: number; name: string; clientName?: string };

type Props = {
  clientName?: string;
  creativeName?: string;
  division?: string;
  category?: string;
  candidates?: Candidate[];
  confidence: number;
  onAccept: () => void;
  onPickCandidate: (c: Candidate) => void;
  onSearchAll: () => void;
  onDismiss: () => void;
};

export function AiStrip({
  clientName,
  creativeName,
  division,
  category,
  candidates,
  confidence,
  onAccept,
  onPickCandidate,
  onSearchAll,
  onDismiss
}: Props) {
  const ambiguous = !creativeName && (candidates?.length ?? 0) >= 2;
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Same dismiss pattern as Picker: outside mousedown or Escape closes.
  useEffect(() => {
    if (!menuOpen) return;
    const onMouse = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // don't let App's Escape-to-hide fire underneath
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [menuOpen]);

  if (confidence <= 0.5 || (!clientName && !creativeName && !division && !category && !ambiguous)) {
    return null;
  }

  const parts = [
    !ambiguous && clientName && <span key="client">{clientName}</span>,
    !ambiguous && creativeName && <span key="creative">{creativeName}</span>,
    ambiguous && (
      <span key="count" className="font-medium">{candidates!.length} creatives match</span>
    ),
    division && <span key="division" className="text-mute">{division}</span>,
    category && <span key="category">{category}</span>
  ].filter(Boolean);

  return (
    <div ref={rootRef} className="no-drag relative mt-2">
      <div className="px-3 py-2 bg-swan-gradient-soft border border-accent/20 rounded-md flex items-center gap-2 animate-rise">
        <span className="text-[10px] uppercase tracking-[0.1em] text-accent font-semibold">AI</span>
        <span className="text-[12px] text-ink truncate flex-1">
          {parts.map((p, i) => (
            <span key={i}>
              {i > 0 && <span className="text-mute mx-1">·</span>}
              {p}
            </span>
          ))}
        </span>
        {ambiguous ? (
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="text-[11px] font-medium text-accent hover:underline whitespace-nowrap"
          >
            Choose ▾
          </button>
        ) : (
          <button onClick={onAccept} className="text-[11px] font-medium text-accent hover:underline">
            Accept
          </button>
        )}
        <button onClick={onDismiss} className="text-[11px] text-mute hover:text-ink">
          ×
        </button>
      </div>
      {ambiguous && menuOpen && (
        <div className="absolute right-0 top-full mt-1 w-[280px] z-50 bg-paper/95 backdrop-blur-md border border-line rounded-md shadow-lg overflow-hidden animate-rise">
          {candidates!.map(c => (
            <button
              key={c.id}
              onClick={() => {
                setMenuOpen(false);
                onPickCandidate(c);
              }}
              className="w-full text-left px-3 py-2 text-[12px] hover:bg-black/[0.05] flex items-baseline gap-2"
            >
              <span className="text-ink truncate flex-1">{c.name}</span>
              {c.clientName && <span className="text-mute text-[11px] shrink-0">{c.clientName}</span>}
            </button>
          ))}
          <button
            onClick={() => {
              setMenuOpen(false);
              onSearchAll();
            }}
            className="w-full text-left px-3 py-2 text-[12px] text-accent hover:bg-black/[0.05] border-t border-line"
          >
            Search all creatives…
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire Tracker**

In `src/views/Tracker.tsx`:

1. Extend the suggestion state type (~line 40):

```ts
  const [suggestion, setSuggestion] = useState<{
    clientName?: string;
    creativeId?: number;
    creativeName?: string;
    candidates?: Array<{ id: number; name: string; clientName?: string }>;
    division?: string;
    category?: string;
    confidence: number;
  }>({ confidence: 0 });
```

2. Add the open-signal state next to it:

```ts
  const [creativePickerSignal, setCreativePickerSignal] = useState(0);
```

3. Extract the shared division/category apply into a helper above `applyRecent` (~line 97):

```ts
  function applySuggestionMeta() {
    if (suggestion.division) setDivision(suggestion.division);
    if (suggestion.category) setCategory(suggestion.category);
    setDismissed(true);
  }
```

4. Replace the `<AiStrip …/>` usage (~lines 277–294):

```tsx
      <AiStrip
        {...suggestion}
        onAccept={() => {
          if (suggestion.creativeId && suggestion.creativeName) {
            // Creative wins: pickCreative also fills its owning client, the
            // same rule as picking manually — overriding the AI's client
            // guess if they conflict.
            pickCreative(suggestion.creativeId, suggestion.creativeName);
          } else if (suggestion.clientName) {
            const match = clients.find(c => c.name.toLowerCase() === suggestion.clientName!.toLowerCase());
            if (match) pickClient(match.id, match.name);
          }
          applySuggestionMeta();
        }}
        onPickCandidate={c => {
          pickCreative(c.id, c.name);
          applySuggestionMeta();
        }}
        onSearchAll={() => {
          // Keep the AI's division/category, then hand off to the full picker.
          applySuggestionMeta();
          setCreativePickerSignal(s => s + 1);
        }}
        onDismiss={() => setDismissed(true)}
      />
```

5. Pass the signal to the Creative `Picker` (~line 304):

```tsx
        {creativesOn && (
          <Picker
            label="Creative"
            value={creativeName}
            placeholder="—"
            options={creativesForClient(creatives, clientId).map(c => ({ id: c.id, label: c.name }))}
            onChange={(id, label) => pickCreative(Number(id), label)}
            openSignal={creativePickerSignal}
          />
        )}
```

- [ ] **Step 4: Typecheck + full suite**

Run: `npx tsc --noEmit -p . && npx tsc --noEmit -p electron/tsconfig.json && npm test`
Expected: clean, all tests pass. Note: `Batch.tsx`/other AiStrip consumers — `grep -rn "AiStrip" src/` must show only Tracker.tsx; if Batch uses it, add the two new handlers there as no-ops (`onPickCandidate={() => {}} onSearchAll={() => {}}`) — per spec, Batch keeps auto-pick.

- [ ] **Step 5: Commit**

```bash
git add src/components/AiStrip.tsx src/components/Picker.tsx src/views/Tracker.tsx
git commit -m "feat: AI strip offers a creative chooser dropdown when ambiguous"
```

---

### Task 7: Manual verification (dev run)

**Files:** none (verification only)

- [ ] **Step 1: Launch dev build**

Run: `npm run dev` (waits on vite + tsc watch; window appears via tray/hotkey).

- [ ] **Step 2: Verify height-management fixes**

1. Trigger the nudge: temporarily call it via dev tools or wait for a :00/:30 boundary inside 9:00–17:00 — OR temporarily change `nextNudgeFromNow` slop. Easiest deterministic path: in the dev console of the main process is not available, so instead temporarily add `setTimeout(fireNudge, 5000);` after `scheduleNextNudge()` in main.ts, verify, then revert before commit.
2. With the nudge banner visible, click the tray icon → window must morph to the FULL compact widget (380×480) showing tracker/running — not stay a 56px chip. ✅ bug 1
3. Re-fire the nudge, click its "×" → banner must disappear immediately with NO visible grow animation. ✅ bug 2
4. Open Batch (760×560), close it → returns to compact at tray, no animation.
5. Toggle via hotkey twice — open/close, sizes correct each time.

- [ ] **Step 3: Verify the chooser end-to-end**

1. In the Tracker, type "foodie video" and wait for the AI strip.
2. Expected: strip shows "2 creatives match · … — Choose ▾" (board currently has "New Foodies" (EatClub) and "Foodie's life hack" (Hello Fresh AU); "Foodie on Juniper" is Archived and must NOT appear).
3. Open the dropdown → both candidates listed with client names + "Search all creatives…" row.
4. Pick one → Creative + Client + Division/Category all fill; strip dismisses.
5. Retype, choose "Search all creatives…" → Creative picker opens with search focused; division/category retained.
6. Type a clearly-unique creative reference → confident single-match strip with Accept, behaves exactly as before.

- [ ] **Step 4: Revert any temporary nudge-test code, run full suite one last time**

Run: `git diff` (must show no leftover test scaffolding), then `npm test && npx tsc --noEmit -p . && npx tsc --noEmit -p electron/tsconfig.json`
Expected: clean tree apart from intended changes; all green.

---

### Task 8: Finish

- [ ] Use superpowers:finishing-a-development-branch / confirm with Jake whether this ships as v1.0.9 immediately (release flow: `npm version patch` → `GH_TOKEN=$(gh auth token) npm run release` → `gh release edit vX --draft=false`).
