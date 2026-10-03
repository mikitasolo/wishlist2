import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { sourceFiles } from '../sourceFiles';
import { CONTROL_ICON_SIZE, ICON_BUTTON_ICON_SIZE } from '@/components/buttonStyles';
import { MENU_ICON_SIZE } from '@/components/popoverStyles';

/** 12 in a badge, 16 in an sm/md control, 18 in an lg control, an icon button or a menu, 28 in a large chip. */
const ICON_SIZES = [12, 16, 18, 28];

describe('icon sizes', () => {
  it('sizes every control and menu icon from the scale', () => {
    expect(Object.values(CONTROL_ICON_SIZE)).toEqual([16, 16, 18, 18]);
    expect(ICON_BUTTON_ICON_SIZE).toBe(18);
    expect(MENU_ICON_SIZE).toBe(18);
  });

  // regression: icons came in 14 sizes from 11 to 34px, so the same kind of
  // icon was drawn at 15, 16, 17, 18 or 20px depending on the screen (DS-15).
  it('draws no <Icon> at a size off the scale', () => {
    const offenders = ['app', 'components', 'lib'].flatMap((dir) =>
      sourceFiles(path.join(process.cwd(), dir)).flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        // Each <Icon …> element's literal sizes, a conditional's both branches included.
        return [...source.matchAll(/<Icon\b[^>]*?\bsize=\{([^}]*)\}/gs)].flatMap(([, size]) =>
          [...size.matchAll(/\b\d+\b/g)]
            .map(([n]) => Number(n))
            .filter((n) => !ICON_SIZES.includes(n))
            .map((n) => `${path.relative(process.cwd(), file)}: ${n}px`)
        );
      })
    );
    expect(offenders).toEqual([]);
  });

  // regression: "+ Add item", "+ Propose item" and the stat tiles' "→" were
  // text standing in for icons (DS-15).
  it('draws no plus or arrow glyph in place of an icon', () => {
    const offenders = ['app', 'components'].flatMap((dir) =>
      sourceFiles(path.join(process.cwd(), dir)).flatMap((file) =>
        />\s*(\+ [A-Z]|→\s*<)/.test(readFileSync(file, 'utf8'))
          ? [path.relative(process.cwd(), file)]
          : []
      )
    );
    expect(offenders).toEqual([]);
  });
});
