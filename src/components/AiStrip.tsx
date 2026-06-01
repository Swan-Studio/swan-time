type Props = {
  clientName?: string;
  division?: string;
  category?: string;
  confidence: number;
  onAccept: () => void;
  onDismiss: () => void;
};

export function AiStrip({ clientName, division, category, confidence, onAccept, onDismiss }: Props) {
  if (confidence <= 0.5 || (!clientName && !division && !category)) return null;
  const parts = [
    clientName && <span key="client">{clientName}</span>,
    division && <span key="division" className="text-mute">{division}</span>,
    category && <span key="category">{category}</span>
  ].filter(Boolean);
  return (
    <div className="no-drag mt-2 px-3 py-2 bg-swan-gradient-soft border border-accent/20 rounded-md flex items-center gap-2 animate-rise">
      <span className="text-[10px] uppercase tracking-[0.1em] text-accent font-semibold">AI</span>
      <span className="text-[12px] text-ink truncate flex-1">
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 && <span className="text-mute mx-1">·</span>}
            {p}
          </span>
        ))}
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
