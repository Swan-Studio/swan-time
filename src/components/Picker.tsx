import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';

type Option = { id: string | number; label: string };

type Props = {
  label: string;
  value?: string;
  options: Option[];
  onChange: (id: string | number, label: string) => void;
  placeholder?: string;
  highlightId?: string | number;
  optionMeta?: (id: string | number, label: string) => ReactNode;
  /** Increment to open the dropdown programmatically (e.g. AI strip's "Search all…"). */
  openSignal?: number;
};

type Coords = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  listMax: number;
};

export function Picker({ label, value, options, onChange, placeholder, highlightId, optionMeta, openSignal }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState<Coords | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);

  // Position the dropdown using fixed coordinates so it escapes any overflow
  // ancestors and respects the window viewport (including the title bar).
  useLayoutEffect(() => {
    if (!open || !ref.current) {
      setCoords(null);
      return;
    }
    const SEARCH_INPUT_H = 36;
    const TOP_SAFE = 56; // leave room for the window's draggable title bar
    const BOTTOM_SAFE = 16;
    const GAP = 4;
    const rect = ref.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - BOTTOM_SAFE - GAP;
    const above = rect.top - TOP_SAFE - GAP;
    const goUp = below < 180 && above > below;
    const space = goUp ? above : below;
    const listMax = Math.max(80, Math.min(280, space - SEARCH_INPUT_H));
    if (goUp) {
      setCoords({
        bottom: window.innerHeight - rect.top + GAP,
        left: rect.left,
        width: rect.width,
        listMax
      });
    } else {
      setCoords({
        top: rect.bottom + GAP,
        left: rect.left,
        width: rect.width,
        listMax
      });
    }
  }, [open]);

  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  const selectedIsPrimary =
    highlightId !== undefined && options.some(o => o.label === value && o.id === highlightId);

  return (
    <div className="relative no-drag" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative w-full flex items-center justify-between py-2 pl-3 pr-3 bg-chip rounded-md text-left hover:bg-black/[0.06] transition-colors"
      >
        {selectedIsPrimary && (
          <span
            className="absolute left-1 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent"
            aria-hidden="true"
          />
        )}
        <span className="text-[11px] uppercase tracking-[0.08em] text-mute font-medium">
          {label}
        </span>
        <span className="text-[13px] text-ink truncate ml-3">
          {value || <span className="text-mute font-normal">{placeholder || 'Select'}</span>}
        </span>
      </button>
      {open && coords && (
        <div
          ref={panelRef}
          className="fixed z-50 bg-paper/95 backdrop-blur-md border border-line rounded-md shadow-lg overflow-hidden animate-rise"
          style={{
            top: coords.top,
            bottom: coords.bottom,
            left: coords.left,
            width: coords.width
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}...`}
            className="w-full px-3 py-2 text-[13px] bg-transparent border-b border-line"
          />
          <div className="overflow-y-auto py-1" style={{ maxHeight: coords.listMax }}>
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-[12px] text-mute">No matches</div>
            )}
            {filtered.map(o => {
              const isPrimary = highlightId !== undefined && o.id === highlightId;
              const meta = optionMeta?.(o.id, o.label);
              return (
                <button
                  key={o.id}
                  onClick={() => {
                    onChange(o.id, o.label);
                    setOpen(false);
                    setQuery('');
                  }}
                  className={`relative w-full text-left py-1.5 pl-3 pr-3 text-[13px] hover:bg-black/[0.05] flex items-center ${
                    value === o.label ? 'text-accent font-medium' : 'text-ink'
                  }`}
                  title={isPrimary ? 'Your primary division' : undefined}
                >
                  {isPrimary && (
                    <span
                      className="absolute left-1 top-1.5 bottom-1.5 w-[2px] rounded-full bg-accent"
                      aria-hidden="true"
                    />
                  )}
                  <span className="flex-1 truncate">{o.label}</span>
                  {meta && <span className="ml-2 shrink-0">{meta}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
