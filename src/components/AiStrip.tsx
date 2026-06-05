import { useEffect, useRef, useState } from 'react';

type Candidate = { id: number; name: string; clientName?: string };

type Props = {
  clientName?: string;
  creativeName?: string;
  division?: string;
  category?: string;
  candidates?: Candidate[];
  confidence: number;
  onAccept: () => void;
  onPickCandidate: (c: Candidate) => void;
  onSearchAll: () => void;
  onDismiss: () => void;
};

export function AiStrip({
  clientName,
  creativeName,
  division,
  category,
  candidates,
  confidence,
  onAccept,
  onPickCandidate,
  onSearchAll,
  onDismiss
}: Props) {
  const ambiguous = !creativeName && (candidates?.length ?? 0) >= 2;
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Same dismiss pattern as Picker: outside mousedown or Escape closes.
  useEffect(() => {
    if (!menuOpen) return;
    const onMouse = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // don't let App's Escape-to-hide fire underneath
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [menuOpen]);

  if (confidence <= 0.5 || (!clientName && !creativeName && !division && !category && !ambiguous)) {
    return null;
  }

  const parts = [
    !ambiguous && clientName && <span key="client">{clientName}</span>,
    !ambiguous && creativeName && <span key="creative">{creativeName}</span>,
    ambiguous && (
      <span key="count" className="font-medium">{candidates!.length} creatives match</span>
    ),
    division && <span key="division" className="text-mute">{division}</span>,
    category && <span key="category">{category}</span>
  ].filter(Boolean);

  return (
    <div ref={rootRef} className="no-drag relative mt-2">
      <div className="px-3 py-2 bg-swan-gradient-soft border border-accent/20 rounded-md flex items-center gap-2 animate-rise">
        <span className="text-[10px] uppercase tracking-[0.1em] text-accent font-semibold">AI</span>
        <span className="text-[12px] text-ink truncate flex-1">
          {parts.map((p, i) => (
            <span key={i}>
              {i > 0 && <span className="text-mute mx-1">·</span>}
              {p}
            </span>
          ))}
        </span>
        {ambiguous ? (
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="text-[11px] font-medium text-accent hover:underline whitespace-nowrap"
          >
            Choose ▾
          </button>
        ) : (
          <button onClick={onAccept} className="text-[11px] font-medium text-accent hover:underline">
            Accept
          </button>
        )}
        <button onClick={onDismiss} className="text-[11px] text-mute hover:text-ink">
          ×
        </button>
      </div>
      {ambiguous && menuOpen && (
        <div className="absolute right-0 top-full mt-1 w-[280px] z-50 bg-paper/95 backdrop-blur-md border border-line rounded-md shadow-lg overflow-hidden animate-rise">
          {candidates!.map(c => (
            <button
              key={c.id}
              onClick={() => {
                setMenuOpen(false);
                onPickCandidate(c);
              }}
              className="w-full text-left px-3 py-2 text-[12px] hover:bg-black/[0.05] flex items-baseline gap-2"
            >
              <span className="text-ink truncate flex-1">{c.name}</span>
              {c.clientName && <span className="text-mute text-[11px] shrink-0">{c.clientName}</span>}
            </button>
          ))}
          <button
            onClick={() => {
              setMenuOpen(false);
              onSearchAll();
            }}
            className="w-full text-left px-3 py-2 text-[12px] text-accent hover:bg-black/[0.05] border-t border-line"
          >
            Search all creatives…
          </button>
        </div>
      )}
    </div>
  );
}
