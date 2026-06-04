# Swan Time — AI creative suggestion (Tracker + Batch)

**Date:** 2026-06-04
**Status:** Approved pending user review
**Approach:** Local shortlist → AI picks from candidates in the same call ("Approach A"), applied to both the Tracker suggest strip and Batch parse.

## Problem

The AI strip suggests client/division/category but never the Creative
(board_relation to Creatives board 1909945576, ~6k items). Jake wants creatives
suggested too — in the Tracker strip and in Batch parse (closing the gap accepted
on 2026-06-03). The full creatives list is far too large to put in a prompt;
creative names are natural-language titles ("The Supplement Scam"), so semantic
matching by the model adds real value over pure token matching — but only the
model can't see 6k names, so candidates must be shortlisted locally first.

## Design

### 1. New pure module: `electron/creativeMatch.ts` (unit-tested)

- `shortlistCreatives(text: string, creatives: CreativeRef[], opts?: { clientId?: number; cap?: number }): CreativeRef[]`
  - `CreativeRef = { id: number; name: string; clientId?: number }`
  - Tokenize `text` and names: lowercase, split on non-alphanumerics, keep tokens ≥3 chars
  - Score = count of shared tokens; +2 boost when `creative.clientId === opts.clientId`
  - Return top `cap` (default 15) with score > 0; when `clientId` is set and fewer
    than `cap` scored, fill remaining slots with that client's other creatives
  - Deterministic order: score desc, then name asc
- `resolveCreativeByName(name: string | null | undefined, creatives: CreativeRef[]): { creativeId: number; creativeName: string } | undefined`
  - Case-insensitive exact name match; undefined otherwise
- No Electron imports → testable under vitest in `tests/creativeMatch.test.ts`

### 2. `electron/ai.ts`

- `suggestCategory` context gains `creativeCandidates: string[]` (already-shortlisted
  names). When non-empty, the system prompt adds:
  `Candidate creatives (pick exactly one that the activity refers to, or null): <names>.`
  and the JSON shape gains `"creativeName": string|null`. Same calibration rule as
  client: the creative is OPTIONAL and must NOT lower confidence.
- The returned `creativeName` is honored only if it appears in the candidate list
  (case-insensitive) — the model cannot hallucinate arbitrary creatives.
- `parseBatch` context gains the same `creativeCandidates` (one shortlist for the
  whole batch text, cap 25); each parsed row may carry `creativeName`.
- `CategorySuggestion` and `ParsedBatchRow` types gain optional
  `creativeId`/`creativeName` (ids filled by main, below).

### 3. `electron/main.ts` handlers

- `ai:suggest`: when creatives are enabled for the active board, load the cached
  creatives index, `shortlistCreatives(activityName, creatives)`, pass candidate
  names; resolve the response's `creativeName` via `resolveCreativeByName` and
  attach `creativeId`/`creativeName` to the suggestion. Creatives disabled or
  shortlist empty → behavior identical to today.
- `batch:parse`: same pattern; shortlist once from the raw batch text, resolve per
  row.

### 4. Renderer

- **Tracker** (`src/views/Tracker.tsx` + `src/components/AiStrip.tsx`): AiStrip
  renders the creative as an additional segment. On Accept, when the suggestion
  carries a creative: apply it and derive its owning client via the existing
  `clientForCreative` rule — the creative's client wins over the AI's client guess
  when they conflict (mirrors manual picking).
- **Batch** (`src/views/Batch.tsx`): no changes — parsed rows already map
  `creativeId`/`creativeName` through (line ~58), and the existing
  client↔creative sync rules apply to subsequent manual edits.

## Error handling

- Empty shortlist → no candidates line in the prompt → model returns null →
  nothing attached. Unknown/hallucinated name → resolves undefined → silently no
  creative. The existing suggestion behavior can't regress.
- Creatives feature disabled for the board (`creativesEnabled` false) → all new
  code paths skipped.

## Testing

- Vitest: `tests/creativeMatch.test.ts` — tokenize/score/boost/cap/fill/ordering
  for `shortlistCreatives`; exact/case-insensitive/miss for `resolveCreativeByName`.
- Live prompt sanity check (like the 2026-06-04 confidence fix): one scripted call
  with candidates, verify `creativeName` returned and confidence unaffected.
- Manual E2E in dev: Tracker strip shows and applies creative + auto-client;
  batch parse fills creative cells; client-conflict rule honored.

## Out of scope

- Today-view editing (manual creative picker already exists there).
- Any change to the creatives index/caching.
