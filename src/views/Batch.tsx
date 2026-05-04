import { useEffect, useMemo, useRef, useState } from 'react';
import { swan } from '../lib/swan';
import { Picker } from '../components/Picker';
import { CATEGORIES, DIVISIONS, Client } from '../lib/constants';
import { minutesToHm } from '../lib/format';

type Row = {
  id: string;
  date: string;
  name: string;
  clientId?: number;
  clientName?: string;
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

  useEffect(() => {
    swan.listClients().then(setClients).catch(() => {});
    swan
      .aiStatus()
      .then(s => setAiState({ enabled: s.aiEnabled, hasKey: s.hasUserKey || s.hasSharedKey }));
    swan.getSettings().then(s => {
      if (s.primaryDivision) {
        setPrimaryDivision(s.primaryDivision);
        // Default the existing first row to the primary division.
        setRows(rs =>
          rs.map(r => (r.division ? r : { ...r, division: s.primaryDivision }))
        );
      }
    });
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
        return newRow({
          date: p.date,
          name: p.name,
          clientId: c.id,
          clientName: c.name,
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
    setRows(rs =>
      rs.map(r => {
        if (r.id !== id) return r;
        const d = new Date(`${r.date}T00:00:00`);
        d.setDate(d.getDate() + days);
        return { ...r, date: d.toISOString().slice(0, 10) };
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
          <h1 className="font-display text-[20px] font-medium tracking-tight">Batch entry</h1>
          <span className="text-[11px] text-mute tabular">
            {rows.length} {rows.length === 1 ? 'row' : 'rows'} · {minutesToHm(totalMinutes)}
          </span>
        </div>
        <button
          onClick={onClose}
          className="no-drag text-[11px] uppercase tracking-[0.08em] text-mute hover:text-ink font-medium"
        >
          Close
        </button>
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
            <span className="ml-2 font-mono text-[10px] opacity-60">⌘↵</span>
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

      <section className="flex-1 overflow-y-auto px-4 pb-2 no-drag">
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
              : 'hover:bg-ink/[0.02]';
          return (
            <div
              key={r.id}
              className={`grid grid-cols-[88px_1.4fr_1fr_1fr_1fr_64px_24px] gap-2 items-center px-2 py-1.5 rounded-md ${tone}`}
            >
              <button
                onClick={() => {
                  const next = prompt('Date (YYYY-MM-DD or "today"/"yesterday")', r.date);
                  if (!next) return;
                  const lower = next.trim().toLowerCase();
                  if (lower === 'today') update(r.id, { date: todayIso() });
                  else if (lower === 'yesterday') {
                    const d = new Date();
                    d.setDate(d.getDate() - 1);
                    update(r.id, { date: d.toISOString().slice(0, 10) });
                  } else if (/^\d{4}-\d{2}-\d{2}$/.test(next.trim())) {
                    update(r.id, { date: next.trim() });
                  }
                }}
                onWheel={e => {
                  e.preventDefault();
                  shiftDate(r.id, e.deltaY > 0 ? -1 : 1);
                }}
                className="px-2 py-1.5 bg-chip rounded text-[12px] font-mono tabular text-left hover:bg-ink/[0.06]"
                title={r.date}
              >
                {formatDateLabel(r.date)}
              </button>
              <input
                value={r.name}
                onChange={e => update(r.id, { name: e.target.value })}
                placeholder="Activity"
                className="px-2 py-1.5 bg-chip rounded text-[12px] focus:outline-none focus:ring-1 focus:ring-ink/15"
              />
              <Picker
                label="Client"
                value={r.clientName}
                placeholder="—"
                options={clients.map(c => ({ id: c.id, label: c.name }))}
                onChange={(id, label) => update(r.id, { clientId: Number(id), clientName: label })}
              />
              <Picker
                label="Division"
                value={r.division}
                options={DIVISIONS.map(d => ({ id: d, label: d }))}
                onChange={(_, l) => update(r.id, { division: l })}
              />
              <Picker
                label="Category"
                value={r.category}
                options={CATEGORIES.map(c => ({ id: c, label: c }))}
                onChange={(_, l) => update(r.id, { category: l })}
              />
              <input
                type="number"
                min={1}
                value={r.durationMinutes}
                onChange={e =>
                  update(r.id, { durationMinutes: Math.max(1, Number(e.target.value) || 0) })
                }
                className="px-2 py-1.5 bg-chip rounded text-[12px] font-mono tabular text-right focus:outline-none focus:ring-1 focus:ring-ink/15"
              />
              <button
                onClick={() => removeRow(r.id)}
                className="text-[16px] leading-none text-mute hover:text-accent"
                title="Remove row"
              >
                ×
              </button>
              {r.status === 'error' && r.error && (
                <div className="col-span-7 px-2 pt-0.5 pb-1 text-[10px] text-accent">{r.error}</div>
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
