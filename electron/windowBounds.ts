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
