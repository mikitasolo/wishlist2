/**
 * The gift-wrap pattern drawn over a list's or item's cover gradient when it
 * has no photo (WIS-397). The occasion picks the family (birthday confetti,
 * holiday ribbons, a wedding line, plain wrapping-paper stripes for anything
 * else), and a hash of the name picks the variant, so two lists of one
 * occasion still differ and one list never changes.
 *
 * Pure and token-driven: the ink and the sizes are the constants below, so a
 * rebrand swaps values here and nothing else. The pattern is white ink at low
 * opacity over the saturated gradient, which reads the same in light and dark.
 * Only the occasion's kind and the name are ever read, both things a viewer who
 * can open the list already sees.
 */

import { OCCASION_KINDS, type OccasionKind } from '@/lib/utils/occasion';

export type CoverPatternFamily = 'confetti' | 'ribbons' | 'line' | 'stripes';

/** Ink of every pattern, as an SVG colour; its strength is `PATTERN_OPACITY`. */
export const PATTERN_INK = '#ffffff';
export const PATTERN_OPACITY = 0.22;

/** Tile edge in px for each size variant; the variant is picked from the name's hash. */
export const PATTERN_TILE_SIZES = [44, 56, 68, 80] as const;
/** Offsets so two covers of one family and size don't line up. */
export const PATTERN_OFFSETS = [0, 11, 23, 37] as const;

const FAMILY_BY_OCCASION: Record<OccasionKind, CoverPatternFamily> = {
  birthday: 'confetti',
  holiday: 'ribbons',
  wedding: 'line',
  other: 'stripes',
};

export interface CoverPatternChoice {
  family: CoverPatternFamily;
  /** Index into `PATTERN_TILE_SIZES`. */
  size: number;
  /** Index into `PATTERN_OFFSETS`. */
  offset: number;
  /** Which arrangement of the family's shapes (0 or 1). */
  arrangement: 0 | 1;
}

function hash(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h;
}

/** The family for an occasion kind; anything unknown or missing is the stripes. */
export function coverPatternFamily(kind: string | null | undefined): CoverPatternFamily {
  return (OCCASION_KINDS as readonly string[]).includes(kind ?? '')
    ? FAMILY_BY_OCCASION[kind as OccasionKind]
    : 'stripes';
}

/** Same inputs, same choice; the occasion picks the family, the name the variant. */
export function chooseCoverPattern(
  kind: string | null | undefined,
  name: string
): CoverPatternChoice {
  const h = hash(name.trim().toLowerCase());
  return {
    family: coverPatternFamily(kind),
    size: h % PATTERN_TILE_SIZES.length,
    offset: Math.floor(h / 4) % PATTERN_OFFSETS.length,
    arrangement: (Math.floor(h / 16) % 2) as 0 | 1,
  };
}

function shapes(family: CoverPatternFamily, arrangement: 0 | 1): string {
  // All drawn in a 40x40 box and scaled to the tile.
  switch (family) {
    case 'confetti':
      return arrangement === 0
        ? '<circle cx="6" cy="8" r="2.2"/><rect x="24" y="5" width="7" height="2.6" rx="1.3" transform="rotate(35 27 6)"/><path d="M14 27l3.5 6h-7z"/><circle cx="32" cy="29" r="1.6"/><rect x="3" y="33" width="6" height="2.4" rx="1.2" transform="rotate(-30 6 34)"/>'
        : '<circle cx="31" cy="8" r="2"/><rect x="5" y="6" width="7" height="2.6" rx="1.3" transform="rotate(-35 8 7)"/><path d="M26 25l3.5 6h-7z"/><circle cx="9" cy="29" r="1.8"/><rect x="18" y="14" width="6" height="2.4" rx="1.2" transform="rotate(60 21 15)"/>';
    case 'ribbons':
      return arrangement === 0
        ? '<path d="M-2 22L22 -2M18 42L42 18" stroke-width="5" fill="none"/><path d="M-2 34L34 -2M6 42L42 6" stroke-width="1.2" fill="none"/>'
        : '<path d="M-2 18L18 -2M22 42L42 22" stroke-width="5" fill="none"/><path d="M0 42L42 0" stroke-width="1.2" fill="none"/>';
    case 'line':
      return arrangement === 0
        ? '<path d="M0 20C7 10 13 10 20 20S33 30 40 20" stroke-width="1.6" fill="none"/>'
        : '<path d="M0 14C7 4 13 4 20 14S33 24 40 14M0 34C7 24 13 24 20 34S33 44 40 34" stroke-width="1.2" fill="none"/>';
    case 'stripes':
      return arrangement === 0
        ? '<path d="M-2 10h44M-2 30h44" stroke-width="6" fill="none"/>'
        : '<path d="M10 -2v44M30 -2v44" stroke-width="3" fill="none"/>';
  }
}

/** The pattern as an SVG document string (one repeatable tile). */
export function coverPatternSvg(choice: CoverPatternChoice): string {
  const px = PATTERN_TILE_SIZES[choice.size];
  const body = shapes(choice.family, choice.arrangement);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 40 40" ` +
    `fill="${PATTERN_INK}" stroke="${PATTERN_INK}" stroke-linecap="round" opacity="${PATTERN_OPACITY}">${body}</svg>`
  );
}

/**
 * The CSS `background` layers for a cover without a photo: the pattern over
 * the gradient the caller passes in.
 */
export function coverBackground(
  gradient: string,
  kind: string | null | undefined,
  name: string
): string {
  const choice = chooseCoverPattern(kind, name);
  const px = PATTERN_TILE_SIZES[choice.size];
  const off = PATTERN_OFFSETS[choice.offset];
  // Base64 (the SVG is plain ASCII), not percent-encoded text: the SVG namespace
  // contains "2000", which a page's markup must not show as the yearly
  // placeholder year (YEARLY_PLACEHOLDER_YEAR).
  const uri = `url("data:image/svg+xml;base64,${btoa(coverPatternSvg(choice))}")`;
  return `${uri} ${off}px ${off}px / ${px}px ${px}px repeat, ${gradient}`;
}
