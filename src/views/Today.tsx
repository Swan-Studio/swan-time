import { useEffect, useState } from 'react';
import { swan } from '../lib/swan';
import { Picker } from '../components/Picker';
import { CATEGORIES, DIVISIONS, Client, Creative } from '../lib/constants';
import { clientForCreative, creativeMatchesClient, creativesForClient } from '../lib/creatives';
import { minutesToHm } from '../lib/format';
import { flagEntry } from '../lib/flags';
import { levelFor } from '../lib/levels';
import { LevelPill } from '../components/LevelPill';

type Entry = {
  id: number;
  name: string;
  clientName?: string;
  creativeName?: string;
  division?: string;
  category?: string;
  minutes: number;
  date?: string;
};

type Draft = {
  name: string;
  clientId?: number;
  clientName?: string;
  creativeId?: number;
  creativeName?: string;
  division?: string;
  category?: string;
  durationMinutes: number;
  date: string;
};

function todayIsoLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff > -7 && diff < 0) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type Props = { onClose: () => void };

export function Today({ onClose }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiOn, setAiOn] = useState(false);
  const [levelsOn, setLevelsOn] = useState(true);
  const [categoryMinutes, setCategoryMinutes] = useState<Record<string, number>>({});
  const [clients, setClients] = useState<Client[]>([]);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [creativesOn, setCreativesOn] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
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
    swan.getSettings().then(s => {
      setAiOn(s.aiEnabled);
      setLevelsOn(s.levelsEnabled !== false);
    });
    swan.getStats().then(s => setCategoryMinutes(s.categoryMinutes)).catch(() => {});
    swan.listClients().then(setClients).catch(() => {});
    swan.creativesEnabled().then((on: boolean) => {
      if (!on) return;
      setCreativesOn(true);
      swan.listCreatives().then(setCreatives).catch(() => {});
    }).catch(() => {});
  }, []);

  function startEdit(e: Entry) {
    const matchedClient = e.clientName
      ? clients.find(c => c.name.toLowerCase() === e.clientName!.toLowerCase())
      : undefined;
    const matchedCreative = e.creativeName
      ? creatives.find(c => c.name.toLowerCase() === e.creativeName!.toLowerCase())
      : undefined;
    setEditingId(e.id);
    setEditError(null);
    setDraft({
      name: e.name,
      clientId: matchedClient?.id,
      clientName: matchedClient?.name ?? e.clientName,
      creativeId: matchedCreative?.id,
      creativeName: matchedCreative?.name ?? e.creativeName,
      division: e.division,
      category: e.category,
      durationMinutes: e.minutes,
      date: e.date || todayIsoLocal()
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setEditError(null);
  }

  async function saveEdit() {
    if (!editingId || !draft) return;
    if (!draft.name.trim() || !draft.division || !draft.category || draft.durationMinutes <= 0) {
      setEditError('Name, division, category and minutes are required.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
      setEditError('Date must be in YYYY-MM-DD format.');
      return;
    }
    setSaving(true);
    setEditError(null);
    const res = await swan.updateEntry({
      itemId: editingId,
      name: draft.name.trim(),
      clientId: draft.clientId,
      creativeId: draft.creativeId,
      division: draft.division,
      category: draft.category,
      durationMinutes: draft.durationMinutes,
      date: draft.date
    });
    setSaving(false);
    if (!res.ok) {
      setEditError(res.error || 'Update failed');
      return;
    }
    cancelEdit();
    await load();
    swan.getStats().then(s => setCategoryMinutes(s.categoryMinutes)).catch(() => {});
  }

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
          <h1 className="text-[18px] font-medium tracking-tight">Today</h1>
          <span className="text-[11px] text-mute  tabular">{minutesToHm(total)}</span>
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
            const isEditing = editingId === e.id && draft;
            if (isEditing) {
              return (
                <div
                  key={e.id}
                  className="px-2 py-2 rounded bg-ink/[0.04] border border-line space-y-2"
                >
                  <input
                    value={draft!.name}
                    onChange={ev => setDraft(d => d && { ...d, name: ev.target.value })}
                    placeholder="Activity"
                    autoFocus
                    className="w-full px-2 py-1.5 bg-paper rounded text-[13px] focus:outline-none focus:ring-1 focus:ring-ink/15"
                  />
                  <div className="grid grid-cols-1 gap-1.5">
                    <Picker
                      label="Client"
                      value={draft!.clientName}
                      placeholder="—"
                      options={clients.map(c => ({ id: c.id, label: c.name }))}
                      onChange={(id, label) =>
                        setDraft(d => {
                          if (!d) return d;
                          const next = { ...d, clientId: Number(id), clientName: label };
                          if (!creativeMatchesClient(creatives, d.creativeId, Number(id))) {
                            next.creativeId = undefined;
                            next.creativeName = undefined;
                          }
                          return next;
                        })
                      }
                    />
                    {creativesOn && (
                      <Picker
                        label="Creative"
                        value={draft!.creativeName}
                        placeholder="—"
                        options={creativesForClient(creatives, draft!.clientId).map(c => ({ id: c.id, label: c.name }))}
                        onChange={(id, label) =>
                          setDraft(d => {
                            if (!d) return d;
                            const owner = clientForCreative(creatives.find(c => c.id === Number(id)), clients);
                            return {
                              ...d,
                              creativeId: Number(id),
                              creativeName: label,
                              ...(owner ? { clientId: owner.id, clientName: owner.name } : {})
                            };
                          })
                        }
                      />
                    )}
                    <Picker
                      label="Division"
                      value={draft!.division}
                      options={DIVISIONS.map(d => ({ id: d, label: d }))}
                      onChange={(_, l) => setDraft(d => d && { ...d, division: l })}
                    />
                    <Picker
                      label="Category"
                      value={draft!.category}
                      options={CATEGORIES.map(c => ({ id: c, label: c }))}
                      onChange={(_, l) => setDraft(d => d && { ...d, category: l })}
                      optionMeta={
                        levelsOn
                          ? (_, label) => <LevelPill level={levelFor(categoryMinutes[label] || 0)} />
                          : undefined
                      }
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-mute uppercase tracking-[0.08em] font-medium">
                      Date
                    </label>
                    <div className="flex items-center bg-paper rounded h-[28px] px-1">
                      <button
                        onClick={() =>
                          setDraft(d => {
                            if (!d) return d;
                            const next = shiftIso(d.date, -1);
                            return next < isoDaysAgo(6) ? d : { ...d, date: next };
                          })
                        }
                        disabled={draft!.date <= isoDaysAgo(6)}
                        className="px-2 text-mute hover:text-ink disabled:opacity-25 text-[14px] leading-none"
                        aria-label="Previous day"
                      >
                        ‹
                      </button>
                      <span className="text-[12px] tabular px-2 min-w-[72px] text-center">
                        {dateLabel(draft!.date)}
                      </span>
                      <button
                        onClick={() =>
                          setDraft(d => {
                            if (!d) return d;
                            const next = shiftIso(d.date, 1);
                            return next > todayIsoLocal() ? d : { ...d, date: next };
                          })
                        }
                        disabled={draft!.date >= todayIsoLocal()}
                        className="px-2 text-mute hover:text-ink disabled:opacity-25 text-[14px] leading-none"
                        aria-label="Next day"
                      >
                        ›
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-mute uppercase tracking-[0.08em] font-medium">
                      Minutes
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={draft!.durationMinutes}
                      onChange={ev =>
                        setDraft(d =>
                          d && { ...d, durationMinutes: Math.max(1, Number(ev.target.value) || 0) }
                        )
                      }
                      className="w-20 px-2 py-1 bg-paper rounded text-[12px] tabular text-right focus:outline-none focus:ring-1 focus:ring-ink/15"
                    />
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        onClick={cancelEdit}
                        disabled={saving}
                        className="text-[11px] uppercase tracking-[0.08em] text-mute hover:text-ink font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveEdit}
                        disabled={saving}
                        className="px-3 py-1 bg-ink text-paper rounded-md text-[12px] font-medium hover:bg-ink/90 disabled:opacity-40 transition-colors"
                      >
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                  {editError && (
                    <div className="text-[11px] text-accent">{editError}</div>
                  )}
                </div>
              );
            }
            return (
              <div
                key={e.id}
                className={`group flex items-start gap-3 px-2 py-2 rounded ${
                  hasWarn ? 'bg-accent/[0.05] hover:bg-accent/[0.08]' : 'hover:bg-ink/[0.04]'
                }`}
              >
                <span className="tabular text-[12px] text-mute pt-0.5 w-12">
                  {minutesToHm(e.minutes)}
                </span>
                <button
                  onClick={() => startEdit(e)}
                  className="flex-1 min-w-0 text-left"
                  title="Edit entry"
                >
                  <div className="text-[13px] text-ink truncate">{e.name}</div>
                  <div className="text-[11px] text-mute truncate flex items-center gap-1.5">
                    <span className="truncate">
                      {[e.clientName, e.creativeName, e.division, e.category].filter(Boolean).join(' · ') || '—'}
                    </span>
                    {levelsOn && e.category && (
                      <LevelPill
                        level={levelFor(categoryMinutes[e.category] || 0)}
                        title={`Lv ${levelFor(categoryMinutes[e.category] || 0)} in ${e.category}`}
                      />
                    )}
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
                </button>
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
            <div className="px-3 py-2 bg-chip rounded-md text-[12px] text-ink leading-relaxed  max-h-32 overflow-y-auto">
              {summary}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
