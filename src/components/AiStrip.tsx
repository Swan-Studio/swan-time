type Props = {
  division?: string;
  category?: string;
  confidence: number;
  onAccept: () => void;
  onDismiss: () => void;
};

export function AiStrip({ division, category, confidence, onAccept, onDismiss }: Props) {
  if (confidence <= 0.5 || (!division && !category)) return null;
  return (
    <div className="no-drag mt-2 px-3 py-2 bg-swan-gradient-soft border border-accent/20 rounded-md flex items-center gap-2 animate-rise">
      <span className="text-[10px] uppercase tracking-[0.1em] text-accent font-semibold">AI</span>
      <span className="text-[12px] text-ink truncate flex-1">
        {division && <span className="text-mute">{division}</span>}
        {division && category && <span className="text-mute mx-1">·</span>}
        {category && <span>{category}</span>}
      </span>
      <button
        onClick={onAccept}
        className="text-[11px] font-medium text-accent hover:underline"
      >
        Accept
      </button>
      <button onClick={onDismiss} className="text-[11px] text-mute hover:text-ink">
        ×
      </button>
    </div>
  );
}
