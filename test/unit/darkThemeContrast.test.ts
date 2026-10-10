import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

// WIS-405: the dark tokens' contrast pairs, computed from app/globals.css so a
// palette change can't quietly drop a status tone under AA (ui.md: >= 4.5:1).
const css = readFileSync('app/globals.css', 'utf8');
const dark = css.slice(css.indexOf(":root[data-theme='dark'] {"), css.indexOf('color-scheme: dark;'));
const light = css.slice(css.indexOf(':root {\n  --background'), css.indexOf('color-scheme: light;'));

type RGB = [number, number, number];

function token(block: string, name: string): string {
  const re = new RegExp(`--${name}:\\s*([^;]+);`);
  // Dark overrides only some tokens (e.g. --info stays var(--accent)): the rest are light's.
  const m = block.match(re) ?? (block === dark ? light.match(re) : null);
  if (!m) throw new Error(`token --${name} not found`);
  return m[1].trim();
}

function oklchToRgb(l: number, c: number, hDeg: number): RGB {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return lin.map((v) => {
    const x = Math.min(1, Math.max(0, v));
    return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
  }) as RGB;
}

function color(block: string, name: string, seen = 0): RGB {
  const v = token(block, name);
  const ref = v.match(/^var\(--([\w-]+)\)$/);
  if (ref && seen < 5) return color(block, ref[1], seen + 1);
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as RGB;
  const ok = v.match(/^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)$/);
  if (ok) return oklchToRgb(+ok[1] / 100, +ok[2], +ok[3]);
  throw new Error(`can't read --${name}: ${v}`);
}

const over = (fg: RGB, alpha: number, bg: RGB): RGB =>
  fg.map((v, i) => v * alpha + bg[i] * (1 - alpha)) as RGB;

function luminance([r, g, b]: RGB): number {
  const [R, G, B] = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function ratio(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE: RGB = [255, 255, 255];
const TONES = ['info', 'success', 'warning', 'danger'] as const;
const GROUNDS = ['background', 'surface', 'surface-2'] as const;

describe('dark theme contrast (WIS-405)', () => {
  it('steps the ground up: background < surface < surface-2, and is not pure black', () => {
    const [bg, s, s2] = GROUNDS.map((n) => luminance(color(dark, n)));
    expect(bg).toBeGreaterThan(0);
    expect(s).toBeGreaterThan(bg);
    expect(s2).toBeGreaterThan(s);
  });

  it.each(GROUNDS)('keeps foreground at AAA and muted text and accent at AA on %s', (g) => {
    expect(ratio(color(dark, 'foreground'), color(dark, g))).toBeGreaterThanOrEqual(7);
    expect(ratio(color(dark, 'muted-foreground'), color(dark, g))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(color(dark, 'accent'), color(dark, g))).toBeGreaterThanOrEqual(4.5);
  });

  describe.each(TONES)('status tone %s', (tone) => {
    it.each(GROUNDS)('text on %s stays at AA', (g) => {
      expect(ratio(color(dark, tone), color(dark, g))).toBeGreaterThanOrEqual(4.5);
    });

    it.each([0.1, 0.15])('text on its own %s tint stays at AA', (a) => {
      for (const g of ['surface', 'surface-2'] as const) {
        const fg = color(dark, tone);
        expect(ratio(fg, over(fg, a, color(dark, g)))).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('white text on its fill stays at AA (fills are shared with light)', () => {
      expect(ratio(WHITE, color(light, `${tone}-fill`))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(WHITE, color(light, `${tone}-fill-hover`))).toBeGreaterThanOrEqual(4.5);
    });
  });
});
