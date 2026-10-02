import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOGO_SVG } from '@/lib/brandLogo';

/** The shapes an SVG draws and the colours it fills them with, ignoring ids and layout. */
function drawing(svg: string) {
  return {
    shapes: (svg.match(/<(rect|path|circle)\b[^>]*\/>/g) ?? []).map((shape) =>
      shape.replace(/url\(#[^)]+\)/, 'url(#gradient)')
    ),
    stops: svg.match(/stop-color="[^"]+"/g) ?? [],
    viewBox: svg.match(/viewBox="[^"]+"/)?.[0],
  };
}

describe('LOGO_SVG', () => {
  // The share cards draw the logo from this copy, so it must stay the
  // favicon's logo. (The email's PNG is checked in emailLogo.test.ts.)
  it('draws the same logo as app/icon.svg', () => {
    const favicon = readFileSync(join(process.cwd(), 'app/icon.svg'), 'utf8');
    expect(drawing(LOGO_SVG)).toEqual(drawing(favicon));
    expect(drawing(LOGO_SVG).shapes.length).toBeGreaterThan(0);
  });
});
