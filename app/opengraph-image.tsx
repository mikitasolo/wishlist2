import { siteCard } from '@/lib/og/cards';
import { renderCardPng } from '@/lib/og/render';
import { OG_CARD_SIZE } from '@/lib/utils/og';

// Default share card for pages without their own (e.g. the home page). No DB or
// network work, so it's drawn once at build time and can never time out.
export const alt = 'Wishlist — share lists and gift without spoilers';
export const size = OG_CARD_SIZE;
export const contentType = 'image/png';

export default async function Image() {
  return new Response(await renderCardPng(siteCard()), {
    headers: { 'Content-Type': 'image/png' },
  });
}
