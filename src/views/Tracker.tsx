import { useEffect, useRef, useState } from 'react';
import { swan } from '../lib/swan';
import { Picker } from '../components/Picker';
import { AiStrip } from '../components/AiStrip';
import { CATEGORIES, DIVISIONS, Client, Recent } from '../lib/constants';
import { minutesToHm } from '../lib/format';

type Props = {
  onStarted: () => void;
  onOpenToday: () => void;
  onOpenSettings: () => void;
  userName?: string;
  lastLog: { minutes: number } | null;
  onClearLastLog: () => void;
};

export function Tracker({ onStarted, onOpenToday, onOpenSettings, userName, lastLog, onClearLastLog }: Props) {
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState<number | undefined>();
  const [clientName, setClientName] = useState<string | undefined>();
  const [division, setDivision] = useState<string | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [clients, setClients] = useState<Client[]>([]);
  const [recents, setRecents] = useState<Recent[]>([]);
  const [aiOn, setAiOn] = useState(false);
  const [suggestion, setSuggestion] = useState<{
    division?: string;
    category?: string;
    confidence: number;
  }>({ confidence: 0 });
  const [dismissed, setDismissed] = useState(false);
  const [lastLogStatus, setLastLogStatus] = useState<{ lastDate: string | null; daysSince: number | null } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<number | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    swan.listClients().then(setClients).catch(() => {});
    swan.getRecents().then(setRecents);
    swan.getSettings().then(s => {
      setAiOn(s.aiEnabled);
      // Pre-fill division with user's primary if not yet set.
      if (s.primaryDivision && !division) setDivision(s.primaryDivision);
    });
    swan.lastLogStatus().then(setLastLogStatus).catch(() => {});
    const off = swan.onShow(() => inputRef.current?.focus());
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!lastLog) return;
    const t = window.setTimeout(onClearLastLog, 3500);
    return () => window.clearTimeout(t);
  }, [lastLog, onClearLastLog]);

  useEffect(() => {
    if (!aiOn || !name.trim() || dismissed) {
      setSuggestion({ confidence: 0 });
      return;
    }
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      swan.suggestCategory(name).then(setSuggestion).catch(() => {});
    }, 600);
  }, [name, aiOn, dismissed]);

  function applyRecent(r: Recent) {
    setName(r.name);
    setClientId(r.clientId);
    setClientName(r.clientName);
    setDivision(r.division);
    setCategory(r.category);
  }

  // Auto-set division based on client history. Pick the most-frequent division
  // this user has used for this client. Won't override a manual selection.
  useEffect(() => {
    if (!clientId || division) return;
    const matches = recents.filter(r => r.clientId === clientId && r.division);
    if (matches.length === 0) return;
    const counts = new Map<string, number>();
    for (const r of matches) counts.set(r.division!, (counts.get(r.division!) || 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) setDivision(top[0]);
  }, [clientId, recents, division]);

  async function start() {
    if (!name.trim()) return;
    await swan.startTimer({ name: name.trim(), clientId, clientName, division, category });
    onStarted();
  }

  function onKey(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      start();
    } else if (e.key === 'Escape') {
      swan.hide();
    }
  }

  return (
    <div className="flex flex-col h-full px-5 pt-4 pb-5 animate-rise">
      <div className="flex items-center justify-between mb-3 draggable">
        <div className="flex items-baseline gap-2">
          <h1 className="font-display text-[18px] font-medium tracking-tight">Swan Time</h1>
          {userName && (
            <span className="text-[11px] text-mute font-mono">{userName.split(/\s+/)[0]}</span>
          )}
        </div>
        <div className="flex items-center gap-3 no-drag">
          <button
            onClick={() => swan.batchOpen()}
            className="text-[11px] uppercase tracking-[0.08em] text-mute hover:text-ink font-medium"
            title="Batch entry"
          >
            Batch
          </button>
          <button
            onClick={onOpenSettings}
            className="text-[11px] uppercase tracking-[0.08em] text-mute hover:text-ink font-medium"
            title="Settings (⌘,)"
          >
            Settings
          </button>
          <button
            onClick={onOpenToday}
            className="text-[11px] uppercase tracking-[0.08em] text-mute hover:text-ink font-medium"
          >
            Today
          </button>
        </div>
      </div>

      {lastLog && (
        <div className="mb-3 px-3 py-1.5 bg-ink/[0.04] border border-line rounded-md flex items-center justify-between animate-rise">
          <span className="text-[12px] text-ink">
            Logged <span className="font-mono tabular">{minutesToHm(lastLog.minutes)}</span>
          </span>
          <button
            onClick={onClearLastLog}
            className="text-[11px] text-mute hover:text-ink"
          >
            ×
          </button>
        </div>
      )}

      {!lastLog && lastLogStatus && lastLogStatus.daysSince !== null && lastLogStatus.daysSince >= 2 && (
        <button
          onClick={() => swan.batchOpen()}
          className="no-drag w-full mb-3 px-3 py-2 bg-accent/[0.08] border border-accent/30 rounded-md text-left hover:bg-accent/[0.12] transition-colors animate-rise"
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-accent font-medium">
              {lastLogStatus.daysSince} days since last log
            </span>
            <span className="text-[11px] text-accent">Catch up →</span>
          </div>
          <div className="text-[10px] text-accent/80 mt-0.5">
            Last entry was {lastLogStatus.lastDate}. Use Batch entry to back-fill.
          </div>
        </button>
      )}

      <input
        ref={inputRef}
        value={name}
        onChange={e => {
          setName(e.target.value);
          setDismissed(false);
        }}
        onKeyDown={onKey}
        placeholder="What are you working on?"
        className="no-drag w-full bg-transparent text-[15px] font-medium placeholder:text-mute placeholder:font-normal pb-2 border-b border-line focus:border-ink/40 transition-colors"
      />

      <AiStrip
        {...suggestion}
        onAccept={() => {
          if (suggestion.division) setDivision(suggestion.division);
          if (suggestion.category) setCategory(suggestion.category);
          setDismissed(true);
        }}
        onDismiss={() => setDismissed(true)}
      />

      <div className="grid grid-cols-1 gap-2 mt-4">
        <Picker
          label="Client"
          value={clientName}
          placeholder="—"
          options={clients.map(c => ({ id: c.id, label: c.name }))}
          onChange={(id, label) => {
            setClientId(Number(id));
            setClientName(label);
          }}
        />
        <div className="grid grid-cols-2 gap-2">
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
      </div>

      {!name && recents.length > 0 && (
        <div className="mt-4 flex-1 overflow-y-auto no-drag">
          <div className="text-[10px] uppercase tracking-[0.1em] text-mute font-medium mb-2">
            Recent
          </div>
          <div className="space-y-1">
            {recents.slice(0, 4).map(r => (
              <button
                key={r.name + r.lastUsed}
                onClick={() => applyRecent(r)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-black/[0.04] group"
              >
                <div className="text-[13px] text-ink truncate">{r.name}</div>
                <div className="text-[11px] text-mute truncate">
                  {[r.clientName, r.division, r.category].filter(Boolean).join(' · ') || '—'}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto pt-4">
        <button
          onClick={start}
          disabled={!name.trim()}
          className="no-drag w-full py-2.5 bg-ink text-paper rounded-md text-[13px] font-medium tracking-tight disabled:opacity-30 hover:bg-ink/90 transition-colors"
        >
          Start timer
          <span className="ml-2 font-mono text-[11px] opacity-60">⌘↵</span>
        </button>
      </div>
    </div>
  );
}
