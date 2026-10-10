import Link from 'next/link';
import Icon from '@/components/Icon';
import type { Reservation } from './types';

/** Where a card's list is: its page, by slug, or by id while it has none. */
export const listPath = (r: Reservation) => `/wishlists/${r.wishlistSlug ?? r.wishlistId}`;

/**
 * The list a card's reservation is on: a link while the gifter can open it,
 * else its name alone.
 */
export default function ListName({ r }: { r: Reservation }) {
  if (r.listOpen) {
    return (
      <Link
        href={listPath(r)}
        className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-accent hover:underline"
      >
        <Icon name="gift" size={12} />
        <span className="truncate">{r.wishlistName}</span>
      </Link>
    );
  }
  // A link would only lead to "not available": the card's note says that
  // instead ("This list is no longer available to you", or archived).
  return (
    <span className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-muted-foreground">
      <Icon name="gift" size={12} />
      <span className="truncate">{r.wishlistName}</span>
    </span>
  );
}
