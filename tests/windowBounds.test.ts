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
    // rawY (tray bottom + 6 = 30) clamps to the work-area top margin (25 + 8).
    expect(b.y).toBe(Math.max(TRAY.y + TRAY.height + 6, WORK.y + 8));
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
