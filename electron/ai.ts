import Anthropic from '@anthropic-ai/sdk';
import { CATEGORIES, DIVISIONS } from './monday';
import { store } from './store';
import { SWAN_SHARED_ANTHROPIC_KEY } from './sharedKey';

// Resolve the Anthropic key with three fallbacks, in order:
//   1. Per-user override (Settings → "Use my own key")
//   2. SWAN_ANTHROPIC_KEY env var (dev)
//   3. Baked-in SWAN_SHARED_ANTHROPIC_KEY constant (packaged build)
// Returns null if AI is disabled or no key resolves.
function resolveKey(): string | undefined {
  const userKey = store.get('settings').anthropicApiKey;
  if (userKey) return userKey;
  if (process.env.SWAN_ANTHROPIC_KEY) return process.env.SWAN_ANTHROPIC_KEY;
  return SWAN_SHARED_ANTHROPIC_KEY;
}

export function aiStatus() {
  const settings = store.get('settings');
  const sharedAvailable = Boolean(process.env.SWAN_ANTHROPIC_KEY || SWAN_SHARED_ANTHROPIC_KEY);
  return {
    aiEnabled: settings.aiEnabled,
    hasUserKey: Boolean(settings.anthropicApiKey),
    hasSharedKey: sharedAvailable
  };
}

function client(): Anthropic | null {
  const settings = store.get('settings');
  if (!settings.aiEnabled) return null;
  const apiKey = resolveKey();
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

export type CategorySuggestion = {
  clientName?: string;
  division?: string;
  category?: string;
  confidence: number;
};

export async function suggestCategory(
  activityName: string,
  context: { recents: Array<{ name: string; clientName?: string }>; clients: string[] }
): Promise<CategorySuggestion> {
  const c = client();
  if (!c || !activityName.trim()) return { confidence: 0 };

  const clientsHint = context.clients.length
    ? `\nAllowed clients (match exactly one, case-insensitive on input but return exact case, or null): ${context.clients.join(', ')}.`
    : '';

  // Confidence rubric matters: the UI hides suggestions at confidence <= 0.5,
  // and without an explicit rubric the model marks down otherwise-solid
  // division/category guesses just because the client is unknown — so the
  // strip never appeared (debugged live 2026-06-04: "working on the foodie
  // creative" → Production/Editing at 0.45, silently discarded).
  const sys = `You classify time-tracking activity names for a creative agency.
Return strict JSON only, no prose: {"clientName": string|null, "division": string|null, "category": string|null, "confidence": 0..1}.
Allowed divisions: ${DIVISIONS.join(', ')}.
Allowed categories: ${CATEGORIES.join(', ')}.${clientsHint}
Infer the client from the activity name or from similar recent activities. The client is OPTIONAL — returning null for clientName is normal and must NOT lower confidence.
confidence scores ONLY how likely your division and category are correct: 0.8+ when the activity clearly implies them, 0.5-0.7 when plausible, below 0.5 only when the name is too vague to classify at all.`;

  const recentLines = context.recents
    .slice(0, 5)
    .map(r => `- ${r.name}${r.clientName ? ` (client: ${r.clientName})` : ''}`)
    .join('\n');

  const usr = `Activity: "${activityName}"
Recent activities by this user (for context):
${recentLines || '(none)'}`;

  try {
    const res = await c.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: sys,
      messages: [{ role: 'user', content: usr }]
    });
    const text = res.content
      .map(b => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { confidence: 0 };
    const parsed = JSON.parse(m[0]);
    const clientMatch = typeof parsed.clientName === 'string'
      ? context.clients.find(c => c.toLowerCase() === parsed.clientName.toLowerCase())
      : undefined;
    return {
      clientName: clientMatch,
      division: DIVISIONS.includes(parsed.division) ? parsed.division : undefined,
      category: CATEGORIES.includes(parsed.category) ? parsed.category : undefined,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0))
    };
  } catch (e) {
    console.error('AI suggest failed', e);
    return { confidence: 0 };
  }
}

export type ParsedBatchRow = {
  date: string; // ISO YYYY-MM-DD
  name: string;
  durationMinutes: number;
  clientName?: string;
  division?: string;
  category?: string;
  confidence: number;
};

