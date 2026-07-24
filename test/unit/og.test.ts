import { describe, it, expect } from 'vitest';
import { ogGradient } from '@/lib/utils/og';

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
