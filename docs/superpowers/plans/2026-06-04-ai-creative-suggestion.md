# AI Creative Suggestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The AI suggestion (Tracker strip) and Batch parse also propose the matching Creative, picked by the model from a locally-shortlisted candidate set.

**Architecture:** A pure `electron/creativeMatch.ts` module shortlists ~15 candidates from the ~6k-item creatives index by token overlap (client-boosted) and resolves returned names back to ids. `ai.ts` passes candidate names into the existing single API call for both `suggestCategory` and `parseBatch`; `main.ts` handlers shortlist + resolve; the renderer applies a suggested creative with the existing creative-auto-sets-client rule.

**Tech Stack:** Existing Anthropic SDK call paths, vitest for the pure module. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-04-ai-creative-suggestion-design.md`
**Spec deviation (intentional):** spec §4 says Batch.tsx needs no changes — wrong: `parse()` (Batch.tsx:137-149) doesn't pass creative fields into `newRow`, so Task 4 adds 2 lines there. Also the spec's "fill remaining slots with the client's creatives" is subsumed by the +2 client boost (any client-owned creative scores > 0), so no separate fill loop exists.

**File map:**
| File | Action | Responsibility |
|---|---|---|
| `electron/creativeMatch.ts` | Create | Pure shortlist + name→id resolve (no Electron imports) |
| `tests/creativeMatch.test.ts` | Create | Unit tests for the above |
| `electron/ai.ts` | Modify | Candidate names in both prompts; validated `creativeName` in results |
| `electron/main.ts` | Modify | `ai:suggest` + `batch:parse` shortlist & resolve |
| `src/views/Tracker.tsx` | Modify | Suggestion state type + accept applies creative via `pickCreative` |
| `src/components/AiStrip.tsx` | Modify | Render creative segment |
| `src/views/Batch.tsx` | Modify | Map parsed creative fields into rows (2 lines) |

NOTE: `electron/monday.ts` has an unrelated uncommitted change — NEVER stage or commit that file.

---

### Task 1: Pure creative matching module (TDD)

**Files:**
- Create: `electron/creativeMatch.ts`
- Test: `tests/creativeMatch.test.ts`

- [ ] **Step 1: Write the failing tests** — create `tests/creativeMatch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shortlistCreatives, resolveCreativeByName } from '../electron/creativeMatch';

const CREATIVES = [
  { id: 1, name: 'The Supplement Scam', clientId: 10 },
  { id: 2, name: 'Style Stalker', clientId: 11 },
  { id: 3, name: 'Foodie Finds Ep 3', clientId: 12 },
  { id: 4, name: 'Mini Mic Walkthrough', clientId: 12 },
  { id: 5, name: 'Best Boyfriend', clientId: 13 }
];

describe('shortlistCreatives', () => {
  it('matches creatives sharing meaningful tokens with the text', () => {
    const out = shortlistCreatives('editing the foodie video', CREATIVES);
    expect(out.map(c => c.id)).toEqual([3]);
  });

  it('ignores stopwords — "the" alone must not match', () => {
    const out = shortlistCreatives('reviewing the cut', CREATIVES);
    expect(out).toEqual([]); // 'The Supplement Scam' shares only "the"
  });

  it('includes ALL of a known client\'s creatives via the boost', () => {
    const out = shortlistCreatives('misc admin', CREATIVES, { clientId: 12 });
    expect(out.map(c => c.id).sort()).toEqual([3, 4]);
  });

  it('ranks token+client matches above client-only matches', () => {
    const out = shortlistCreatives('foodie edit', CREATIVES, { clientId: 12 });
    expect(out.map(c => c.id)).toEqual([3, 4]); // 3 scores 1+2, 4 scores 0+2
  });

  it('caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: i, name: `Foodie ${i}`, clientId: 1 }));
    expect(shortlistCreatives('foodie', many, { cap: 5 })).toHaveLength(5);
  });

  it('orders deterministically: score desc, then name asc', () => {
    const out = shortlistCreatives('foodie style', [
      { id: 7, name: 'Zeta Foodie' },
      { id: 8, name: 'Alpha Foodie' }
    ]);
    expect(out.map(c => c.id)).toEqual([8, 7]);
  });

  it('returns [] for empty text with no client', () => {
    expect(shortlistCreatives('', CREATIVES)).toEqual([]);
  });
});

