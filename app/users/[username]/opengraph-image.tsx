import { profileShareCard } from '@/lib/og/shareCards';
import { OG_CARD_SIZE } from '@/lib/utils/og';

// A profile's share card (lib/og/shareCards.ts): the username and avatar, which
// are always public, and the bio unless the profile is friends-only.
export const alt = 'A profile on Wishlist';
export const size = OG_CARD_SIZE;
// JPEG: a card with a photo would be megabytes as a PNG (lib/og/render.ts).
export const contentType = 'image/jpeg';

export default async function Image({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return profileShareCard(username);
}
