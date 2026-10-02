import { wishlistShareCard } from '@/lib/og/shareCards';
import { OG_CARD_SIZE } from '@/lib/utils/og';

// A list's share card (lib/og/shareCards.ts). Runs on the Node runtime (the
// default) because it reads the list with Mongoose and converts its banner
// with sharp. Only a list a signed-out visitor could open is named on it.
export const alt = 'A wishlist on Wishlist';
export const size = OG_CARD_SIZE;
// JPEG: a card with a photo would be megabytes as a PNG (lib/og/render.ts).
export const contentType = 'image/jpeg';

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return wishlistShareCard(id);
}
