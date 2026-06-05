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

  it('matches accented names against ASCII input', () => {
    const out = shortlistCreatives('cafe shoot prep', [{ id: 9, name: 'Café Crawl' }]);
    expect(out.map(c => c.id)).toEqual([9]);
  });

  it('returns the client\'s creatives for empty text when clientId is set', () => {
    const out = shortlistCreatives('', CREATIVES, { clientId: 12 });
    expect(out.map(c => c.id).sort()).toEqual([3, 4]);
  });
});

describe('fuzzy matching', () => {
  it('matches plurals via stemming: "foodie" finds "New Foodies"', () => {
    const out = shortlistCreatives('foodie video', [
      { id: 20, name: 'New Foodies', clientId: 1 },
      { id: 21, name: 'Spring Sale', clientId: 2 }
    ]);
    expect(out.map(c => c.id)).toEqual([20]);
  });

  it('matches one-typo tokens of length >= 5: "fodie" finds "Foodie"', () => {
    const out = shortlistCreatives('fodie cut', [{ id: 22, name: 'Foodie Finds', clientId: 1 }]);
    expect(out.map(c => c.id)).toEqual([22]);
  });

  it('does NOT fuzzy-match short tokens: "cat" must not find "car"', () => {
    const out = shortlistCreatives('cat video', [{ id: 23, name: 'Car Review', clientId: 1 }]);
    expect(out).toEqual([]);
  });

  it('ranks exact token matches above fuzzy ones', () => {
    const out = shortlistCreatives('foodie video', [
      { id: 24, name: 'Foodies Abroad', clientId: 1 }, // stem match (1pt)
      { id: 25, name: 'Foodie Abroad', clientId: 1 }   // exact match (2pt)
    ]);
    expect(out.map(c => c.id)).toEqual([25, 24]);
  });

  it('stemming does not strip double-s: "boss" stays "boss"', () => {
    const out = shortlistCreatives('bos check', [{ id: 26, name: 'Boss Moves', clientId: 1 }]);
    expect(out).toEqual([]); // "bos" (3 chars) gets filtered by min length anyway; no stem collision
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
