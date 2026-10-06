// A share link's printed card (WIS-346): how many cards a sheet holds, the
// design a card starts on, and how its text is fitted.
import { describe, it, expect } from 'vitest';
import {
  PRINTABLE_AREA,
  QR_CARD_SIZES,
  QR_CARD_SIZE_SPECS,
  SHEET_GAP,
  cardPixelSize,
  clampCopies,
  defaultCardDesign,
  fitText,
  maxCopiesPerSheet,
  sheetColumns,
  sheetGrid,
  textEm,
  wrapText,
} from '@/lib/utils/qrCard';

describe('sheetGrid', () => {
  it('fits eight credit cards, two postcards, and one A5 or full page to a sheet', () => {
    expect(sheetGrid('card')).toEqual({ cols: 2, rows: 4 });
    expect(maxCopiesPerSheet('card')).toBe(8);
    expect(maxCopiesPerSheet('postcard')).toBe(2);
    expect(maxCopiesPerSheet('a5')).toBe(1);
    expect(maxCopiesPerSheet('page')).toBe(1);
  });

  it('never lays out more than the printable area of A4 and of US Letter', () => {
    for (const size of QR_CARD_SIZES) {
      const { width, height } = QR_CARD_SIZE_SPECS[size];
      const { cols, rows } = sheetGrid(size);
      expect(cols * width + (cols - 1) * SHEET_GAP).toBeLessThanOrEqual(PRINTABLE_AREA.width);
      expect(rows * height + (rows - 1) * SHEET_GAP).toBeLessThanOrEqual(PRINTABLE_AREA.height);
    }
  });
});

describe('cardPixelSize', () => {
  it('sizes a card image at 300 dpi of its printed size', () => {
    expect(cardPixelSize('card')).toEqual({ width: 1004, height: 638 });
    expect(cardPixelSize('postcard')).toEqual({ width: 1748, height: 1240 });
    expect(cardPixelSize('card', 600)).toEqual({ width: 2008, height: 1276 });
  });
});

describe('clampCopies / sheetColumns', () => {
  it('holds copies between 1 and what a sheet holds', () => {
    expect(clampCopies('card', 0)).toBe(1);
    expect(clampCopies('card', 3.7)).toBe(3);
    expect(clampCopies('card', 20)).toBe(8);
    expect(clampCopies('postcard', 8)).toBe(2);
    expect(clampCopies('card', Number.NaN)).toBe(1);
  });

  it('lays one copy out in one column, not beside an empty one', () => {
    expect(sheetColumns('card', 1)).toBe(1);
    expect(sheetColumns('card', 5)).toBe(2);
  });
});

describe('defaultCardDesign', () => {
  it('starts on the occasion’s own design, else Classic', () => {
    expect(defaultCardDesign('birthday')).toBe('birthday');
    expect(defaultCardDesign('wedding')).toBe('wedding');
    expect(defaultCardDesign('holiday')).toBe('holiday');
    expect(defaultCardDesign('other')).toBe('classic');
    expect(defaultCardDesign(null)).toBe('classic');
    expect(defaultCardDesign(undefined)).toBe('classic');
  });
});

describe('textEm', () => {
  it('counts a CJK character or an emoji as a whole em, wider than a Latin letter', () => {
    expect(textEm('結婚式')).toBe(3);
    expect(textEm('🎁')).toBe(1);
    expect(textEm('abc')).toBeLessThan(textEm('ABC'));
    expect(textEm('WWW')).toBeGreaterThan(textEm('aaa'));
    expect(textEm('ill')).toBeLessThan(textEm('aaa'));
  });
});

describe('wrapText', () => {
  it('breaks at spaces, each line within the width', () => {
    const { lines, fits } = wrapText('Things for the new flat', 6.5, 3);
    expect(fits).toBe(true);
    expect(lines.join(' ')).toBe('Things for the new flat');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textEm(line)).toBeLessThanOrEqual(6.5);
  });

  it('cuts what doesn’t fit with an ellipsis', () => {
    const { lines, fits } = wrapText('one two three four five six', 5, 2);
    expect(fits).toBe(false);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
    expect(textEm(lines[1])).toBeLessThanOrEqual(5);
  });

  it('splits a word wider than a line, and says it didn’t fit whole', () => {
    const { lines, fits } = wrapText('Supercalifragilistic', 4, 4);
    expect(fits).toBe(false);
    expect(lines.join('')).toBe('Supercalifragilistic');
    for (const line of lines) expect(textEm(line)).toBeLessThanOrEqual(4);
  });

  it('never splits an emoji in half', () => {
    const { lines } = wrapText('🎁🎁🎁🎁', 2, 3);
    expect(lines).toEqual(['🎁🎁', '🎁🎁']);
  });
});

describe('fitText', () => {
  it('keeps the biggest size for a short name', () => {
    expect(fitText('Ann', { width: 40, max: 6, min: 3, maxLines: 2 })).toEqual({
      size: 6,
      lines: ['Ann'],
    });
  });

  // A name mustn’t wrap mid-word ("Mikita’" / "s 30th") at the biggest size
  // when a smaller one keeps the word whole.
  it('shrinks rather than split a word', () => {
    const { size, lines } = fitText('Mikita’s 30th', { width: 20, max: 6, min: 2, maxLines: 2 });
    expect(size).toBeLessThan(6);
    expect(lines).toEqual(['Mikita’s', '30th']);
  });

  it('gives wide glyphs more room than Latin ones of the same count', () => {
    const latin = fitText('abcdefghijkl', { width: 40, max: 8, min: 2, maxLines: 1 });
    const cjk = fitText('結婚式のウィッシュリスト', { width: 40, max: 8, min: 2, maxLines: 1 });
    expect(cjk.size).toBeLessThan(latin.size);
    expect(textEm(cjk.lines[0]) * cjk.size).toBeLessThanOrEqual(40);
  });

  it('cuts at the smallest size when nothing fits', () => {
    const { size, lines } = fitText('a '.repeat(200), { width: 10, max: 4, min: 2, maxLines: 2 });
    expect(size).toBe(2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
  });
});
