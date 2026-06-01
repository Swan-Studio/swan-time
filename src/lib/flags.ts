export type EntryFlag = {
  level: 'warn' | 'info';
  message: string;
};

type Entry = {
  id: number;
  name: string;
  clientName?: string;
  division?: string;
  category?: string;
  minutes: number;
  date?: string;
};

const CLIENT_FACING_CATEGORIES = new Set([
  'Client Meeting',
  'Editing',
  'Revising Edit',
  'Scripting',
  'Scheduling and Captioning',
  'Shooting',
  'Ad Copy',
  'Campaign Upload',
  'Monthly Reporting',
  'Client Comms',
  'Reviewing'
]);

// Pure rule-based flagging. Each flag is explainable — the user can see
// exactly why the row was tagged. AI-based flagging is intentionally NOT
// here: rules are predictable, fast, and don't burn API tokens.
export function flagEntry(e: Entry, peers: Entry[] = []): EntryFlag[] {
  const flags: EntryFlag[] = [];

  if (e.minutes > 0 && e.minutes < 5) {
    flags.push({ level: 'warn', message: `Very short (${e.minutes}m) — was this intentional?` });
  }
  if (e.minutes > 12 * 60) {
    flags.push({
      level: 'warn',
      message: `${(e.minutes / 60).toFixed(1)}h — timer was likely left running. Edit on Monday or split into blocks.`
    });
  } else if (e.minutes > 8 * 60) {
    flags.push({
      level: 'warn',
      message: `Long entry (${(e.minutes / 60).toFixed(1)}h) — split into smaller blocks?`
    });
  }

  // Missing data — entry exists on Monday but the structured columns are blank.
  if (!e.division) {
    flags.push({ level: 'warn', message: 'No division set — pick one on Monday.' });
  }
  if (!e.category) {
    flags.push({ level: 'warn', message: 'No category set — pick one on Monday.' });
  }

  if (e.date) {
    const d = new Date(`${e.date}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d.getTime() > today.getTime()) {
      flags.push({ level: 'warn', message: 'Future date — likely a typo.' });
    }
  }

  if (e.category && CLIENT_FACING_CATEGORIES.has(e.category) && !e.clientName) {
    flags.push({
      level: 'warn',
      message: `${e.category} usually has a client — pick one or change category to "Internal Meeting" / "Other".`
    });
  }

  // Possible duplicate: same activity + same client on the same date.
  const dupes = peers.filter(
    p =>
      p.id !== e.id &&
      p.date === e.date &&
      p.name.trim().toLowerCase() === e.name.trim().toLowerCase() &&
      (p.clientName || '') === (e.clientName || '')
  );
  if (dupes.length > 0) {
    flags.push({
      level: 'info',
      message: `Possible duplicate — same name + client logged ${dupes.length}x today.`
    });
  }

  return flags;
}
