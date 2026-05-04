import { useEffect, useRef, useState } from 'react';

type Option = { id: string | number; label: string };

type Props = {
  label: string;
  value?: string;
  options: Option[];
  onChange: (id: string | number, label: string) => void;
  placeholder?: string;
};

export function Picker({ label, value, options, onChange, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div className="relative no-drag" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-chip rounded-md text-left hover:bg-black/[0.06] transition-colors"
      >
        <span className="text-[11px] uppercase tracking-[0.08em] text-mute font-medium">
          {label}
        </span>
        <span className="text-[13px] text-ink truncate ml-3">
          {value || <span className="text-mute font-normal">{placeholder || 'Select'}</span>}
        </span>
      </button>
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-paper/95 backdrop-blur-md border border-line rounded-md shadow-lg overflow-hidden animate-rise">
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}...`}
            className="w-full px-3 py-2 text-[13px] bg-transparent border-b border-line"
          />
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-[12px] text-mute">No matches</div>
            )}
            {filtered.map(o => (
              <button
                key={o.id}
                onClick={() => {
                  onChange(o.id, o.label);
                  setOpen(false);
                  setQuery('');
                }}
                className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-black/[0.05] ${
                  value === o.label ? 'text-accent font-medium' : 'text-ink'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
