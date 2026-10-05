// A share link's QR code (WIS-328), drawn in the browser: the path covers
// exactly the encoder's dark modules inside the quiet zone.
import { describe, it, expect } from 'vitest';
import { encode } from 'uqr';
import { QR_QUIET_ZONE, qrFileName, qrShape, qrSvgFile } from '@/lib/utils/qrCode';

const URL_ = 'https://wishlist.example/l/AbCdEfGhIjKlMnOpQrStUv';

/** The modules a path fills, as "x,y", read back from its `M x y h n v1 h-n z` runs. */
function filled(path: string): Set<string> {
  const cells = new Set<string>();
  for (const [, x, y, run] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    for (let i = 0; i < Number(run); i++) cells.add(`${Number(x) + i},${y}`);
  }
  return cells;
}

describe('qrShape', () => {
  it('fills exactly the dark modules, offset by the quiet zone', () => {
    const { data, size } = encode(URL_, { ecc: 'M', border: 0 });
    const shape = qrShape(URL_);
    expect(shape.size).toBe(size + 2 * QR_QUIET_ZONE);
    const expected = new Set<string>();
    data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) expected.add(`${x + QR_QUIET_ZONE},${y + QR_QUIET_ZONE}`);
      })
    );
    expect(filled(shape.path)).toEqual(expected);
    // Nothing but runs: the regexp read every command.
    expect(shape.path.replace(/M\d+ \d+h\d+v1h-\d+z/g, '')).toBe('');
  });

  it('draws a different code for another token', () => {
    expect(qrShape(URL_).path).not.toBe(
      qrShape('https://wishlist.example/l/ZZZZZZZZZZZZZZZZZZZZZZ').path
    );
  });
});

describe('qrSvgFile', () => {
  it('is a standalone black-on-white SVG of the shape', () => {
    const shape = qrShape(URL_);
    const svg = qrSvgFile(shape);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="512" height="512"/);
    expect(svg).toContain(`viewBox="0 0 ${shape.size} ${shape.size}"`);
    expect(svg).toContain(`<rect width="${shape.size}" height="${shape.size}" fill="#fff"/>`);
    expect(svg).toContain(`<path d="${shape.path}" fill="#000"/>`);
  });
});

describe('qrFileName', () => {
  it.each([
    ['Anna’s wedding', 'annas-wedding-qr'],
    ['  Crème brûlée!! 2027 ', 'creme-brulee-2027-qr'],
    ['Свадьба', 'wishlist-qr'],
    ['a'.repeat(59) + ' b', 'a'.repeat(59) + '-qr'],
  ])('%s → %s', (name, expected) => {
    expect(qrFileName(name)).toBe(expected);
  });
});
