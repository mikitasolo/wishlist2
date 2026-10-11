import { describe, it, expect } from 'vitest';
import {
  chooseCoverPattern,
  coverBackground,
  coverPatternCardSvg,
  coverPatternFamily,
  coverPatternSvg,
  PATTERN_OPACITY,
} from '@/lib/utils/coverPattern';

describe('coverPattern', () => {
  it('gives the same pattern for the same input', () => {
    expect(chooseCoverPattern('birthday', 'Maya turns 30')).toEqual(
      chooseCoverPattern('birthday', 'Maya turns 30')
    );
    expect(coverBackground('linear-gradient(red, blue)', 'holiday', 'Xmas')).toBe(
      coverBackground('linear-gradient(red, blue)', 'holiday', 'Xmas')
    );
  });

  it('lets the occasion pick the family', () => {
    expect(coverPatternFamily('birthday')).toBe('confetti');
    expect(coverPatternFamily('holiday')).toBe('ribbons');
    expect(coverPatternFamily('wedding')).toBe('line');
    expect(coverPatternFamily('other')).toBe('stripes');
    expect(coverPatternFamily(null)).toBe('stripes');
    expect(coverPatternFamily('nonsense')).toBe('stripes');
    expect(chooseCoverPattern('wedding', 'A').family).toBe('line');
  });

  it('lets the name vary the variant within a family', () => {
    const names = Array.from({ length: 30 }, (_, i) => `List ${i}`);
    const seen = new Set(
      names.map((n) => {
        const c = chooseCoverPattern('birthday', n);
        return `${c.size}-${c.offset}-${c.arrangement}`;
      })
    );
    expect(seen.size).toBeGreaterThan(3);
  });

  it('ignores case and surrounding space in the name', () => {
    expect(chooseCoverPattern(null, '  Weekend Trip ')).toEqual(
      chooseCoverPattern(null, 'weekend trip')
    );
  });

  it('draws every family as a self-contained SVG layered over the gradient', () => {
    for (const kind of ['birthday', 'holiday', 'wedding', 'other']) {
      const svg = coverPatternSvg(chooseCoverPattern(kind, 'x'));
      expect(svg.startsWith('<svg')).toBe(true);
    }
    const bg = coverBackground('linear-gradient(red, blue)', 'birthday', 'x');
    expect(bg).toContain('data:image/svg+xml');
    expect(bg.endsWith('linear-gradient(red, blue)')).toBe(true);
  });

  it('pre-tiles one card-sized SVG with the same ink, without a tiled background', () => {
    const size = { width: 1200, height: 630, scale: 2.4 };
    const svg = coverPatternCardSvg('birthday', 'x', size);
    expect(svg).toContain('viewBox="0 0 1200 630"');
    expect(svg).toContain(`opacity="${PATTERN_OPACITY}"`);
    expect(svg.match(/<svg x=/g)!.length).toBeGreaterThan(20);
    expect(svg).not.toContain('<pattern');
    expect(coverPatternCardSvg('birthday', 'x', size)).toBe(svg);
  });
});
