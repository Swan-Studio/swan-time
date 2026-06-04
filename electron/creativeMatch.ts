// Pure helpers for AI creative suggestion — no Electron imports, unit-tested
// under plain Node (tests/creativeMatch.test.ts). The creatives index is ~6k
// items; we shortlist candidates locally so the model only ever sees ~15 names.

export type CreativeRef = { id: number; name: string; clientId?: number };

// Tokens like "the"/"and" produce junk matches against natural-language
// creative titles, so they never count toward a score.
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'was', 'this', 'that']);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // strip diacritics: Café → cafe
      .split(/[^a-z0-9]+/)
      .filter(t => t.length >= 3 && !STOPWORDS.has(t))
  );
}

export function shortlistCreatives(
  text: string,
  creatives: CreativeRef[],
  opts: { clientId?: number; cap?: number } = {}
): CreativeRef[] {
  const cap = opts.cap ?? 15;
  const textTokens = tokens(text);
  return creatives
    .map(c => {
      let score = 0;
      for (const t of tokens(c.name)) if (textTokens.has(t)) score++;
      // Client boost: every creative of the known client makes the list, so
      // the model can pick one even when the activity text shares no tokens.
      if (opts.clientId !== undefined && c.clientId === opts.clientId) score += 2;
      return { c, score };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name))
    .slice(0, cap)
    .map(s => s.c);
}

export function resolveCreativeByName(
  name: string | null | undefined,
  creatives: CreativeRef[]
): { creativeId: number; creativeName: string } | undefined {
  if (typeof name !== 'string' || !name.trim()) return undefined;
  const needle = name.trim().toLowerCase();
  // Duplicate names across clients: first match wins — acceptable for a
  // best-effort suggestion the user can always change.
  const m = creatives.find(c => c.name.toLowerCase() === needle);
  return m ? { creativeId: m.id, creativeName: m.name } : undefined;
}
