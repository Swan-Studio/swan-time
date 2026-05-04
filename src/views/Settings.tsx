import { useEffect, useState } from 'react';
import { swan } from '../lib/swan';
import { DIVISIONS } from '../lib/constants';

type Props = { onClose: () => void; onSignOut: () => void };

export function Settings({ onClose, onSignOut }: Props) {
  const [aiEnabled, setAiEnabled] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [hasSharedKey, setHasSharedKey] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [primaryDivision, setPrimaryDivision] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    swan.getSettings().then(s => {
      setAiEnabled(s.aiEnabled);
      setApiKey(s.anthropicApiKey || '');
      setShowOverride(Boolean(s.anthropicApiKey));
      setPrimaryDivision(s.primaryDivision);
    });
    swan.aiStatus().then(s => setHasSharedKey(s.hasSharedKey));
  }, []);

  async function save() {
    await swan.setSettings({
      aiEnabled,
      anthropicApiKey: showOverride && apiKey.trim() ? apiKey.trim() : undefined,
      primaryDivision: primaryDivision || undefined
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function signOut() {
    await swan.authSignOut();
    onSignOut();
  }

  return (
    <div className="flex flex-col h-full px-5 pt-4 pb-5 animate-rise">
      <div className="flex items-center justify-between draggable mb-3">
        <h1 className="font-display text-[18px] font-medium tracking-tight">Settings</h1>
        <button
          onClick={onClose}
          className="no-drag text-[11px] uppercase tracking-[0.08em] text-mute hover:text-ink font-medium"
        >
          Back
        </button>
      </div>

      <div className="flex-1 space-y-5 no-drag overflow-y-auto">
        <div>
          <div className="text-[10px] uppercase tracking-[0.1em] text-mute font-medium mb-2">
            Your primary division
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {DIVISIONS.map(d => (
              <button
                key={d}
                onClick={() => setPrimaryDivision(primaryDivision === d ? undefined : d)}
                className={`px-3 py-1.5 rounded-md text-[12px] text-left transition-colors ${
                  primaryDivision === d
                    ? 'bg-ink text-paper'
                    : 'bg-chip text-ink hover:bg-ink/[0.08]'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-mute mt-1.5 leading-relaxed">
            Pre-fills new entries with this division, and biases AI parsing in your favour.
          </div>
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={aiEnabled}
            onChange={e => setAiEnabled(e.target.checked)}
            className="mt-0.5 accent-accent"
          />
          <div>
            <div className="text-[13px] text-ink">Enable AI features</div>
            <div className="text-[11px] text-mute leading-relaxed">
              Off by default. Categorisation suggestions and daily summaries.
            </div>
          </div>
        </label>

        {aiEnabled && (
          <div className="space-y-3">
            <div className="px-3 py-2 bg-swan-gradient-soft border border-line rounded-md">
              <div className="text-[11px] text-ink">
                {hasSharedKey ? (
                  <>
                    Using <span className="font-medium">Swan's shared Anthropic account</span>
                    <span className="text-mute"> — no setup needed.</span>
                  </>
                ) : (
                  <>
                    <span className="font-medium">Shared key not configured</span>
                    <span className="text-mute"> — paste your own API key below.</span>
                  </>
                )}
              </div>
            </div>

            {!showOverride ? (
              <button
                onClick={() => setShowOverride(true)}
                className="text-[11px] text-mute hover:text-ink underline-offset-2 hover:underline"
              >
                Use my own Anthropic key instead
              </button>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-[0.1em] text-mute font-medium">
                    Personal Anthropic key
                  </div>
                  <button
                    onClick={() => {
                      setShowOverride(false);
                      setApiKey('');
                    }}
                    className="text-[10px] text-mute hover:text-ink"
                  >
                    Clear
                  </button>
                </div>
                <input
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="sk-ant-…"
                  className="w-full px-3 py-2 bg-chip rounded-md text-[12px] font-mono"
                />
              </div>
            )}
          </div>
        )}

        <div className="pt-3 border-t border-line">
          <button
            onClick={signOut}
            className="text-[12px] text-mute hover:text-accent"
          >
            Sign out of Monday
          </button>
        </div>
      </div>

      <div className="mt-auto pt-4 no-drag">
        <button
          onClick={save}
          className="w-full py-2.5 bg-ink text-paper rounded-md text-[13px] font-medium hover:bg-ink/90 transition-colors"
        >
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  );
}
