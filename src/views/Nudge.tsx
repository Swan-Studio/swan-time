import { useEffect, useRef } from 'react';
import { swan } from '../lib/swan';
import type { Running as RunningT } from '../lib/constants';

type Props = {
  timer: RunningT;
  onExpand: () => void;
};

const AUTO_CLOSE_MS = 30_000;

export function Nudge({ timer, onExpand }: Props) {
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function reset() {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => {
        swan.nudgeClose();
      }, AUTO_CLOSE_MS);
    }
    reset();
    // Any pointer/key activity over the banner counts as interaction and
    // pushes the auto-close back another 30s.
    window.addEventListener('mousemove', reset);
    window.addEventListener('mousedown', reset);
    window.addEventListener('keydown', reset);
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('mousedown', reset);
      window.removeEventListener('keydown', reset);
    };
  }, []);

  const message = timer
    ? `Still on "${timer.name}"?`
    : 'What are you working on?';

  return (
    <div
      onClick={onExpand}
      className="w-full h-full flex items-center gap-2 px-3 hover:bg-black/[0.04] transition-colors no-drag cursor-pointer"
    >
      <span className="w-2 h-2 ml-1 rounded-full bg-swan-gradient animate-livepulse shadow-[0_0_8px_rgba(255,78,1,0.4)] shrink-0" />
      <span className="flex-1 text-[13px] text-ink truncate">{message}</span>
      <button
        onClick={e => {
          e.stopPropagation();
          swan.nudgeClose();
        }}
        title="Dismiss"
        aria-label="Dismiss"
        className="w-7 h-7 flex items-center justify-center rounded-md text-mute hover:text-ink hover:bg-black/[0.06] transition-colors shrink-0"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 6 L18 18 M6 18 L18 6" />
        </svg>
      </button>
      <button
        onClick={e => {
          e.stopPropagation();
          onExpand();
        }}
        className="px-2.5 py-1 rounded-md bg-ink text-paper text-[11px] font-medium hover:bg-ink/90 transition-colors shrink-0"
      >
        Open
      </button>
    </div>
  );
}
