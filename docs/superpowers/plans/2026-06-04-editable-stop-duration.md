# Editable Duration at Stop & Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user edit the tracked minutes on the StopGate screen after hitting Stop & log, before the entry posts to Monday.

**Architecture:** StopGate becomes the universal confirm screen (Running always routes there instead of posting directly). It gains a Duration input pre-filled with live elapsed minutes that ticks until first keystroke; an edited value flows through `stopTimer(overrideMinutes?)` → `timer:stop` IPC, where main recomputes `startedAt = endedAt − override` so name suffix, tracker duration, and date stay consistent.

**Tech Stack:** Existing Electron IPC + React/Tailwind patterns. No new dependencies, no new tests (UI + 5-line IPC change; vitest covers node-side pure logic only).

**Spec:** `docs/superpowers/specs/2026-06-04-editable-stop-duration-design.md`

**File map:**
| File | Action | Responsibility |
|---|---|---|
| `src/lib/elapsed.ts` | Create | Shared `initialSeconds` helper (moved from Running.tsx) |
| `src/views/Running.tsx` | Modify | Stop button routes to gate; drop dead busy/error stop-path state |
| `src/views/StopGate.tsx` | Modify | Duration field (live prefill, freeze-on-edit, validation) |
| `src/App.tsx` | Modify | Prop rename `onNeedsCategory` → `onConfirmStop` |
| `electron/preload.ts` | Modify | `stopTimer(overrideMinutes?)` |
| `electron/main.ts` | Modify | `timer:stop` accepts + clamps override |

NOTE: there is an unrelated uncommitted change in `electron/monday.ts` — never stage or commit that file in any task.

---

### Task 1: Shared elapsed helper

**Files:**
- Create: `src/lib/elapsed.ts`
- Modify: `src/views/Running.tsx:12-19`

- [ ] **Step 1: Create `src/lib/elapsed.ts`**

```ts
import type { Running } from './constants';

// Elapsed seconds for a running/paused timer, mirroring the main process's
// runningElapsedMs math (accumulated time + live span unless paused).
export function initialSeconds(t: NonNullable<Running>): number {
  const acc = t.accumulatedMs ?? 0;
  const ms = t.pausedAt ? acc : acc + (Date.now() - t.startedAt);
  return Math.floor(ms / 1000);
}
```

- [ ] **Step 2: Use it in Running.tsx**

Delete the local `initialSeconds` function (lines 12-16) and add to the imports:

```ts
import { initialSeconds } from '../lib/elapsed';
```

(The `useState(() => initialSeconds(timer))` call site is unchanged.)

- [ ] **Step 3: Verify**

