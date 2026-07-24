import { describe, it, expect } from 'vitest';
import { coverGradient } from '@/lib/utils/cover';

describe('coverGradient', () => {
  it('is deterministic for a given seed', () => {
    expect(coverGradient('wishlist-123')).toBe(coverGradient('wishlist-123'));
  });

  it('returns a CSS gradient string', () => {
    expect(coverGradient('abc')).toContain('gradient(');
  });

  it('handles an empty seed without throwing', () => {
    expect(typeof coverGradient('')).toBe('string');
  });

  it('spreads different seeds across more than one gradient', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => `seed-${i}`);
    const distinct = new Set(seeds.map(coverGradient));
    expect(distinct.size).toBeGreaterThan(1);
  });
});
