import { useState } from 'react';
import { swan } from '../lib/swan';

type Props = { onAuthed: (info: { boardId?: number; userName?: string }) => void };

export function Auth({ onAuthed }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [token, setToken] = useState('');

  async function startOAuth() {
    setBusy(true);
    setError(null);
    try {
      const info = await swan.authStart();
      onAuthed(info);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function useManual() {
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const info = await swan.authSetManualToken(token.trim());
      onAuthed(info);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full px-5 pt-4 pb-5 animate-rise">
      <div className="draggable mb-4">
        <h1 className="text-[20px] font-medium tracking-tight">Swan Time</h1>
        <p className="text-[12px] text-mute mt-1">
          Connect your Monday account to log time to your tracker board.
        </p>
      </div>

      <div className="flex-1 flex flex-col justify-center no-drag">
        <button
          onClick={startOAuth}
          disabled={busy}
          className="w-full py-2.5 bg-ink text-paper rounded-md text-[13px] font-medium hover:bg-ink/90 disabled:opacity-50 transition-colors"
        >
          {busy ? 'Connecting…' : 'Sign in with Monday'}
        </button>

        <button
          onClick={() => setManualOpen(o => !o)}
          className="mt-3 text-[11px] text-mute hover:text-ink underline-offset-2 hover:underline"
        >
          {manualOpen ? 'Hide manual token' : 'Use a personal API token instead'}
        </button>

        {manualOpen && (
          <div className="mt-3 space-y-2">
            <input
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="Monday API token"
              className="w-full px-3 py-2 bg-chip rounded-md text-[12px] "
            />
            <button
              onClick={useManual}
              disabled={busy || !token.trim()}
              className="w-full py-2 border border-line rounded-md text-[12px] hover:bg-black/[0.04] disabled:opacity-40"
            >
              Continue with token
            </button>
          </div>
        )}

        {error && <div className="mt-3 text-[12px] text-accent">{error}</div>}
      </div>

      <p className="text-[10px] text-mute leading-relaxed">
        Your account is locked to the board matching your first name (e.g. "Dean Time Tracker").
      </p>
    </div>
  );
}