Run: `npm run build` — vite + tsc clean. Run: `npm test` — 8/8 (unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/lib/elapsed.ts src/views/Running.tsx
git commit -m "refactor: extract initialSeconds helper for reuse in StopGate"
```

---

### Task 2: stopTimer override plumbing

**Files:**
- Modify: `electron/main.ts` (`timer:stop` handler, ~line 512)
- Modify: `electron/preload.ts` (`stopTimer`, ~line 40)

- [ ] **Step 1: Accept the override in main**

In `electron/main.ts`, change the `timer:stop` handler signature and the `effectiveMs` computation. Current code:

```ts
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
```

becomes:

```ts
ipcMain.handle('timer:stop', async (_event, overrideMinutes?: number) => {
  const cur = store.get('running');
  if (!cur) return { ok: false, error: 'No running timer' };
  if (!cur.division || !cur.category) return { ok: false, error: 'Need division + category' };
  const boardId = store.get('boardId');
  const userId = store.get('userId');
  if (!boardId || !userId) return { ok: false, error: 'Not authenticated' };

  const endedAt = Date.now();
  // User-edited duration from the StopGate. Defensive clamp — the renderer
  // already disables Log for invalid input.
  const override =
    typeof overrideMinutes === 'number' && Number.isFinite(overrideMinutes)
      ? Math.min(1440, Math.max(1, Math.round(overrideMinutes)))
      : undefined;
  // Pass an effective startedAt so logEntry's (endedAt - startedAt) yields the
  // tracked duration minus any paused time — or the user's edited override.
  const effectiveMs = override !== undefined ? override * 60_000 : runningElapsedMs(cur);
```

Everything after (the `try { result = await logEntry({ ... startedAt: endedAt - effectiveMs, endedAt }); }` block through `return { ok: true, ...result };`) is unchanged.

- [ ] **Step 2: Thread it through preload**

In `electron/preload.ts`, change:

```ts
stopTimer: () => ipcRenderer.invoke('timer:stop'),
```

to:

```ts
stopTimer: (overrideMinutes?: number) => ipcRenderer.invoke('timer:stop', overrideMinutes),
```

- [ ] **Step 3: Verify**

Run: `npm run build` — clean (renderer callers pass zero args today; the optional param is backward-compatible).

- [ ] **Step 4: Commit**

```bash
git add electron/main.ts electron/preload.ts
git commit -m "feat: timer:stop accepts an override duration in minutes"
```

---

### Task 3: Duration field in StopGate

**Files:**
- Modify: `src/views/StopGate.tsx` (full file below)

- [ ] **Step 1: Replace `src/views/StopGate.tsx` with:**

```tsx
import { useEffect, useState } from 'react';
import { swan } from '../lib/swan';
import { Picker } from '../components/Picker';
import { CATEGORIES, DIVISIONS } from '../lib/constants';
import { initialSeconds } from '../lib/elapsed';
import type { Running } from '../lib/constants';

type Props = {
  timer: NonNullable<Running>;
  onLogged: (result?: { minutes: number }) => void;
  onCancel: () => void;
};

const MAX_MINUTES = 1440;

export function StopGate({ timer, onLogged, onCancel }: Props) {
  const [division, setDivision] = useState(timer.division);
  const [category, setCategory] = useState(timer.category);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [primaryDivision, setPrimaryDivision] = useState<string | undefined>();
  // Live elapsed seconds keep the Duration prefill ticking until the user
  // touches it. Seeded from the timer prop so a paused timer (which emits no
  // ticks) still shows the right value.
  const [seconds, setSeconds] = useState(() => initialSeconds(timer));
  // null = untouched (live prefill). A string = the user's input, verbatim.
  const [durationText, setDurationText] = useState<string | null>(null);

  useEffect(() => {
    swan.getSettings().then(s => setPrimaryDivision(s.primaryDivision));
  }, []);

  useEffect(() => {
    const off = swan.onTimerTick(setSeconds);
    return () => off();
  }, []);

  const liveMinutes = Math.max(1, Math.ceil(seconds / 60)); // same rounding as logEntry
  const minutes = durationText === null ? liveMinutes : Number(durationText);
  const minutesValid = Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_MINUTES;

  async function log() {
    if (!division || !category || !minutesValid) return;
    setBusy(true);
    await swan.updateTimer({ division, category });
    const res = await swan.stopTimer(durationText === null ? undefined : minutes);
    setBusy(false);
    if (!res.ok) {
      setError(res.error || 'Failed to log');
      return;
    }
    onLogged(res.minutes ? { minutes: res.minutes } : undefined);
  }

  return (
    <div className="flex flex-col h-full px-5 pt-4 pb-5 animate-rise">
      <div className="flex items-center justify-between draggable mb-3">
        <h1 className="text-[16px] font-medium tracking-tight">
          Almost there
        </h1>
        <button
          onClick={onCancel}
          className="no-drag text-[11px] uppercase tracking-[0.08em] text-mute hover:text-ink font-medium"
        >
          Back
        </button>
      </div>

      <p className="text-[12px] text-mute leading-relaxed mb-4">
        Check the time and details — your timer keeps running until you log.
      </p>

      <div className="space-y-2 no-drag">
        <div className="flex items-center gap-2">
          <label
            htmlFor="stopgate-minutes"
            className="text-[11px] text-mute uppercase tracking-[0.08em] font-medium"
          >
            Minutes
          </label>
          <input
            id="stopgate-minutes"
            type="number"
            min={1}
            max={MAX_MINUTES}
            value={durationText ?? String(liveMinutes)}
            onChange={ev => setDurationText(ev.target.value)}
            className={`w-20 px-2 py-1 bg-paper border rounded text-[12px] tabular text-right focus:outline-none focus:ring-1 focus:ring-ink/15 ${
              minutesValid ? 'border-line' : 'border-accent'
            }`}
          />
        </div>
        <Picker
          label="Division"
          value={division}
          options={DIVISIONS.map(d => ({ id: d, label: d }))}
          onChange={(_, l) => setDivision(l)}
          highlightId={primaryDivision}
        />
        <Picker
          label="Category"
          value={category}
          options={CATEGORIES.map(c => ({ id: c, label: c }))}
          onChange={(_, l) => setCategory(l)}
        />
      </div>

      {error && <div className="text-[12px] text-accent mt-3 no-drag">{error}</div>}

      <div className="mt-auto pt-4 grid grid-cols-2 gap-2 no-drag">
        <button
          onClick={onCancel}
          className="py-2.5 border border-line rounded-md text-[13px] hover:bg-black/[0.04] transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={log}
          disabled={!division || !category || !minutesValid || busy}
          className="py-2.5 bg-ink text-paper rounded-md text-[13px] font-medium hover:bg-ink/90 disabled:opacity-30 transition-colors"
        >
          {busy ? 'Logging…' : 'Log entry'}
        </button>
      </div>
    </div>
  );
}
```

Notes on what changed vs the old file: new `seconds`/`durationText` state + tick subscription; Minutes input row (styling matches Today.tsx's minutes editor at `src/views/Today.tsx:321-335`, plus invalid-state `border-accent`); `log()` gates on `minutesValid` and passes the override only when dirty; intro copy updated (it's no longer only about missing category); Log button disabled when invalid. Everything else (Pickers, header, buttons, error row) is the existing code.

- [ ] **Step 2: Verify**

Run: `npm run build` — clean. Run: `npm test` — 8/8.

- [ ] **Step 3: Commit**

```bash
git add src/views/StopGate.tsx
git commit -m "feat: editable duration on the StopGate with live ticking prefill"
```

---

### Task 4: Running always routes to the gate

**Files:**
- Modify: `src/views/Running.tsx`
- Modify: `src/App.tsx:199`

- [ ] **Step 1: Update Running's props and stop()**

In `src/views/Running.tsx`, change the Props type:

```ts
type Props = {
  timer: NonNullable<RunningT>;
  onStopped: (result?: { minutes: number }) => void; // still used by discard()
  onConfirmStop: () => void;
};
```

Change the component signature to `export function Running({ timer, onStopped, onConfirmStop }: Props) {` and replace the whole `stop()` function (currently `async function stop() { ... }` with the division/category check, busy/error handling, and `swan.stopTimer()` call) with:

```ts
function stop() {
  // All stops confirm on the StopGate — duration, division, and category are
  // edited there before anything posts.
  onConfirmStop();
}
```

- [ ] **Step 2: Remove the now-dead stop-path state**

Still in `Running.tsx`:
- Delete `const [busy, setBusy] = useState(false);` and `const [error, setError] = useState<string | null>(null);` (nothing sets them anymore).
- Delete the error display block:
```tsx
{error && (
  <div className="text-[12px] text-accent text-center mb-2 no-drag">{error}</div>
)}
```
- Remove `disabled={busy}` from the pause button, the Stop & log button, and the Discard button (three occurrences), and the `disabled:opacity-*` classes on those buttons may stay (harmless) or go — prefer removing `disabled:opacity-40`/`disabled:opacity-50` where the `disabled` attribute is gone.
- Change the Stop button label from `{busy ? 'Logging…' : 'Stop & log'}` to `Stop & log`.

- [ ] **Step 3: Rename the prop in App.tsx**

`src/App.tsx` line 199: change

```tsx
onNeedsCategory={() => setScreen('stopgate')}
```

to

```tsx
onConfirmStop={() => setScreen('stopgate')}
```

- [ ] **Step 4: Verify**

Run: `npm run build` — clean (a missed `busy`/`error`/`onNeedsCategory` reference fails tsc). Run: `npm test` — 8/8. Also `grep -n "onNeedsCategory" src -r` — zero hits.

- [ ] **Step 5: Commit**

```bash
git add src/views/Running.tsx src/App.tsx
git commit -m "feat: Stop & log always confirms via the StopGate"
```

---

### Task 5: Manual verification

No file changes. Run `npm run dev` and exercise:

- [ ] Start a timer with division+category set → **Stop & log** → StopGate opens (no immediate post). Minutes prefill ticks upward each minute boundary.
- [ ] Don't touch the field → **Log entry** → Today view + Monday item show the tracked minutes (name suffix `(Xm)` matches).
- [ ] Start another timer → Stop & log → type `90` → field freezes at 90 while the timer keeps running → Log entry → Monday item name ends `(90m)`, time-tracker shows `01:30:00`, Date column = today.
- [ ] Type `0`, then clear the field → input border turns accent, **Log entry disabled** both times.
- [ ] **Cancel** → back on Running, elapsed time never stopped.
- [ ] Pause the timer, then Stop & log → prefill shows the paused elapsed value (no ticking) and is correct.
- [ ] Start a timer with NO category (quick start) → Stop & log → StopGate still gates on category as before.

---

## Verification checklist (after all tasks)

- [ ] `npm test` green, `npm run build` clean
- [ ] Spec §1 (universal gate) → Task 4; §2 (duration field behavior) → Task 3; §3 (plumbing + clamp) → Task 2; error handling unchanged → Task 3 reuses existing error row
- [ ] No `electron/monday.ts` staged in any commit
