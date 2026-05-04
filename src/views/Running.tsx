import { useEffect, useState } from 'react';
import { swan } from '../lib/swan';
import { formatElapsed } from '../lib/format';
import type { Running as RunningT } from '../lib/constants';

type Props = {
  timer: NonNullable<RunningT>;
  onStopped: (result?: { minutes: number }) => void;
  onNeedsCategory: () => void;
};

export function Running({ timer, onStopped, onNeedsCategory }: Props) {
  const [seconds, setSeconds] = useState(Math.floor((Date.now() - timer.startedAt) / 1000));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const off = swan.onTimerTick(setSeconds);
    return () => off();
  }, []);

  async function stop() {
    if (!timer.division || !timer.category) {
      onNeedsCategory();
      return;
    }
    setBusy(true);
    setError(null);
    const res = await swan.stopTimer();
    setBusy(false);
    if (!res.ok) {
      setError(res.error || 'Failed to log entry');
      return;
    }
    onStopped(res.minutes ? { minutes: res.minutes } : undefined);
  }

  const breadcrumb = [timer.clientName, timer.division, timer.category].filter(Boolean).join(' · ') || 'No category yet';

  return (
    <div className="flex flex-col h-full px-5 pt-4 pb-5 animate-rise">
      <div className="flex items-center justify-between draggable">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-swan-gradient animate-livepulse shadow-[0_0_8px_rgba(255,78,1,0.4)]" />
          <span className="text-[10px] uppercase tracking-[0.12em] text-accent font-semibold">
            Running
          </span>
        </div>
        <button
          onClick={() => swan.hide()}
          className="no-drag text-[11px] uppercase tracking-[0.08em] text-mute hover:text-ink font-medium"
        >
          Hide
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="font-mono tabular text-timer text-ink font-medium">
          {formatElapsed(seconds)}
        </div>
        <div className="mt-4 max-w-full">
          <div className="font-display text-[17px] text-ink leading-snug truncate px-4">
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

      {error && (
        <div className="text-[12px] text-accent text-center mb-2 no-drag">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-2 no-drag">
        <button
          onClick={() => swan.hide()}
          className="py-2.5 border border-line rounded-md text-[13px] text-ink hover:bg-black/[0.04] transition-colors"
        >
          Hide
        </button>
        <button
          onClick={stop}
          disabled={busy}
          className="py-2.5 bg-ink text-paper rounded-md text-[13px] font-medium hover:bg-ink/90 disabled:opacity-50 transition-colors"
        >
          {busy ? 'Logging…' : 'Stop & log'}
        </button>
      </div>
    </div>
  );
}
