import type { Running } from './constants';

// Elapsed seconds for a running/paused timer, mirroring the main process's
// runningElapsedMs math (accumulated time + live span unless paused).
export function initialSeconds(t: NonNullable<Running>): number {
  const acc = t.accumulatedMs ?? 0;
  const ms = t.pausedAt ? acc : acc + (Date.now() - t.startedAt);
  return Math.floor(ms / 1000);
}
