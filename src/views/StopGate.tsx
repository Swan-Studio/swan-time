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

  // Prefill only — the untouched case sends no override, so main's own
  // ms-precision rounding (logEntry) stays authoritative for what gets logged.
  const liveMinutes = Math.max(1, Math.ceil(seconds / 60));
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
            onFocus={() => setDurationText(t => t ?? String(liveMinutes))}
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
