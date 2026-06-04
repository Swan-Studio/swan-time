import { useEffect, useMemo, useRef, useState } from 'react';
import { swan } from '../lib/swan';
import { Picker } from '../components/Picker';
import { CATEGORIES, DIVISIONS, Client, Creative } from '../lib/constants';
import { clientForCreative, creativeMatchesClient, creativesForClient } from '../lib/creatives';
import { minutesToHm } from '../lib/format';
import { levelFor } from '../lib/levels';
import { LevelPill } from '../components/LevelPill';

type Row = {
  id: string;
  date: string;
  name: string;
  clientId?: number;
  clientName?: string;
  creativeId?: number;
  creativeName?: string;
  division?: string;
  category?: string;
  durationMinutes: number;
  confidence: number;
  status: 'pending' | 'posting' | 'posted' | 'error';
  error?: string;
};

function todayIso(): string {
  // Local date, not UTC — otherwise users in AU/Asia get yesterday's date
  // when their local "today" is ahead of UTC.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff > -7 && diff < 0) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function newRow(partial: Partial<Row> = {}): Row {
  return {
    id: Math.random().toString(36).slice(2, 10),
    date: partial.date || todayIso(),
    name: partial.name || '',
    clientId: partial.clientId,
    clientName: partial.clientName,
    creativeId: partial.creativeId,
    creativeName: partial.creativeName,
    division: partial.division,
    category: partial.category,
    durationMinutes: partial.durationMinutes || 30,
    confidence: partial.confidence ?? 1,
    status: 'pending'
  };
}

type Props = { onClose: () => void };

