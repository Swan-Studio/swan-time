import { useEffect, useState } from 'react';
import { swan } from './lib/swan';
import { Auth } from './views/Auth';
import { Tracker } from './views/Tracker';
import { Running } from './views/Running';
import { StopGate } from './views/StopGate';
import { Today } from './views/Today';
import { Settings } from './views/Settings';
import { Batch } from './views/Batch';
import { PickBoard } from './views/PickBoard';
import { Levels } from './views/Levels';
import { Nudge } from './views/Nudge';
import type { Running as RunningT } from './lib/constants';

type Screen =
  | 'loading'
  | 'auth'
  | 'pickBoard'
  | 'tracker'
  | 'running'
  | 'stopgate'
  | 'today'
  | 'settings'
  | 'batch'
  | 'levels'
  | 'nudge';

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [timer, setTimer] = useState<RunningT>(null);
  const [userName, setUserName] = useState<string | undefined>();
  const [boardWarning, setBoardWarning] = useState<string | null>(null);
  const [lastLog, setLastLog] = useState<{ minutes: number } | null>(null);

  async function refresh() {
    const auth = await swan.authStatus();
    if (!auth.authed) {
      setScreen('auth');
      return;
    }
    const settings = await swan.getSettings();
    const displayName = settings.displayNameOverride?.trim() || auth.userName;
    setUserName(displayName);
    if (!auth.boardId) {
      // Auto-resolution failed (regex mismatch). Send user to the picker.
      setBoardWarning(null);
      setScreen('pickBoard');
      return;
    }
    setBoardWarning(null);
    const t = await swan.getRunning();
    setTimer(t);
    setScreen(t ? 'running' : 'tracker');
  }

  useEffect(() => {
    refresh();
    const off = swan.onShow(async () => {
      const t = await swan.getRunning();
      setTimer(t);
      if (t && screen !== 'stopgate' && screen !== 'batch') setScreen('running');
    });
    const offMode = swan.onWidgetMode(async mode => {
      if (mode === 'batch') {
        setScreen('batch');
      } else if (mode === 'nudge') {
        const t = await swan.getRunning();
        setTimer(t);
        setScreen('nudge');
      } else {
        const t = await swan.getRunning();
        setTimer(t);
        setScreen(t ? 'running' : 'tracker');
      }
    });
    return () => {
      off();
      offMode();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') swan.hide();
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setScreen('settings');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative w-full h-screen bg-paper/80 backdrop-blur-xl rounded-xl overflow-hidden border border-line shadow-[0_10px_40px_rgba(8,8,34,0.18)]">
      {/* Swan signature: 3px gradient bar */}
      <div className="absolute top-0 inset-x-0 h-[3px] bg-swan-gradient z-10" />
      {boardWarning && screen !== 'auth' && screen !== 'loading' && (
        <div className="absolute top-0 inset-x-0 px-4 py-1.5 bg-accent/10 text-accent text-[10px] z-50 text-center">
          {boardWarning}
        </div>
      )}
      {screen === 'loading' && (
        <div className="flex items-center justify-center h-full">
          <span className="text-[14px] text-mute tracking-tight animate-pulse">Swan Time</span>
        </div>
      )}
      {screen === 'auth' && (
        <Auth
          onAuthed={async () => {
            await refresh();
          }}
        />
      )}
      {screen === 'pickBoard' && (
        <PickBoard
          userName={userName}
          onPicked={refresh}
          onSignOut={async () => {
            await swan.authSignOut();
            setScreen('auth');
          }}
        />
      )}
      {screen === 'tracker' && (
        <Tracker
          userName={userName}
          lastLog={lastLog}
          onClearLastLog={() => setLastLog(null)}
          onStarted={async () => {
            setTimer(await swan.getRunning());
            setLastLog(null);
            setScreen('running');
          }}
          onOpenSettings={() => setScreen('settings')}
          onOpenToday={() => setScreen('today')}
          onOpenLevels={() => setScreen('levels')}
        />
      )}
      {screen === 'running' && timer && (
        <Running
          timer={timer}
          onStopped={(result) => {
            setTimer(null);
            if (result?.minutes) setLastLog({ minutes: result.minutes });
            setScreen('tracker');
          }}
          onNeedsCategory={() => setScreen('stopgate')}
        />
      )}
      {screen === 'stopgate' && timer && (
        <StopGate
          timer={timer}
          onLogged={(result) => {
            setTimer(null);
            if (result?.minutes) setLastLog({ minutes: result.minutes });
            setScreen('tracker');
          }}
          onCancel={() => setScreen('running')}
        />
      )}
      {screen === 'today' && <Today onClose={() => setScreen(timer ? 'running' : 'tracker')} />}
      {screen === 'levels' && <Levels onClose={() => setScreen(timer ? 'running' : 'tracker')} />}
      {screen === 'settings' && (
        <Settings
          onClose={async () => {
            await refresh();
            setScreen(timer ? 'running' : 'tracker');
          }}
          onSignOut={() => setScreen('auth')}
        />
      )}
      {screen === 'batch' && (
        <Batch
          onClose={() => {
            swan.batchClose();
            setScreen(timer ? 'running' : 'tracker');
          }}
        />
      )}
      {screen === 'nudge' && (
        <Nudge
          timer={timer}
          onExpand={() => swan.nudgeExpand()}
        />
      )}
    </div>
  );
}
