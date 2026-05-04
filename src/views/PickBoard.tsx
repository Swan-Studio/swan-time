import { useEffect, useState } from 'react';
import { swan } from '../lib/swan';

type Board = { id: number; name: string };

type Props = {
  userName?: string;
  onPicked: () => void;
};

export function PickBoard({ userName, onPicked }: Props) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    swan
      .listTimeTrackerBoards()
      .then(setBoards)
      .finally(() => setLoading(false));
  }, []);

  const filtered = query
    ? boards.filter(b => b.name.toLowerCase().includes(query.toLowerCase()))
    : boards;

  async function pick(b: Board) {
    setBusy(true);
    await swan.setBoard(b.id, b.name);
    onPicked();
  }

  return (
    <div className="flex flex-col h-full px-5 pt-4 pb-5 animate-rise">
      <div className="draggable mb-3">
        <h1 className="font-display text-[18px] font-medium tracking-tight">Pick your board</h1>
        <p className="text-[11px] text-mute leading-relaxed mt-1">
          We couldn't auto-find a tracker board for{' '}
          <span className="text-ink">{userName?.split(/\s+/)[0] || 'you'}</span>. Pick yours from
          the list — we'll remember it.
        </p>
      </div>

      <input
        autoFocus
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search boards…"
        className="no-drag w-full px-3 py-2 bg-chip rounded-md text-[13px] mb-2"
      />

      <div className="flex-1 overflow-y-auto no-drag">
        {loading && <div className="px-2 py-4 text-[12px] text-mute">Loading…</div>}
        {!loading && filtered.length === 0 && (
          <div className="px-2 py-6 text-center text-[12px] text-mute">
            No tracker boards match. Ask an admin to create one.
          </div>
        )}
        {!loading &&
          filtered.map(b => (
            <button
              key={b.id}
              onClick={() => pick(b)}
              disabled={busy}
              className="w-full text-left px-3 py-2 rounded hover:bg-ink/[0.04] text-[13px] disabled:opacity-50"
            >
              {b.name}
            </button>
          ))}
      </div>
    </div>
  );
}
