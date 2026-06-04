import { useEffect, useRef, useState } from 'react';
import { swan } from '../lib/swan';
import { formatElapsed } from '../lib/format';
import { initialSeconds } from '../lib/elapsed';
import type { Running as RunningT } from '../lib/constants';

type Props = {
  timer: NonNullable<RunningT>;
  onStopped: (result?: { minutes: number }) => void; // still used by discard()
  onConfirmStop: () => void;
};

export function Running({ timer, onStopped, onConfirmStop }: Props) {
  const [seconds, setSeconds] = useState(() => initialSeconds(timer));
  const [paused, setPaused] = useState(!!timer.pausedAt);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const off = swan.onTimerTick(setSeconds);
    return () => off();
  }, []);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  function stop() {
    // All stops confirm on the StopGate — duration, division, and category are
    // edited there before anything posts.
    onConfirmStop();
  }

  async function togglePause() {
    const next = paused ? await swan.resumeTimer() : await swan.pauseTimer();
    setPaused(!!next?.pausedAt);
  }

  async function discard() {
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmDiscard(false), 3000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    await swan.cancelTimer();
    onStopped();
  }

  const breadcrumb = [timer.clientName, timer.creativeName, timer.division, timer.category].filter(Boolean).join(' · ') || 'No category yet';

  return (
    <div className="flex flex-col h-full px-5 pt-4 pb-5 animate-rise">
      <div className="flex items-center justify-between draggable">
        <div className="flex items-center gap-2">
          <span
            className={
              paused
                ? 'w-2 h-2 rounded-full bg-mute'
                : 'w-2 h-2 rounded-full bg-swan-gradient animate-livepulse shadow-[0_0_8px_rgba(255,78,1,0.4)]'
            }
          />
          <span
            className={`text-[10px] uppercase tracking-[0.12em] font-semibold ${
              paused ? 'text-mute' : 'text-accent'
            }`}
          >
            {paused ? 'Paused' : 'Running'}
          </span>
        </div>
        <button
          onClick={togglePause}
          className="no-drag text-mute hover:text-ink transition-colors"
          title={paused ? 'Resume' : 'Pause'}
          aria-label={paused ? 'Resume timer' : 'Pause timer'}
        >
          {paused ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          )}
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="tabular text-timer text-ink font-medium">
          {formatElapsed(seconds)}
        </div>
        <div className="mt-4 max-w-full">
          <div className="text-[17px] text-ink leading-snug truncate px-4">
            {timer.name}
          </div>
          <div className="text-[11px] text-mute mt-1 truncate px-4">{breadcrumb}</div>
        </div>
        {seconds > 4 * 3600 && (
          <div className="mt-4 mx-4 px-3 py-2 bg-accent/[0.08] border border-accent/30 rounded-md text-[11px] text-accent leading-relaxed no-drag">
            {seconds > 12 * 3600
              ? `Running ${Math.floor(seconds / 3600)}h. Did you forget to stop?`
              : `Running ${Math.floor(seconds / 3600)}h — long session. Stop & log if you've moved on.`}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 no-drag">
        <button
          onClick={() => swan.hide()}
          className="py-2.5 border border-line rounded-md text-[13px] text-ink hover:bg-black/[0.04] transition-colors"
        >
          Hide
        </button>
        <button
          onClick={stop}
          className="py-2.5 bg-ink text-paper rounded-md text-[13px] font-medium hover:bg-ink/90 transition-colors"
        >
          Stop & log
        </button>
      </div>

      <button
        onClick={discard}
        className={`mt-2 mx-auto text-[11px] no-drag transition-colors ${
          confirmDiscard
            ? 'text-accent font-medium'
            : 'text-mute hover:text-ink'
        }`}
      >
        {confirmDiscard ? 'Tap again to discard' : 'Discard timer'}
      </button>
    </div>
  );
}
