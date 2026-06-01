import { useEffect, useMemo, useState } from 'react';
import { swan } from '../lib/swan';
import { CATEGORIES } from '../lib/constants';
import { levelProgress } from '../lib/levels';
import { minutesToHm } from '../lib/format';

type Props = { onClose: () => void };

export function Levels({ onClose }: Props) {
  const [categoryMinutes, setCategoryMinutes] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    swan
      .getStats()
      .then(s => setCategoryMinutes(s.categoryMinutes))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Show only categories with logged time, sorted by current level desc
  // then by minutes desc so the user's strongest tasks float to the top.
  const rows = useMemo(() => {
    return CATEGORIES.map(name => {
      const minutes = categoryMinutes[name] || 0;
      const p = levelProgress(minutes);
      return { name, minutes, ...p };
    })
      .filter(r => r.minutes > 0)
      .sort((a, b) =>
        b.level !== a.level ? b.level - a.level : b.minutes - a.minutes
      );
  }, [categoryMinutes]);

  return (
    <div className="flex flex-col h-full px-5 pt-4 pb-5 animate-rise">
      <div className="flex items-center justify-between draggable mb-3">
        <h1 className="text-[18px] font-medium tracking-tight">Levels</h1>
        <button
          onClick={onClose}
          className="no-drag text-[11px] uppercase tracking-[0.08em] text-mute hover:text-ink font-medium"
        >
          Back
        </button>
      </div>

      <div className="flex-1 overflow-y-auto no-drag space-y-2.5">
        {loading && <div className="px-1 py-2 text-[12px] text-mute">Loading…</div>}
        {!loading &&
          rows.map(r => (
            <div key={r.name} className="px-1">
              <div className="flex items-baseline justify-between mb-1">
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-[13px] text-ink truncate">{r.name}</span>
                  <span className="text-[10px] tabular text-accent font-semibold tracking-wider">
                    Lv{r.level}
                  </span>
                </div>
                <span className="text-[10px] text-mute tabular shrink-0">
                  {minutesToHm(r.inLevelMinutes)} / {minutesToHm(r.nextLevelGap)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-chip overflow-hidden">
                <div
                  className="h-full bg-swan-gradient rounded-full"
                  style={{ width: `${Math.round(r.fraction * 100)}%` }}
                />
              </div>
            </div>
          ))}
      </div>

      <div className="mt-3 text-[10px] text-mute leading-relaxed no-drag">
        Each level needs 1.2× the previous gap. Lifetime view based on the last 90 days of Monday entries.
      </div>
    </div>
  );
}
