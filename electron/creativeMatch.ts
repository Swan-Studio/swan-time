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

// "foodies" → "foodie". Trailing-s only (not -ss): cheap plural handling
// without a real stemmer; typos are covered by withinOneEdit below.
function stem(t: string): string {
  return t.length >= 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t;
}

// True when insert/delete/substitute distance is <= 1. Single pass — no DP
// table needed for a bound of one edit.
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (l.length - s.length > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (s.length === l.length) {
      i++;
      j++;
    } else {
      j++; // skip the extra char in the longer string
    }
  }
  return edits + (l.length - j) <= 1;
}

// Short tokens stay exact — "cat"/"car" must not collide; one edit only
// becomes meaningful signal at >= 5 chars.
function fuzzyTokenMatch(a: string, b: string): boolean {
  if (stem(a) === stem(b)) return true;
  return a.length >= 5 && b.length >= 5 && withinOneEdit(a, b);
}

export function shortlistCreatives(
  text: string,
  creatives: CreativeRef[],
  opts: { clientId?: number; cap?: number } = {}
): CreativeRef[] {
  const cap = opts.cap ?? 15;
  const textTokens = tokens(text);
  const textTokenList = [...textTokens];
  // Rarity weighting: in a video agency ~15 creative names contain the
  // literal token "video", so a generic-token match carries almost no signal
  // — counting matches equally let them flood the cap and crowd out the one
  // creative that matched the rare concept word (bit us live 2026-06-05).
  const creativeTokens = creatives.map(c => [...tokens(c.name)]);
  const df = new Map<string, number>();
  for (const ts of creativeTokens) for (const t of ts) df.set(t, (df.get(t) || 0) + 1);
  const n = Math.max(1, creatives.length);
  // Smoothed (1 + n/df) so even an every-creative token keeps a positive
  // weight — a plain n/df hits ln(1)=0 and zeroes out small candidate lists.
  const idf = (t: string) => Math.log(1 + n / (df.get(t) || 1));
  return creatives
    .map((c, i) => {
      let score = 0;
      for (const t of creativeTokens[i]) {
        if (textTokens.has(t)) score += idf(t) + 0.5; // small exact-match bonus over fuzzy
        else if (textTokenList.some(x => fuzzyTokenMatch(x, t))) score += idf(t);
      }
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

// Comparison key for creative/client names: board names use curly quotes
// ("Foodie’s life hack") but the model echoes straight ones — a raw
// toLowerCase compare silently dropped the match (bit us live 2026-06-05).
export function nameKey(s: string): string {
  return s.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
}

// Validate a model-returned candidate list: exact-case names from `allowed`
// only, deduped, capped at 3. Hallucinated names and junk entries drop out.
export function validateCandidateNames(raw: unknown, allowed: string[]): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .filter((n): n is string => typeof n === 'string')
        .map(n => allowed.find(c => nameKey(c) === nameKey(n)))
        .filter((n): n is string => Boolean(n))
    )
  ].slice(0, 3);
}

export function resolveCreativeByName(
  name: string | null | undefined,
  creatives: CreativeRef[]
): { creativeId: number; creativeName: string } | undefined {
  if (typeof name !== 'string' || !name.trim()) return undefined;
  const needle = nameKey(name);
  // Duplicate names across clients: first match wins — acceptable for a
  // best-effort suggestion the user can always change.
  const m = creatives.find(c => nameKey(c.name) === needle);
  return m ? { creativeId: m.id, creativeName: m.name } : undefined;
}