describe('resolveCreativeByName', () => {
  it('resolves case-insensitively with trim', () => {
    expect(resolveCreativeByName('  foodie finds ep 3 ', CREATIVES)).toEqual({
      creativeId: 3,
      creativeName: 'Foodie Finds Ep 3'
    });
  });

  it('returns undefined for unknown, null, undefined, and empty', () => {
    expect(resolveCreativeByName('Nope', CREATIVES)).toBeUndefined();
    expect(resolveCreativeByName(null, CREATIVES)).toBeUndefined();
    expect(resolveCreativeByName(undefined, CREATIVES)).toBeUndefined();
    expect(resolveCreativeByName('', CREATIVES)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot resolve `../electron/creativeMatch`.

- [ ] **Step 3: Implement `electron/creativeMatch.ts`**

```ts
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
  const m = creatives.find(c => c.name.toLowerCase() === needle);
  return m ? { creativeId: m.id, creativeName: m.name } : undefined;
}
```

- [ ] **Step 4: Run tests** — `npm test` → expected PASS (8 existing + 9 new = 17).

- [ ] **Step 5: Verify electron compile** — `npm run build:electron` → clean; `dist-electron/creativeMatch.js` exists.

- [ ] **Step 6: Commit**

```bash
git add electron/creativeMatch.ts tests/creativeMatch.test.ts
git commit -m "feat: pure creative shortlist + name resolution helpers"
```

---

### Task 2: ai.ts — candidates in both prompts

**Files:**
- Modify: `electron/ai.ts` (`CategorySuggestion` ~line 36, `suggestCategory` ~lines 43-97, `ParsedBatchRow` ~line 104, `parseBatch` ~lines 114-210)

- [ ] **Step 1: Extend the types**

`CategorySuggestion` gains two optional fields (ids are attached by main.ts, not here):

```ts
export type CategorySuggestion = {
  clientName?: string;
  creativeId?: number;
  creativeName?: string;
  division?: string;
  category?: string;
  confidence: number;
};
```

`ParsedBatchRow` likewise:

```ts
export type ParsedBatchRow = {
  date: string; // ISO YYYY-MM-DD
  name: string;
  durationMinutes: number;
  clientName?: string;
  creativeId?: number;
  creativeName?: string;
  division?: string;
  category?: string;
  confidence: number;
};
```

- [ ] **Step 2: `suggestCategory` — context, prompt, and validated return**

Signature's context type gains `creativeCandidates?: string[]`:

```ts
export async function suggestCategory(
  activityName: string,
  context: {
    recents: Array<{ name: string; clientName?: string }>;
    clients: string[];
    creativeCandidates?: string[];
  }
): Promise<CategorySuggestion> {
```

After the `clientsHint` const, add:

```ts
  const creativesHint = context.creativeCandidates?.length
    ? `\nCandidate creatives (pick exactly one the activity refers to, or null — only names from this list): ${context.creativeCandidates.join(', ')}.`
    : '';
```

Replace the `sys` template (keep the surrounding confidence-rubric comment added 2026-06-04) with:

```ts
  const sys = `You classify time-tracking activity names for a creative agency.
Return strict JSON only, no prose: {"clientName": string|null, "creativeName": string|null, "division": string|null, "category": string|null, "confidence": 0..1}.
Allowed divisions: ${DIVISIONS.join(', ')}.
Allowed categories: ${CATEGORIES.join(', ')}.${clientsHint}${creativesHint}
Infer the client from the activity name or from similar recent activities. The client and creative are OPTIONAL — returning null for clientName or creativeName is normal and must NOT lower confidence.
confidence scores ONLY how likely your division and category are correct: 0.8+ when the activity clearly implies them, 0.5-0.7 when plausible, below 0.5 only when the name is too vague to classify at all.`;
```

In the success return, after `clientMatch`, add the candidate-validated creative and include it in the returned object:

```ts
    const creativeMatch =
      typeof parsed.creativeName === 'string' && context.creativeCandidates
        ? context.creativeCandidates.find(
            n => n.toLowerCase() === parsed.creativeName.toLowerCase()
          )
        : undefined;
    return {
      clientName: clientMatch,
      creativeName: creativeMatch,
      division: DIVISIONS.includes(parsed.division) ? parsed.division : undefined,
      category: CATEGORIES.includes(parsed.category) ? parsed.category : undefined,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0))
    };
```

- [ ] **Step 3: `parseBatch` — context, prompt, and row mapping**

Context type gains the same optional field:

```ts
export async function parseBatch(
  text: string,
  context: { clients: string[]; today: string; primaryDivision?: string; creativeCandidates?: string[] }
): Promise<ParsedBatchRow[]> {
```

Inside, after `primaryHint`, add:

```ts
  const creativesHint = context.creativeCandidates?.length
    ? `\n\nCandidate creatives (a row may reference at most one; only use names from this list): ${context.creativeCandidates.join(', ')}`
    : '';
```

In the `sys` template's field list, after the `clientName` line, add:

```
- creativeName: must match exactly one of the candidate creatives OR be omitted (optional — omitting must not lower confidence)
```

and append `${creativesHint}` immediately after the `Allowed clients (...)` line.

In the row mapping, after `clientMatch`, add:

```ts
      const creativeMatch =
        typeof row.creativeName === 'string' && context.creativeCandidates
          ? context.creativeCandidates.find(
              n => n.toLowerCase() === row.creativeName.toLowerCase()
            )
          : undefined;
```

and include `creativeName: creativeMatch,` in the returned row object (after `clientName: clientMatch,`).

- [ ] **Step 4: Verify** — `npm run build:electron` clean; `npm test` 17/17.

- [ ] **Step 5: Commit**

```bash
git add electron/ai.ts
git commit -m "feat: AI prompts accept creative candidates and return a validated creativeName"
```

---

### Task 3: main.ts — shortlist & resolve in both handlers

**Files:**
- Modify: `electron/main.ts` (`ai:suggest` ~line 580, `batch:parse` ~line 610, imports ~line 28-45)

- [ ] **Step 1: Imports** — add to the existing import block:

```ts
import { shortlistCreatives, resolveCreativeByName, type CreativeRef } from './creativeMatch';
```

(`listCreatives` and `getBoardCols` are already imported from `./monday` — verify; if `getBoardCols` is not in the import list, add it.)

- [ ] **Step 2: Shared candidate loader** — add this helper near the other module-level functions (before `registerIpc`):

```ts
// Creative candidates for AI suggestion — best-effort: any failure (no board,
// no creative column, cache miss) just means no creative gets suggested.
async function creativeCandidateRefs(): Promise<CreativeRef[]> {
  try {
    const boardId = store.get('boardId');
    if (!boardId || !(await getBoardCols(boardId)).creative) return [];
    return await listCreatives();
  } catch {
    return [];
  }
}
```

- [ ] **Step 3: `ai:suggest` handler** — replace with:

```ts
  ipcMain.handle('ai:suggest', async (_e, name: string) => {
    const recents = store.get('recents').map(r => ({ name: r.name, clientName: r.clientName }));
    const clients = await listClients();
    const candidates = shortlistCreatives(name, await creativeCandidateRefs());
    const suggestion = await suggestCategory(name, {
      recents,
      clients: clients.map(c => c.name),
      creativeCandidates: candidates.map(c => c.name)
    });
    // Attach the id for the renderer; an unknown/hallucinated name resolves
    // to undefined and the suggestion degrades to client/division/category.
    const resolved = resolveCreativeByName(suggestion.creativeName, candidates);
    return { ...suggestion, creativeName: resolved?.creativeName, creativeId: resolved?.creativeId };
  });
```

- [ ] **Step 4: `batch:parse` handler** — replace with:

```ts
  ipcMain.handle('batch:parse', async (_e, text: string) => {
    const clients = await listClients();
    // Use LOCAL date — UTC was making "yesterday" off by a day for users in
    // AU/Asia timezones where the local day is ahead of UTC.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const primaryDivision = store.get('settings').primaryDivision;
    const candidates = shortlistCreatives(text, await creativeCandidateRefs(), { cap: 25 });
    const rows = await parseBatch(text, {
      clients: clients.map(c => c.name),
      today,
      primaryDivision,
      creativeCandidates: candidates.map(c => c.name)
    });
    // Attach ids; drop a creative that contradicts the row's matched client —
    // the client↔creative consistency rule the pickers enforce manually.
    return rows.map(row => {
      const resolved = resolveCreativeByName(row.creativeName, candidates);
      if (!resolved) return { ...row, creativeName: undefined };
      const ref = candidates.find(c => c.id === resolved.creativeId);
      const ownerName = ref?.clientId ? clients.find(c => c.id === ref.clientId)?.name : undefined;
      const clientOk = !row.clientName || !ownerName || ownerName === row.clientName;
      return clientOk
        ? { ...row, creativeName: resolved.creativeName, creativeId: resolved.creativeId }
        : { ...row, creativeName: undefined };
    });
  });
```

- [ ] **Step 5: Verify** — `npm run build:electron` clean; `npm test` 17/17.

- [ ] **Step 6: Commit**

```bash
git add electron/main.ts
git commit -m "feat: ai:suggest and batch:parse shortlist creatives and resolve ids"
```

---

### Task 4: Renderer — AiStrip segment, Tracker accept, Batch mapping

**Files:**
- Modify: `src/components/AiStrip.tsx`
- Modify: `src/views/Tracker.tsx` (suggestion state ~line 40, AiStrip usage ~lines 275-291)
- Modify: `src/views/Batch.tsx` (`parse()` mapping ~lines 137-149)

- [ ] **Step 1: AiStrip renders the creative**

In `src/components/AiStrip.tsx`, change the Props type and the two referencing lines:

```ts
type Props = {
  clientName?: string;
  creativeName?: string;
  division?: string;
  category?: string;
  confidence: number;
  onAccept: () => void;
  onDismiss: () => void;
};

export function AiStrip({ clientName, creativeName, division, category, confidence, onAccept, onDismiss }: Props) {
  if (confidence <= 0.5 || (!clientName && !creativeName && !division && !category)) return null;
  const parts = [
    clientName && <span key="client">{clientName}</span>,
    creativeName && <span key="creative">{creativeName}</span>,
    division && <span key="division" className="text-mute">{division}</span>,
    category && <span key="category">{category}</span>
  ].filter(Boolean);
```

(The rest of the component is unchanged.)

- [ ] **Step 2: Tracker suggestion state + accept**

In `src/views/Tracker.tsx`, extend the suggestion state type (~line 40):

```ts
  const [suggestion, setSuggestion] = useState<{
    clientName?: string;
    creativeId?: number;
    creativeName?: string;
    division?: string;
    category?: string;
    confidence: number;
  }>({ confidence: 0 });
```

Replace the `onAccept` body (~lines 277-289) with:

```tsx
        onAccept={() => {
          if (suggestion.creativeId && suggestion.creativeName) {
            // Creative wins: pickCreative also fills its owning client, the
            // same rule as picking manually — overriding the AI's client
            // guess if they conflict.
            pickCreative(suggestion.creativeId, suggestion.creativeName);
          } else if (suggestion.clientName) {
            const match = clients.find(c => c.name.toLowerCase() === suggestion.clientName!.toLowerCase());
            if (match) pickClient(match.id, match.name);
          }
          if (suggestion.division) setDivision(suggestion.division);
          if (suggestion.category) setCategory(suggestion.category);
          setDismissed(true);
        }}
```

(Note this also routes the client through `pickClient` instead of raw setters — `pickClient` clears a stale creative that doesn't match, which the old inline setters didn't.)

- [ ] **Step 3: Batch maps parsed creative fields**

In `src/views/Batch.tsx` `parse()` (~line 138), add two lines to the `newRow({...})` call:

```ts
        return newRow({
          date: p.date,
          name: p.name,
          clientId: c.id,
          clientName: c.name,
          creativeId: p.creativeId,
          creativeName: p.creativeName,
          division: p.division,
          category: p.category,
          durationMinutes: p.durationMinutes,
          confidence: p.confidence
        });
```

- [ ] **Step 4: Verify** — `npm run build` (vite + tsc) clean; `npm test` 17/17.

- [ ] **Step 5: Commit**

```bash
git add src/components/AiStrip.tsx src/views/Tracker.tsx src/views/Batch.tsx
git commit -m "feat: AI suggestion applies and displays the matched creative"
```

---

### Task 5: Live prompt sanity check + manual E2E

No file changes (a scratch script is run inline and not committed).

- [ ] **Step 1: Live API sanity check** — run from the project root:

```bash
node -e "
const fs = require('fs');
for (const line of fs.readFileSync('.env.local','utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*\$/i);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['\"]|['\"]\$/g,'');
}
const Anthropic = require('@anthropic-ai/sdk').default;
const c = new Anthropic({ apiKey: process.env.SWAN_ANTHROPIC_KEY });
const sys = 'You classify time-tracking activity names for a creative agency.\nReturn strict JSON only, no prose: {\"clientName\": string|null, \"creativeName\": string|null, \"division\": string|null, \"category\": string|null, \"confidence\": 0..1}.\nAllowed divisions: Content Delivery, Growth, Production, Operations, Business Development.\nAllowed categories: Editing, Strategy, Meetings, Admin, Briefing, Review, Shoot.\nCandidate creatives (pick exactly one the activity refers to, or null — only names from this list): Foodie Finds Ep 3, The Supplement Scam, Style Stalker.\nInfer the client from the activity name or from similar recent activities. The client and creative are OPTIONAL — returning null for clientName or creativeName is normal and must NOT lower confidence.\nconfidence scores ONLY how likely your division and category are correct: 0.8+ when the activity clearly implies them, 0.5-0.7 when plausible, below 0.5 only when the name is too vague to classify at all.';
c.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, system: sys, messages: [{role:'user', content: 'Activity: \"editing the foodie video\"\nRecent activities by this user (for context):\n(none)'}] })
  .then(r => console.log(r.content.map(b=>b.type==='text'?b.text:'').join('')))
  .catch(e => console.log('API ERROR:', e.status, e.message.slice(0,200)));
"
```

Expected: JSON with `"creativeName": "Foodie Finds Ep 3"`, division/category sensible, confidence > 0.5.

- [ ] **Step 2: Manual E2E in the dev app** (`npm run dev`, AI enabled, signed in):
- Type an activity referencing a real creative by (partial) name → strip shows `client · creative · division · category` → Accept fills the Creative picker AND its client
- Type an activity with no creative reference → strip appears without a creative segment; Accept works as before
- Batch: paste a line referencing a creative → parsed row has the creative cell filled; a row whose AI client conflicts with the creative's owner gets no creative
- Board with creatives disabled (if available): suggestion works exactly as before

---

## Verification checklist (after all tasks)

- [ ] `npm test` — 17/17; `npm run build` — clean
- [ ] Spec §1 → Task 1; §2 → Task 2; §3 → Task 3; §4 → Task 4 (incl. documented Batch deviation); error handling (empty shortlist / hallucinated name / disabled creatives) → Tasks 2-3 code paths; testing → Tasks 1, 5
- [ ] No `electron/monday.ts` staged in any commit
