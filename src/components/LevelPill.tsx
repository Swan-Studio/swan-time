type Props = { level: number; title?: string };

export function LevelPill({ level, title }: Props) {
  if (level <= 0) return null;
  return (
    <span
      className="shrink-0 px-1 py-px rounded-sm bg-accent/[0.1] text-accent text-[9px] font-semibold tabular tracking-wider"
      title={title}
    >
      Lv{level}
    </span>
  );
}