export function Batch({ onClose }: Props) {
  const [text, setText] = useState('');
  const [primaryDivision, setPrimaryDivision] = useState<string | undefined>();
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [clients, setClients] = useState<Client[]>([]);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [creativesOn, setCreativesOn] = useState(false);
  const [todayLoggedMinutes, setTodayLoggedMinutes] = useState(0);
  const [levelsOn, setLevelsOn] = useState(true);
  const [categoryMinutes, setCategoryMinutes] = useState<Record<string, number>>({});
  const [aiState, setAiState] = useState<{ enabled: boolean; hasKey: boolean }>({
    enabled: false,
    hasKey: false
  });
  const aiAvailable = aiState.enabled && aiState.hasKey;
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [postSummary, setPostSummary] = useState<{ ok: number; fail: number } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  async function refreshTodayLogged() {
    try {
      const entries = await swan.todayEntries();
      setTodayLoggedMinutes(entries.reduce((acc: number, e: any) => acc + (e.minutes || 0), 0));
    } catch {
      // ignore — keep previous value
    }
  }

  useEffect(() => {
    swan.listClients().then(setClients).catch(() => {});
    swan.creativesEnabled().then((on: boolean) => {
      if (!on) return;
      setCreativesOn(true);
      swan.listCreatives().then(setCreatives).catch(() => {});
    }).catch(() => {});
    swan
      .aiStatus()
      .then(s => setAiState({ enabled: s.aiEnabled, hasKey: s.hasUserKey || s.hasSharedKey }));
    swan.getSettings().then(s => {
      setLevelsOn(s.levelsEnabled !== false);
      if (s.primaryDivision) {
        setPrimaryDivision(s.primaryDivision);
        // Default the existing first row to the primary division.
        setRows(rs =>
          rs.map(r => (r.division ? r : { ...r, division: s.primaryDivision }))
        );
      }
    });
    swan.getStats().then(s => setCategoryMinutes(s.categoryMinutes)).catch(() => {});
    refreshTodayLogged();
    setTimeout(() => textRef.current?.focus(), 100);
  }, []);

  function findClient(name?: string): { id?: number; name?: string } {
    if (!name) return {};
    const m = clients.find(c => c.name.toLowerCase() === name.toLowerCase());
    return m ? { id: m.id, name: m.name } : { name };
  }

  async function parse() {
    if (!text.trim()) return;
    setParsing(true);
    setParseError(null);
    try {
      const parsed = await swan.batchParse(text);
      const mapped: Row[] = parsed.map((p: any) => {
        const c = findClient(p.clientName);
        // AI-matched creative with no client: back-fill the creative's owner,
        // mirroring pickRowCreative's manual rule.
        const owner = p.creativeId && !c.id
          ? clientForCreative(creatives.find(cr => cr.id === p.creativeId), clients)
          : undefined;
        return newRow({
          date: p.date,
          name: p.name,
          clientId: c.id ?? owner?.id,
          clientName: c.name ?? owner?.name,
          creativeId: p.creativeId,
          creativeName: p.creativeName,
          division: p.division,
          category: p.category,
          durationMinutes: p.durationMinutes,
          confidence: p.confidence
        });
      });
      if (mapped.length === 0) {
        setParseError('Nothing parseable found in that text.');
        return;
      }
      setRows(mapped);
    } catch (e: any) {
      setParseError(e.message || String(e));
    } finally {
      setParsing(false);
    }
  }

  function update(id: string, patch: Partial<Row>) {
    setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  }

  function pickRowClient(id: string, clientId: number, clientName: string) {
    setRows(rs =>
      rs.map(r => {
        if (r.id !== id) return r;
        const next = { ...r, clientId, clientName };
        if (!creativeMatchesClient(creatives, r.creativeId, clientId)) {
          next.creativeId = undefined;
          next.creativeName = undefined;
        }
        return next;
      })
    );
  }

  function pickRowCreative(id: string, creativeId: number, creativeName: string) {
    const owner = clientForCreative(creatives.find(c => c.id === creativeId), clients);
    update(id, {
      creativeId,
      creativeName,
      ...(owner ? { clientId: owner.id, clientName: owner.name } : {})
    });
  }

  function addRow() {
    setRows(rs => [
      ...rs,
      newRow({ date: rs.at(-1)?.date || todayIso(), division: primaryDivision })
    ]);
  }

  function removeRow(id: string) {
    setRows(rs => (rs.length === 1 ? [newRow()] : rs.filter(r => r.id !== id)));
  }

  function shiftDate(id: string, days: number) {
    const minDate = isoDaysAgo(6);
    const maxDate = todayIso();
    setRows(rs =>
      rs.map(r => {
        if (r.id !== id) return r;
        const d = new Date(`${r.date}T00:00:00`);
        d.setDate(d.getDate() + days);
        const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (next < minDate || next > maxDate) return r;
        return { ...r, date: next };
      })
    );
  }

  const validity = useMemo(
    () =>
      rows.map(r => ({
        id: r.id,
        ready:
          r.name.trim().length > 0 &&
          /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
          r.durationMinutes > 0 &&
          !!r.division &&
          !!r.category
      })),
    [rows]
  );

  const allReady = validity.every(v => v.ready);
  const totalMinutes = rows.reduce((acc, r) => acc + (r.durationMinutes || 0), 0);
  const today = todayIso();
  const todayBatchMinutes = rows
    .filter(r => r.date === today)
    .reduce((acc, r) => acc + (r.durationMinutes || 0), 0);
  const todayCombined = todayLoggedMinutes + todayBatchMinutes;

  async function postAll() {
    if (!allReady) return;
    setPosting(true);
    setPostSummary(null);
    setRows(rs => rs.map(r => ({ ...r, status: 'posting' as const, error: undefined })));

    const payload = rows.map(r => ({
      date: r.date,
      name: r.name.trim(),
      durationMinutes: r.durationMinutes,
      clientId: r.clientId,
      clientName: r.clientName,
      creativeId: r.creativeId,
      creativeName: r.creativeName,
      division: r.division!,
      category: r.category!
    }));

    const res = await swan.batchPost(payload);
    setRows(rs =>
      rs.map((r, i) => {
        const result = res.results[i];
        if (!result) return { ...r, status: 'pending' as const };
        return result.ok
          ? { ...r, status: 'posted' as const }
          : { ...r, status: 'error' as const, error: result.error };
      })
    );
    const ok = res.results.filter((r: any) => r.ok).length;
    const fail = res.results.length - ok;
    setPostSummary({ ok, fail });
    setPosting(false);
    refreshTodayLogged();
  }

  function clearPosted() {
    setRows(rs => {
      const remaining = rs.filter(r => r.status !== 'posted');
      return remaining.length ? remaining : [newRow()];
    });
    setPostSummary(null);
    setText('');
  }

  return (
    <div className="flex flex-col h-full pt-[3px]">
      <header className="px-6 pt-3 pb-3 flex items-center justify-between draggable">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[20px] font-medium tracking-tight">Batch entry</h1>
          <span className="text-[11px] text-mute tabular">
            {rows.length} {rows.length === 1 ? 'row' : 'rows'} · {minutesToHm(totalMinutes)}
          </span>
        </div>
        <div className="flex items-center gap-3 no-drag">
          <span className="text-[11px] text-mute tabular" title="Already logged today + this batch (today's rows)">
            today <span className="text-ink">{minutesToHm(todayLoggedMinutes)}</span>
            <span className="mx-1 text-mute/60">+</span>
            <span className="text-ink">{minutesToHm(todayBatchMinutes)}</span>
            <span className="mx-1 text-mute/60">=</span>
            <span className="text-ink font-medium">{minutesToHm(todayCombined)}</span>
          </span>
          <button
            onClick={onClose}
            className="text-[11px] uppercase tracking-[0.08em] text-mute hover:text-ink font-medium"
          >
            Close
          </button>
        </div>
      </header>

      <section className="px-6 pb-3 no-drag">
        <textarea
          ref={textRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              parse();
            }
          }}
          placeholder={'yesterday: 2h editing for Acme — Content Delivery, 1h client meeting\nMon 9-11am research deck for Phyto, 1-3pm scripting'}
          rows={2}
          className="w-full px-3 py-2 bg-chip rounded-md text-[13px] resize-none focus:outline-none focus:ring-1 focus:ring-ink/15 placeholder:text-mute leading-relaxed"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            onClick={parse}
            disabled={!aiAvailable || parsing || !text.trim()}
            className="px-3 py-1.5 bg-ink text-paper rounded-md text-[12px] font-medium hover:bg-ink/90 disabled:opacity-30 transition-colors"
          >
            {parsing ? 'Parsing…' : 'Parse with AI'}
            <span className="ml-2  text-[10px] opacity-60">⌘↵</span>
          </button>
          {!aiAvailable && (
            <span className="text-[11px] text-mute">
              {!aiState.enabled
                ? 'AI is off — turn it on in Settings to parse.'
                : 'No Anthropic key found — set SWAN_ANTHROPIC_KEY in .env.local or paste a personal key in Settings.'}
            </span>
          )}
          {parseError && <span className="text-[11px] text-accent">{parseError}</span>}
        </div>
      </section>

      <section className="flex-1 overflow-auto px-4 pb-2 no-drag">
        {rows.map((r, i) => {
          const v = validity[i];
          const lowConfidence = r.confidence > 0 && r.confidence < 0.5;
          const tone =
            r.status === 'posted'
              ? 'bg-emerald-500/[0.08]'
              : r.status === 'error'
              ? 'bg-accent/[0.08]'
              : lowConfidence
              ? 'bg-yellow-500/[0.06]'
              : 'hover:bg-ink/[0.08]';
          const gridCols = creativesOn
            ? 'grid-cols-[88px_220px_180px_180px_180px_180px_80px_24px]'
            : 'grid-cols-[88px_220px_180px_180px_180px_80px_24px]';
          return (
            <div
              key={r.id}
              className={`grid ${gridCols} w-max gap-2 items-center px-2 py-1.5 rounded-md ${tone}`}
            >
              <div
                className="flex items-center justify-between bg-chip rounded h-[28px] px-1"
                onWheel={e => {
                  e.preventDefault();
                  shiftDate(r.id, e.deltaY > 0 ? -1 : 1);
                }}
                title={r.date}
              >
                <button
                  onClick={() => shiftDate(r.id, -1)}
                  disabled={r.date <= isoDaysAgo(6)}
                  className="px-1 text-mute hover:text-ink disabled:opacity-25 text-[14px] leading-none"
                  aria-label="Previous day"
                >
                  ‹
                </button>
                <span className="text-[12px] tabular truncate px-1">
                  {formatDateLabel(r.date)}
                </span>
                <button
                  onClick={() => shiftDate(r.id, 1)}
                  disabled={r.date >= todayIso()}
                  className="px-1 text-mute hover:text-ink disabled:opacity-25 text-[14px] leading-none"
                  aria-label="Next day"
                >
                  ›
                </button>
              </div>
              <input
                value={r.name}
                onChange={e => update(r.id, { name: e.target.value })}
                placeholder="Activity"
                className="w-full px-2 py-1.5 bg-chip rounded text-[12px] focus:outline-none focus:ring-1 focus:ring-ink/15"
              />
              <Picker
                label="Client"
                value={r.clientName}
                placeholder="—"
                options={clients.map(c => ({ id: c.id, label: c.name }))}
                onChange={(id, label) => pickRowClient(r.id, Number(id), label)}
              />
              {creativesOn && (
                <Picker
                  label="Creative"
                  value={r.creativeName}
                  placeholder="—"
                  options={creativesForClient(creatives, r.clientId).map(c => ({ id: c.id, label: c.name }))}
                  onChange={(id, label) => pickRowCreative(r.id, Number(id), label)}
                />
              )}
              <Picker
                label="Division"
                value={r.division}
                options={DIVISIONS.map(d => ({ id: d, label: d }))}
                onChange={(_, l) => update(r.id, { division: l })}
                highlightId={primaryDivision}
              />
              <Picker
                label="Category"
                value={r.category}
                options={CATEGORIES.map(c => ({ id: c, label: c }))}
                onChange={(_, l) => update(r.id, { category: l })}
                optionMeta={
                  levelsOn
                    ? (_, label) => <LevelPill level={levelFor(categoryMinutes[label] || 0)} />
                    : undefined
                }
              />
              <input
                type="number"
                min={1}
                value={r.durationMinutes}
                onChange={e =>
                  update(r.id, { durationMinutes: Math.max(1, Number(e.target.value) || 0) })
                }
                className="w-full px-2 py-1.5 bg-chip rounded text-[12px]  tabular text-right focus:outline-none focus:ring-1 focus:ring-ink/15"
              />
              <button
                onClick={() => removeRow(r.id)}
                className="text-[16px] leading-none text-mute hover:text-accent"
                title="Remove row"
              >
                ×
              </button>
              {r.status === 'error' && r.error && (
                <div className={`${creativesOn ? 'col-span-8' : 'col-span-7'} px-2 pt-0.5 pb-1 text-[10px] text-accent`}>{r.error}</div>
              )}
            </div>
          );
        })}
        <button
          onClick={addRow}
          className="ml-2 mt-2 text-[11px] text-mute hover:text-ink underline-offset-2 hover:underline"
        >
          + Add row
        </button>
      </section>

      <footer className="px-6 py-3 border-t border-line flex items-center justify-between no-drag">
        <div className="text-[12px] text-mute">
          {postSummary ? (
            <>
              <span className="text-ink font-medium">{postSummary.ok} posted</span>
              {postSummary.fail > 0 && (
                <span className="text-accent ml-2">{postSummary.fail} failed</span>
              )}
            </>
          ) : (
            <>
              {rows.filter((_, i) => validity[i].ready).length} / {rows.length} ready
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {postSummary && postSummary.ok > 0 && (
            <button
              onClick={clearPosted}
              className="px-3 py-1.5 border border-line rounded-md text-[12px] hover:bg-ink/[0.04] transition-colors"
            >
              Clear posted
            </button>
          )}
          <button
            onClick={postAll}
            disabled={!allReady || posting}
            className="px-4 py-1.5 bg-ink text-paper rounded-md text-[12px] font-medium hover:bg-ink/90 disabled:opacity-30 transition-colors"
          >
            {posting ? 'Posting…' : `Post ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`}
          </button>
        </div>
      </footer>
    </div>
  );
}
