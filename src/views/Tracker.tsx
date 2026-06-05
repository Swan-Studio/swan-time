import { useEffect, useRef, useState } from 'react';
import { swan } from '../lib/swan';
import { Picker } from '../components/Picker';
import { AiStrip } from '../components/AiStrip';
import { CATEGORIES, DIVISIONS, Client, Creative, Recent } from '../lib/constants';
import { clientForCreative, creativeMatchesClient, creativesForClient } from '../lib/creatives';
import { minutesToHm } from '../lib/format';
import { levelFor } from '../lib/levels';
import { LevelPill } from '../components/LevelPill';
import mondayLogo from '../assets/monday-logo.svg';

type Props = {
  onStarted: () => void;
  onOpenToday: () => void;
  onOpenSettings: () => void;
  onOpenLevels: () => void;
  userName?: string;
  lastLog: { minutes: number } | null;
  onClearLastLog: () => void;
};

export function Tracker({ onStarted, onOpenToday, onOpenSettings, onOpenLevels, userName, lastLog, onClearLastLog }: Props) {
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState<number | undefined>();
  const [clientName, setClientName] = useState<string | undefined>();
  const [creativeId, setCreativeId] = useState<number | undefined>();
  const [creativeName, setCreativeName] = useState<string | undefined>();
  const [division, setDivision] = useState<string | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [clients, setClients] = useState<Client[]>([]);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [creativesOn, setCreativesOn] = useState(false);
  const [recents, setRecents] = useState<Recent[]>([]);
  const [aiOn, setAiOn] = useState(false);
  const [primaryDivision, setPrimaryDivision] = useState<string | undefined>();
  const [streaksOn, setStreaksOn] = useState(true);
  const [levelsOn, setLevelsOn] = useState(true);
  const [streak, setStreak] = useState(0);
  const [categoryMinutes, setCategoryMinutes] = useState<Record<string, number>>({});
  const [suggestion, setSuggestion] = useState<{
    clientName?: string;
    creativeId?: number;
    creativeName?: string;
    candidates?: Array<{ id: number; name: string; clientName?: string }>;
    division?: string;
    category?: string;
    confidence: number;
  }>({ confidence: 0 });
  const [dismissed, setDismissed] = useState(false);
  const [creativePickerSignal, setCreativePickerSignal] = useState(0);
  const [lastLogStatus, setLastLogStatus] = useState<{ lastDate: string | null; daysSince: number | null } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<number | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    swan.listClients().then(setClients).catch(() => {});
    swan.creativesEnabled().then((on: boolean) => {
      if (!on) return;
      setCreativesOn(true);
      swan.listCreatives().then(setCreatives).catch(() => {});
    }).catch(() => {});
    swan.getRecents().then(setRecents);
    swan.getSettings().then(s => {
      setAiOn(s.aiEnabled);
      setPrimaryDivision(s.primaryDivision);
      setStreaksOn(s.streaksEnabled !== false);
      setLevelsOn(s.levelsEnabled !== false);
      // Pre-fill division with user's primary if not yet set.
      if (s.primaryDivision && !division) setDivision(s.primaryDivision);
    });
    swan.lastLogStatus().then(setLastLogStatus).catch(() => {});
    swan.getStats().then(s => {
      setStreak(s.streak);
      setCategoryMinutes(s.categoryMinutes);
    }).catch(() => {});
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

  function applySuggestionMeta() {
    if (suggestion.division) setDivision(suggestion.division);
    if (suggestion.category) setCategory(suggestion.category);
    setDismissed(true);
  }

  function applyRecent(r: Recent) {
    setName(r.name);
    setClientId(r.clientId);
    setClientName(r.clientName);
    setCreativeId(r.creativeId);
    setCreativeName(r.creativeName);
    setDivision(r.division);
    setCategory(r.category);
  }

  function pickClient(id: number, label: string) {
    setClientId(id);
    setClientName(label);
    // A creative belonging to a different client can't survive a client switch.
    if (!creativeMatchesClient(creatives, creativeId, id)) {
      setCreativeId(undefined);
      setCreativeName(undefined);
    }
  }

  function pickCreative(id: number, label: string) {
    setCreativeId(id);
    setCreativeName(label);
    // Creatives belong to exactly one client — selecting one fills the client.
    const owner = clientForCreative(creatives.find(c => c.id === id), clients);
    if (owner) {
      setClientId(owner.id);
      setClientName(owner.name);
    }
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
    await swan.startTimer({ name: name.trim(), clientId, clientName, creativeId, creativeName, division, category });
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
      {/* Shared gradient def for header icon hover. */}
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <linearGradient id="swan-grad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#FCED17" />
            <stop offset="50%" stopColor="#FF4E01" />
            <stop offset="100%" stopColor="#EB0091" />
          </linearGradient>
        </defs>
      </svg>
      <div className="flex items-center justify-between mb-3 draggable">
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="text-[18px] font-medium tracking-tight whitespace-nowrap">Swan Time</h1>
          {userName && (
            <span className="text-[11px] text-mute truncate">{userName.split(/\s+/)[0]}</span>
          )}
          {streaksOn && streak > 0 && (
            <span
              className="text-[11px] text-accent tabular font-medium"
              title={`${streak} day streak (weekdays)`}
            >
              🔥 {streak}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 no-drag shrink-0">
          <button
            onClick={() => swan.batchOpen()}
            className="swan-hover-text text-[11px] uppercase tracking-[0.08em] font-medium"
            title="Batch entry"
          >
            Batch
          </button>
          <button
            onClick={onOpenToday}
            className="swan-hover-icon"
            title="Today"
            aria-label="Today"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 7 12 12 15.5 14" />
            </svg>
          </button>
          {levelsOn && (
            <button
              onClick={onOpenLevels}
              className="swan-hover-icon"
              title="Category levels"
              aria-label="Category levels"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 20 H21 M6 20 V13 M12 20 V9 M18 20 V5" />
              </svg>
            </button>
          )}
          <button
            onClick={onOpenSettings}
            className="swan-hover-icon"
            title="Settings (⌘,)"
            aria-label="Settings"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button
            onClick={() => swan.openBoard()}
            title="Open your Monday board"
            aria-label="Open Monday board"
          >
            <img src={mondayLogo} alt="Monday" className="swan-hover-img h-[14px] w-auto" />
          </button>
        </div>
      </div>

      {lastLog && (
        <div className="mb-3 px-3 py-1.5 bg-ink/[0.04] border border-line rounded-md flex items-center justify-between animate-rise">
          <span className="text-[12px] text-ink">
            Logged <span className="tabular">{minutesToHm(lastLog.minutes)}</span>
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
          if (suggestion.creativeId && suggestion.creativeName) {
            // Creative wins: pickCreative also fills its owning client, the
            // same rule as picking manually — overriding the AI's client
            // guess if they conflict.
            pickCreative(suggestion.creativeId, suggestion.creativeName);
          } else if (suggestion.clientName) {
            const match = clients.find(c => c.name.toLowerCase() === suggestion.clientName!.toLowerCase());
            if (match) pickClient(match.id, match.name);
          }
          applySuggestionMeta();
        }}
        onPickCandidate={c => {
          pickCreative(c.id, c.name);
          applySuggestionMeta();
        }}
        onPickNone={() => {
          // Explicitly no creative: still take the AI's client guess + meta.
          if (suggestion.clientName) {
            const match = clients.find(c => c.name.toLowerCase() === suggestion.clientName!.toLowerCase());
            if (match) pickClient(match.id, match.name);
          }
          applySuggestionMeta();
        }}
        onSearchAll={() => {
          // Keep the AI's division/category, then hand off to the full picker.
          applySuggestionMeta();
          setCreativePickerSignal(s => s + 1);
        }}
        onDismiss={() => setDismissed(true)}
      />

      <div className="grid grid-cols-1 gap-2 mt-4">
        <Picker
          label="Client"
          value={clientName}
          placeholder="—"
          options={clients.map(c => ({ id: c.id, label: c.name }))}
          onChange={(id, label) => pickClient(Number(id), label)}
        />
        {creativesOn && (
          <Picker
            label="Creative"
            value={creativeName}
            placeholder="—"
            options={creativesForClient(creatives, clientId).map(c => ({ id: c.id, label: c.name }))}
            onChange={(id, label) => pickCreative(Number(id), label)}
            openSignal={creativePickerSignal}
            clearLabel="No creative"
            onClear={() => {
              setCreativeId(undefined);
              setCreativeName(undefined);
            }}
          />
        )}
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
          optionMeta={
            levelsOn
              ? (_, label) => <LevelPill level={levelFor(categoryMinutes[label] || 0)} />
              : undefined
          }
        />
      </div>

      {!name && recents.length > 0 && (
        <div className="mt-4 flex-1 overflow-y-auto no-drag">
          <div className="text-[10px] uppercase tracking-[0.1em] text-mute font-medium mb-2">
            Recent
          </div>
          <div className="space-y-1">
            {recents.slice(0, 4).map(r => {
              const lvl = levelsOn && r.category ? levelFor(categoryMinutes[r.category] || 0) : 0;
              return (
                <button
                  key={r.name + r.lastUsed}
                  onClick={() => applyRecent(r)}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-black/[0.04] group"
                >
                  <div className="text-[13px] text-ink truncate">{r.name}</div>
                  <div className="text-[11px] text-mute truncate flex items-center gap-1.5">
                    <span className="truncate">
                      {[r.clientName, r.creativeName, r.division, r.category].filter(Boolean).join(' · ') || '—'}
                    </span>
                    <LevelPill level={lvl} title={r.category ? `Lv ${lvl} in ${r.category}` : undefined} />
                  </div>
                </button>
              );
            })}
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
          <span className="ml-2  text-[11px] opacity-60">⌘↵</span>
        </button>
        <div className="mt-1.5 text-center text-[9px] tabular text-mute/70 tracking-wide">
          v{__APP_VERSION__}
        </div>
      </div>
    </div>
  );
}
