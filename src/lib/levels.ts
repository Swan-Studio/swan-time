// Level curve: 10h to reach Lv2, each subsequent gap multiplied by 1.2.
// Cumulative threshold to BE level N (in minutes):
//   Lv1 = 0, Lv2 = 600, Lv3 = 1320, Lv4 = 2184, Lv5 = 3221, ...
const BASE_GAP_MIN = 10 * 60;
const GROWTH = 1.2;

function thresholdMinutes(level: number): number {
  if (level <= 1) return 0;
  let total = 0;
  let gap = BASE_GAP_MIN;
  for (let i = 0; i < level - 1; i++) {
    total += gap;
    gap *= GROWTH;
  }
  return total;
}

export function levelFor(minutes: number): number {
  if (minutes <= 0) return 1;
  let level = 1;
  while (thresholdMinutes(level + 1) <= minutes && level < 99) level++;
  return level;
}

export function levelProgress(minutes: number): {
  level: number;
  inLevelMinutes: number;
  nextLevelGap: number;
  fraction: number;
} {
  const level = levelFor(minutes);
  const floor = thresholdMinutes(level);
  const ceiling = thresholdMinutes(level + 1);
  const gap = ceiling - floor;
  const inLevel = minutes - floor;
  return {
    level,
    inLevelMinutes: inLevel,
    nextLevelGap: gap,
    fraction: gap > 0 ? Math.min(1, inLevel / gap) : 1
  };
}
