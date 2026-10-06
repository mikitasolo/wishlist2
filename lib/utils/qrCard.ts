import type { OccasionKind } from '@/lib/utils/occasion';

/**
 * A share link's printed card (WIS-346): its sizes, designs, how many fit on a
 * sheet, and how its text is fitted. Measures are millimetres throughout, so a
 * card prints at its true size.
 */

export const QR_CARD_SIZES = ['card', 'postcard', 'a5', 'page'] as const;
export type QrCardSize = (typeof QR_CARD_SIZES)[number];

export interface QrCardSizeSpec {
  label: string;
  /** Width × height in mm, as it sits on the sheet. */
  width: number;
  height: number;
}

export const QR_CARD_SIZE_SPECS: Record<QrCardSize, QrCardSizeSpec> = {
  card: { label: 'Credit card · 85 × 54 mm', width: 85, height: 54 },
  postcard: { label: 'Postcard (A6) · 148 × 105 mm', width: 148, height: 105 },
  a5: { label: 'A5 · 148 × 210 mm', width: 148, height: 210 },
  page: { label: 'Full page', width: 176, height: 240 },
};

/**
 * What a sheet leaves to print on, in mm: A4 (210 × 297) and US Letter
 * (215.9 × 279.4), each less a 12 mm margin a side (browsers default to about
 * 10), whichever is smaller. So a sheet that fits on one fits on both.
 */
export const PRINTABLE_AREA = { width: 186, height: 255 } as const;

/** The gap between cards on a sheet, in mm: room to cut between them. */
export const SHEET_GAP = 5;

/** The columns and rows of `size` cards that fit on one sheet (at least 1 × 1). */
export function sheetGrid(size: QrCardSize): { cols: number; rows: number } {
  const { width, height } = QR_CARD_SIZE_SPECS[size];
  const fit = (room: number, side: number) =>
    Math.max(1, Math.floor((room + SHEET_GAP) / (side + SHEET_GAP)));
  return { cols: fit(PRINTABLE_AREA.width, width), rows: fit(PRINTABLE_AREA.height, height) };
}

/** The most `size` cards one sheet holds. */
export function maxCopiesPerSheet(size: QrCardSize): number {
  const { cols, rows } = sheetGrid(size);
  return cols * rows;
}

/** `copies` held to what a sheet of `size` cards holds (1 at least). */
export function clampCopies(size: QrCardSize, copies: number): number {
  if (!Number.isFinite(copies)) return 1;
  return Math.min(maxCopiesPerSheet(size), Math.max(1, Math.floor(copies)));
}

/** A card image's resolution (WIS-350): sharp in print, and the code scans off a screen. */
export const CARD_PNG_DPI = 300;

/** A `size` card's pixels at `dpi`. */
export function cardPixelSize(
  size: QrCardSize,
  dpi: number = CARD_PNG_DPI
): { width: number; height: number } {
  const { width, height } = QR_CARD_SIZE_SPECS[size];
  return { width: Math.round((width / 25.4) * dpi), height: Math.round((height / 25.4) * dpi) };
}

/** The columns the sheet lays `copies` cards out in: never more than there are cards. */
export function sheetColumns(size: QrCardSize, copies: number): number {
  return Math.min(sheetGrid(size).cols, Math.max(1, copies));
}

export const QR_CARD_DESIGNS = [
  'classic',
  'confetti',
  'ribbon',
  'birthday',
  'wedding',
  'holiday',
] as const;
export type QrCardDesign = (typeof QR_CARD_DESIGNS)[number];

export const QR_CARD_DESIGN_LABELS: Record<QrCardDesign, string> = {
  classic: 'Classic',
  confetti: 'Confetti',
  ribbon: 'Ribbon',
  birthday: 'Birthday',
  wedding: 'Wedding',
  holiday: 'Holiday',
};

/** The design a card starts on: its occasion's own, else Classic. */
export function defaultCardDesign(kind: OccasionKind | null | undefined): QrCardDesign {
  if (kind === 'birthday' || kind === 'wedding' || kind === 'holiday') return kind;
  return 'classic';
}

/**
 * About how wide a character of the sans stack is, in ems, erring wide: a CJK
 * character or an emoji takes a whole em, a capital or a wide letter more than
 * an average one, and a narrow letter or a stop less.
 */
export function charEm(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x1100 && (code <= 0x115f || (code >= 0x2e80 && code <= 0xa4cf) || code >= 0xac00))
    return 1;
  if (/[ilj.,:;'’|!()[\]\s]/.test(ch)) return 0.3;
  if (/[mwMW@]/.test(ch)) return 0.9;
  if (/[A-Z0-9&%#]/.test(ch)) return 0.68;
  return 0.56;
}

/** About how wide `text` is, in ems. */
export function textEm(text: string): number {
  let em = 0;
  for (const ch of text) em += charEm(ch);
  return em;
}

/**
 * `text` broken into at most `maxLines` lines, each at most `widthEm` ems
 * wide: at spaces, a word wider than a line split across lines, and what
 * doesn't fit cut with "…". `fits` says whether it all fitted with no word
 * split.
 */
export function wrapText(
  text: string,
  widthEm: number,
  maxLines: number
): { lines: string[]; fits: boolean } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  let split = false;
  for (const word of words) {
    let rest = word;
    while (rest) {
      const candidate = line ? `${line} ${rest}` : rest;
      if (textEm(candidate) <= widthEm) {
        line = candidate;
        rest = '';
      } else if (line) {
        lines.push(line);
        line = '';
      } else {
        split = true;
        const head = fitChars(rest, widthEm);
        lines.push(head);
        rest = rest.slice(head.length);
      }
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return { lines, fits: !split };
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${fitChars(kept[maxLines - 1], widthEm - charEm('…')).trimEnd()}…`;
  return { lines: kept, fits: false };
}

/** The longest start of `text` (whole characters, at least one) at most `widthEm` wide. */
function fitChars(text: string, widthEm: number): string {
  let out = '';
  let em = 0;
  for (const ch of text) {
    em += charEm(ch);
    if (em > widthEm && out) break;
    out += ch;
  }
  return out;
}

/**
 * The biggest font size, from `max` down to `min` in steps, at which `text`
 * fits `width` in `maxLines` lines without splitting a word; at `min` a long
 * word is split, and the rest cut with "…" if it still doesn't fit.
 */
export function fitText(
  text: string,
  { width, max, min, maxLines }: { width: number; max: number; min: number; maxLines: number }
): { size: number; lines: string[] } {
  const step = Math.max((max - min) / 8, 0.1);
  for (let size = max; size > min; size -= step) {
    const { lines, fits } = wrapText(text, width / size, maxLines);
    if (fits) return { size, lines };
  }
  return { size: min, lines: wrapText(text, width / min, maxLines).lines };
}
