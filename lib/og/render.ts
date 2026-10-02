import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { ImageResponse } from 'next/og';
import { errorKind } from '@/lib/utils/errorKind';
import { OG_CARD_SIZE } from '@/lib/utils/og';
import { CARD_FONT } from './cards';

type CardFont = { name: string; data: Buffer; weight: 400 | 700; style: 'normal' };

// next/og bundles only Geist Regular, so a card's bold text would come out
// regular. Ours ship Regular and Bold (OFL, lib/og/fonts/OFL.txt), which cover
// Latin and Cyrillic, so names in either never wait on a font download.
// next.config.js traces the folder into every share card's bundle.
const FONT_DIR = join(process.cwd(), 'lib', 'og', 'fonts');

let fonts: Promise<CardFont[]> | null = null;

function loadFonts(): Promise<CardFont[]> {
  fonts ??= Promise.all([
    readFile(join(FONT_DIR, 'Geist-Regular.ttf')),
    readFile(join(FONT_DIR, 'Geist-Bold.ttf')),
  ])
    .then(([regular, bold]): CardFont[] => [
      { name: CARD_FONT, data: regular, weight: 400, style: 'normal' },
      { name: CARD_FONT, data: bold, weight: 700, style: 'normal' },
    ])
    .catch((err) => {
      fonts = null; // don't cache the failure: the next card tries again
      throw err;
    });
  return fonts;
}

/**
 * Draw a card to a 1200×630 PNG, all the way, before anything is sent: a card
 * that fails to draw can still be answered with another one, and the caller can
 * check its data is still current before deciding how long the CDN keeps it.
 * Without our fonts it still draws, in next/og's own (regular-only) Geist.
 */
export async function renderCardPng(element: ReactElement): Promise<ArrayBuffer> {
  let cardFonts: CardFont[] | undefined;
  try {
    cardFonts = await loadFonts();
  } catch (err) {
    console.error('Share card fonts failed to load, using the default font:', errorKind(err));
  }
  return new ImageResponse(element, { ...OG_CARD_SIZE, fonts: cardFonts }).arrayBuffer();
}

export type CardImage = { body: ArrayBuffer | Buffer; contentType: 'image/jpeg' | 'image/png' };

/**
 * A card as a JPEG, which is what a list's and a profile's card are served as.
 * next/og only draws PNGs, and a PNG of a photo runs to megabytes (WhatsApp, for
 * one, drops a preview image much over 300 KB), while the same card as a JPEG is
 * a tenth of that. If sharp can't load (WIS-156), the PNG goes out instead.
 */
export async function renderCardImage(element: ReactElement): Promise<CardImage> {
  const png = await renderCardPng(element);
  try {
    // Lazily, so a sharp that can't load costs the card its JPEG, never the card.
    const { default: sharp } = await import('sharp');
    const jpeg = await sharp(Buffer.from(png))
      // Full-resolution colour keeps the text's edges crisp.
      .jpeg({ quality: 82, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer();
    return { body: jpeg, contentType: 'image/jpeg' };
  } catch (err) {
    console.error('Share card JPEG encode failed, sending the PNG:', errorKind(err));
    return { body: png, contentType: 'image/png' };
  }
}
