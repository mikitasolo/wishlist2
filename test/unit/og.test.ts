import { describe, it, expect } from 'vitest';
import { ogGradient, withTimeout } from '@/lib/utils/og';

describe('ogGradient', () => {
  it('is deterministic for a given seed', () => {
    expect(ogGradient('abc')).toEqual(ogGradient('abc'));
  });

  it('returns a Satori-friendly single linear-gradient with two hex stops', () => {
    const g = ogGradient('wishlist-123');
    expect(g.css).toMatch(/^linear-gradient\(135deg, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/i);
    expect(g.css).toContain(g.from);
    expect(g.css).toContain(g.to);
  });

  it('falls back gracefully for an empty seed', () => {
    expect(ogGradient('').css).toMatch(/^linear-gradient/);
  });
});

describe('withTimeout', () => {
  it('resolves with the value when the promise beats the deadline', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  // regression: an OG image must never hang on a slow DB/upstream — the data
  // work is raced against a deadline so the route can fall back fast.
  it('rejects when the promise is slower than the deadline', async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 50));
    await expect(withTimeout(slow, 10)).rejects.toThrow(/timeout/);
  });
});