export async function parseBatch(
  text: string,
  context: { clients: string[]; today: string; primaryDivision?: string }
): Promise<ParsedBatchRow[]> {
  const c = client();
  if (!c) throw new Error('AI is off or no API key configured.');
  if (!text.trim()) return [];

  const todayDate = new Date(`${context.today}T12:00:00`);
  const todayWeekday = todayDate.toLocaleDateString('en-US', { weekday: 'long' });

  const primaryHint = context.primaryDivision
    ? `\n\nThis user's primary division is "${context.primaryDivision}". Default to this division unless the activity strongly indicates a different one (e.g. don't override if they say "shooting" → Production, but do default if context is ambiguous).`
    : '';

  const sys = `You parse free-text time logs into structured entries for Swan Studio, a creative agency.${primaryHint}

Return STRICT JSON: an array of objects with these fields:
- date: "YYYY-MM-DD" (resolve relative dates against today=${context.today} which is a ${todayWeekday}; "yesterday"=today-1, weekday names = most recent past matching weekday — e.g. if today is ${todayWeekday}, "Mon" = the most recent past Monday)
- name: short activity description (no client name, no duration, no division/category)
- durationMinutes: integer minutes (parse "2h"=120, "30m"=30, "9-11am"=120, "9:00-11:30"=150; min 1, round up)
- clientName: must match exactly one of the allowed clients OR be omitted
- category: one of [${CATEGORIES.join(', ')}] OR omitted
- division: one of [${DIVISIONS.join(', ')}] OR omitted — pick using the category→division mapping below
- confidence: 0..1, lower if you guessed division/category from weak signal

Allowed clients (match exactly, case-insensitive on input but return exact case): ${context.clients.join(', ')}

Category → Division mapping (use this to pick division from category):
- Content Delivery: Scripting, Editing, Revising Edit, Ideating Concepts, Research Deck Preparation, Editor & Creator Briefing, Reviewing, Creator Recruitment
- Production: Shooting (only actual on-set/filming work)
- Social Media Management: Scheduling and Captioning, Monthly Reporting
- Ads Management: Ad Copy, Campaign Upload, Data Analysis, Audit
- (cross-division — leave division blank or infer from client context): Client Meeting, Internal Meeting, Research, Health Check, Client Comms, Other

Important nuances:
- "Scripting ideas for a shoot" = category Scripting / division Content Delivery (NOT Production — Production is only for the actual shoot day)
- "Founder shoot brief" or "shooting day" = Shooting / Production
- "Editing" always = Content Delivery, regardless of footage source
- If text mentions only an editor/creator name, the activity is usually Content Delivery

Return ONLY the JSON array, no commentary, no code fences. If text has no parseable entries, return [].`;

  const res = await c.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    system: sys,
    messages: [{ role: 'user', content: text }]
  });

  const raw = res.content
    .map(b => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();

  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((row: any): ParsedBatchRow | null => {
      if (!row || typeof row !== 'object') return null;
      const date = typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
        ? row.date
        : context.today;
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      const durationMinutes = Math.max(1, Math.ceil(Number(row.durationMinutes) || 0));
      if (!name || !durationMinutes) return null;
      const aiDivision = DIVISIONS.includes(row.division) ? row.division : undefined;
      // Fall back to user's primary division if AI didn't pick one.
      const division =
        aiDivision ||
        (context.primaryDivision && (DIVISIONS as readonly string[]).includes(context.primaryDivision)
          ? context.primaryDivision
          : undefined);
      const category = CATEGORIES.includes(row.category) ? row.category : undefined;
      const clientMatch = typeof row.clientName === 'string'
        ? context.clients.find(c => c.toLowerCase() === row.clientName.toLowerCase())
        : undefined;
      return {
        date,
        name,
        durationMinutes,
        clientName: clientMatch,
        division,
        category,
        confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0))
      };
    })
    .filter((r): r is ParsedBatchRow => r !== null);
}

type DaySummaryInput = Array<{
  name: string;
  clientName?: string;
  division?: string;
  category?: string;
  minutes: number;
}>;

export async function dailySummary(entries: DaySummaryInput): Promise<string> {
  const c = client();
  if (!c) return 'AI is off. Enable it in Settings to generate a summary.';
  if (!entries.length) return 'No entries logged today yet.';

  const total = entries.reduce((a, e) => a + e.minutes, 0);
  const lines = entries.map(
    e => `- ${e.minutes}m | ${e.name}${e.clientName ? ' · ' + e.clientName : ''}${e.category ? ' · ' + e.category : ''}`
  );

  const res = await c.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system:
      'You write short, calm daily work summaries for a creative agency operator. ' +
      'No bullet points, no headings, no emojis. 2-3 short paragraphs, plain prose.',
    messages: [
      {
        role: 'user',
        content: `Total tracked: ${Math.round(total / 60 * 10) / 10}h across ${entries.length} entries.\n\n${lines.join('\n')}`
      }
    ]
  });
  return res.content
    .map(b => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
}
