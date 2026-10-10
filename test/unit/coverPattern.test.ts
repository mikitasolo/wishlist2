import { describe, it, expect } from 'vitest';
import {
  chooseCoverPattern,
  coverBackground,
  coverPatternFamily,
  coverPatternSvg,
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
});
