import { useState } from 'react';
import { swan } from '../lib/swan';
import { Picker } from '../components/Picker';
import { CATEGORIES, DIVISIONS } from '../lib/constants';
import type { Running } from '../lib/constants';

type Props = {
  timer: NonNullable<Running>;
  onLogged: (result?: { minutes: number }) => void;
  onCancel: () => void;
};

export function StopGate({ timer, onLogged, onCancel }: Props) {
  const [division, setDivision] = useState(timer.division);
  const [category, setCategory] = useState(timer.category);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function log() {
    if (!division || !category) return;
    setBusy(true);
    await swan.updateTimer({ division, category });
    const res = await swan.stopTimer();
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
        <h1 className="font-display text-[16px] font-medium tracking-tight">
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
        Pick a division and category before this can be logged. Your timer is still running.
      </p>

      <div className="space-y-2 no-drag">
        <Picker
          label="Division"
          value={division}
          options={DIVISIONS.map(d => ({ id: d, label: d }))}
          onChange={(_, l) => setDivision(l)}
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
          disabled={!division || !category || busy}
          className="py-2.5 bg-ink text-paper rounded-md text-[13px] font-medium hover:bg-ink/90 disabled:opacity-30 transition-colors"
        >
          {busy ? 'Logging…' : 'Log entry'}
        </button>
      </div>
    </div>
  );
}
