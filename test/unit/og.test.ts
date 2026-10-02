import { describe, it, expect } from 'vitest';
import { coverGradient } from '@/lib/utils/cover';
import {
  CARD_CDN_MAX_AGE_SECONDS,
  clampText,
  ogCoverBackground,
  shareCardHeaders,
  titleFontSize,
  userCardTag,
  wishlistCardTag,
  withTimeout,
} from '@/lib/utils/og';

describe('ogCoverBackground', () => {
  it('is deterministic for a given seed', () => {
    expect(ogCoverBackground('abc')).toBe(ogCoverBackground('abc'));
  });

  // regression: Satori blends a `transparent` stop as transparent black, which
  // drew each cover's highlight as a muddy band, so the cards used a plainer
  // gradient than the list's own cover.
  it('is the list cover, with each transparent stop as its colour at zero alpha', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'wishlist', '64f0c0ffee']) {
      const og = ogCoverBackground(seed);
      expect(og).not.toContain('transparent');
      expect(og.replace(/rgba\(\d+, \d+, \d+, 0\)/g, 'transparent')).toBe(coverGradient(seed));
    }
    expect(ogCoverBackground('a')).toMatch(/#([0-9a-f]{6}) 0%, rgba\(\d+, \d+, \d+, 0\) 5\d%/);
  });

  it('turns the stop colour into the same rgb', () => {
    const og = ogCoverBackground('x');
    const [, hex, rgb] = og.match(/#([0-9a-f]{6}) 0%, rgba\((\d+, \d+, \d+), 0\)/)!;
    const expected = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
    expect(rgb).toBe(expected);
  });
});

describe('clampText', () => {
  it('keeps text that fits', () => {
    expect(clampText('  Birthday  ', 10)).toBe('Birthday');
  });

  it('cuts long text to the limit, ending in an ellipsis', () => {
    const out = clampText('a'.repeat(50), 20);
    expect(Array.from(out)).toHaveLength(20);
    expect(out.endsWith('…')).toBe(true);
  });

  it('never splits an emoji', () => {
    expect(clampText('🎁🎂🎉🎈', 3)).toBe('🎁🎂…');
  });

  it("doesn't leave a space before the ellipsis", () => {
    expect(clampText('word word word', 6)).toBe('word…');
  });
});

describe('titleFontSize', () => {
  it('shrinks as the title grows', () => {
    const short = titleFontSize('Birthday');
    const medium = titleFontSize('Things I would love for my thirtieth');
    const long = titleFontSize('A very long wishlist name that goes on and on and on for ages');
    expect(short).toBeGreaterThan(medium);
    expect(medium).toBeGreaterThan(long);
  });

  it('counts characters, not UTF-16 units', () => {
    expect(titleFontSize('🎁'.repeat(22))).toBe(titleFontSize('a'.repeat(22)));
  });
});

describe('share card cache headers', () => {
  it('tags a card with its list or user', () => {
    expect(wishlistCardTag('w1')).toBe('og-wishlist-w1');
    expect(userCardTag('u1')).toBe('og-user-u1');
  });

  it('lets only the CDN keep a card with tags, for a day', () => {
    const headers = shareCardHeaders(['og-wishlist-w1', 'og-user-u1']);
    expect(headers['Vercel-CDN-Cache-Control']).toBe(`public, max-age=${CARD_CDN_MAX_AGE_SECONDS}`);
    expect(CARD_CDN_MAX_AGE_SECONDS).toBe(86400);
    expect(headers['Vercel-Cache-Tag']).toBe('og-wishlist-w1,og-user-u1');
    // Browsers and crawlers revalidate; only our CDN, which we can purge, keeps it.
    expect(headers['Cache-Control']).toBe('public, max-age=0, must-revalidate');
  });

  // A generic card (hidden list, missing list or user, a fallback) must not be
  // pinned by the CDN, and must not differ between "hidden" and "missing".
  it('stores nothing for a card without tags', () => {
    expect(shareCardHeaders(null)).toEqual({ 'Cache-Control': 'no-store' });
    expect(shareCardHeaders([])).toEqual({ 'Cache-Control': 'no-store' });
  });
});

describe('withTimeout', () => {
  it('resolves with the value when the promise beats the deadline', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('passes a rejection through', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });

  // regression: an OG image must never hang on a slow DB/upstream — the data
  // work is raced against a deadline so the route can fall back fast.
  it('rejects when the promise is slower than the deadline', async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 50));
    await expect(withTimeout(slow, 10)).rejects.toThrow(/timeout/);
  });
});
