import { describe, it, expect } from 'vitest';
import { coverGradient, coverInitial } from '@/lib/utils/cover';

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

describe('coverInitial', () => {
  it("is the name's first letter, upper-cased", () => {
    expect(coverInitial('wingspan board game')).toBe('W');
    expect(coverInitial('  kindle')).toBe('K');
  });

  it('keeps a character made of several code points whole', () => {
    expect(coverInitial('🎁 Surprise')).toBe('🎁');
    expect(coverInitial('👩‍🍳 cooking class')).toBe('👩‍🍳');
    // "é" as an e and a combining accent.
    expect(coverInitial('éclair tray')).toBe('É');
    expect(coverInitial('👍🏽 thumbs')).toBe('👍🏽');
    expect(coverInitial('🇯🇵 trip')).toBe('🇯🇵');
    expect(coverInitial('❤️ locket')).toBe('❤️');
  });

  it('stays one character when its capital would be two', () => {
    expect(coverInitial('ßtraße')).toBe('ß');
    expect(coverInitial('ﬁsh knife')).toBe('ﬁ');
  });

  it('is empty for a name with nothing to show', () => {
    expect(coverInitial('')).toBe('');
    expect(coverInitial('   ')).toBe('');
  });
});
