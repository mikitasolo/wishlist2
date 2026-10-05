import { shareLinkShareCard } from '@/lib/og/shareCards';
import { OG_CARD_SIZE } from '@/lib/utils/og';

// A share link's card (WIS-336, lib/og/shareCards.ts): the list a live link
// opens, whatever its visibility; a dead link gets a missing list's card. Node
// runtime (the default): it reads with Mongoose and converts the banner with
// sharp.
export const alt = 'A wishlist on Wishlist';
export const size = OG_CARD_SIZE;
// JPEG: a card with a photo would be megabytes as a PNG (lib/og/render.ts).
export const contentType = 'image/jpeg';

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return shareLinkShareCard(token);
}
