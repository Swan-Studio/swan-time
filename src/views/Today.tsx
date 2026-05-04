import { useEffect, useMemo, useState } from 'react';
import { swan } from '../lib/swan';
import { minutesToHm } from '../lib/format';
import { flagEntry } from '../lib/flags';

type Entry = {
  id: number;
  name: string;
  clientName?: string;
  division?: string;
  category?: string;
  minutes: number;
  date?: string;
};

type Props = { onClose: () => void };

export function Today({ onClose }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiOn, setAiOn] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarising, setSummarising] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await swan.todayEntries();
      setEntries(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    swan.getSettings().then(s => setAiOn(s.aiEnabled));
  }, []);

  async function del(id: number) {
    setEntries(es => es.filter(e => e.id !== id));
    try {
      await swan.deleteEntry(id);
    } catch {
      load();
    }
  }

  async function summarise() {
    setSummarising(true);
    try {
      const text = await swan.dailySummary();
      setSummary(text);
    } finally {
      setSummarising(false);
    }
  }

  const total = entries.reduce((a, e) => a + e.minutes, 0);

  return (
    <div className="flex flex-col h-full px-5 pt-4 pb-5 animate-rise">
      <div className="flex items-center justify-between draggable mb-3">
        <div className="flex items-baseline gap-2">
          <h1 className="font-display text-[18px] font-medium tracking-tight">Today</h1>
          <span className="text-[11px] text-mute font-mono tabular">{minutesToHm(total)}</span>
        </div>
        <button
          onClick={onClose}
          className="no-drag text-[11px] uppercase tracking-[0.08em] text-mute hover:text-ink font-medium"
        >
          Back
        </button>
      </div>

      <div className="flex-1 overflow-y-auto no-drag -mx-1">
        {loading && <div className="px-2 py-4 text-[12px] text-mute">Loading…</div>}
        {!loading && entries.length === 0 && (
          <div className="px-2 py-8 text-center text-[12px] text-mute">
            Nothing logged yet today.
          </div>
        )}
        {!loading &&
          entries.map(e => {
            const flags = flagEntry(e, entries);
            const hasWarn = flags.some(f => f.level === 'warn');
            return (
              <div
                key={e.id}
                className={`group flex items-start gap-3 px-2 py-2 rounded ${
                  hasWarn ? 'bg-accent/[0.05] hover:bg-accent/[0.08]' : 'hover:bg-ink/[0.04]'
                }`}
              >
                <span className="font-mono tabular text-[12px] text-mute pt-0.5 w-12">
                  {minutesToHm(e.minutes)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-ink truncate">{e.name}</div>
                  <div className="text-[11px] text-mute truncate">
                    {[e.clientName, e.division, e.category].filter(Boolean).join(' · ') || '—'}
                  </div>
                  {flags.map((f, i) => (
                    <div
                      key={i}
                      className={`text-[10px] mt-0.5 ${
                        f.level === 'warn' ? 'text-accent' : 'text-mute'
                      }`}
                    >
                      ⚠ {f.message}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => del(e.id)}
                  className="opacity-0 group-hover:opacity-100 text-[11px] text-mute hover:text-accent transition-opacity"
                >
                  Delete
                </button>
              </div>
            );
          })}
      </div>

      {aiOn && (
        <div className="mt-3 no-drag">
          {!summary ? (
            <button
              onClick={summarise}
              disabled={summarising || entries.length === 0}
              className="w-full py-2 border border-line rounded-md text-[12px] text-ink hover:bg-black/[0.04] disabled:opacity-40 transition-colors"
            >
              {summarising ? 'Summarising…' : 'AI summary of today'}
            </button>
          ) : (
            <div className="px-3 py-2 bg-chip rounded-md text-[12px] text-ink leading-relaxed font-display max-h-32 overflow-y-auto">
              {summary}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
