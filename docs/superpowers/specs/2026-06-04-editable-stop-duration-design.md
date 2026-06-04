# Swan Time — Editable duration at Stop & log

**Date:** 2026-06-04
**Status:** Approved pending user review
**Approach:** Always-confirm StopGate with editable Duration field ("Approach A")

## Problem

Jake's original ask was datetime values inside Monday's time-tracking column for easy
editing. A live API experiment (2026-06-04, scratch item on board 1953279472) proved
that impossible: every session-write format is rejected or stored inertly —
`history` (the editable session log) stays empty no matter what is sent, matching the
official docs ("Timer values cannot be updated or cleared directly through the API").

Reframed need: correct the tracked time **in Swan Time, after hitting Stop & log,
before the entry posts to Monday**. (Post-hoc editing already exists in the Today
view; pre-post editing does not.)

## Current behavior

- Running view → Stop & log → posts immediately when Division+Category are set;
  the StopGate screen only appears when they're missing (`src/views/Running.tsx`
  `stop()`, `src/views/StopGate.tsx`).
- `timer:stop` (electron/main.ts) computes elapsed via `runningElapsedMs` and posts
  with `startedAt = endedAt - effectiveMs`.

## Design

### 1. StopGate becomes the universal confirm screen

`Running.stop()` no longer posts directly — it always routes to the StopGate
(`onNeedsCategory` prop renamed `onConfirmStop`; App.tsx route unchanged). The
timer keeps running until "Log entry" is pressed; Cancel returns to Running with
nothing lost (current behavior, preserved).

### 2. Duration field

StopGate gains a **Duration (minutes)** input above Division/Category:

- Pre-filled with live elapsed minutes (`ceil(elapsedSec / 60)`, min 1 — same
  rounding as `logEntry`), ticking each second via the existing `onTimerTick`
  subscription; seeded on mount from the timer prop (accumulatedMs/startedAt math,
  handles a paused timer that emits no ticks).
- Focus (or first keystroke) freezes it: the field stops tracking the live value
  the moment the user clicks in, so it can never tick under the caret; from then
  on it shows exactly what the user typed (`dirty` = non-null input string).
- Validation: integer 1–1440. Invalid/empty → "Log entry" disabled.
- Numeric input styled like the Today view's existing minutes editor.

### 3. Stop plumbing

`stopTimer(overrideMinutes?: number)` through preload → `timer:stop` IPC:

- Renderer passes `overrideMinutes` only when the field is dirty; untouched field
  keeps today's exact semantics (main computes elapsed at stop time).
- Main validates (integer, clamp 1–1440); when present:
  `effectiveMs = overrideMinutes * 60_000`, so `startedAt = endedAt - effectiveMs`.
  The `(Xm)` name suffix, time-tracking duration, and Date column all derive from
  the same value — no drift.

### 4. Out of scope

- Batch entry flow, Today-view editing, `updateEntry` — unchanged.
- Monday-side datetime columns / automation-mirror sessions — explicitly rejected
  during brainstorming in favor of this app-side fix.

## Error handling

Unchanged: `timer:stop` failures surface in StopGate's existing error row; the
running timer is preserved in store for retry.

## Testing

- Manual: stop with untouched field (live value posts); stop with edited value
  (override posts — verify Monday item name suffix + duration + Today view match);
  paused timer shows correct seed; invalid input disables Log; Cancel keeps timer.
- The change is UI + a 5-line IPC tweak; no new pure logic worth unit tests.
