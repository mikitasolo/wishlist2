/**
 * The meta line of a list's compact row on a phone (`WishlistRow`): who owns
 * it, when that's worth saying, then its items, e.g. "@ben_carter · 8 items"
 * on a list shared with you, or "12 items · 2 drafts" on one of your own.
 *
 * Pure, so the wording is tested without rendering a row.
 */

import { publicDisplayName } from '@/lib/utils/displayName';
import { formatItemCount, formatOwnerItemSummary } from '@/lib/utils/itemCounts';

/** What a row's meta line is made from: the fields `GET /api/wishlists` sends. */
export interface RowMetaList {
  /** Every owner's id, in the list's owner order (the primary first). */
  owners?: readonly unknown[] | null;
  /** The primary owner's username (null when they have none). */
  ownerUsername?: string | null;
  /** Every owner's username, in the list's owner order; owners without one are left out. */
  ownerUsernames?: readonly string[] | null;
  /** Published items (`lib/utils/itemCounts.ts`). */
  itemCount?: number;
  /** Drafts and proposals to review: only ever sent on a list the viewer owns. */
  draftCount?: number;
  proposalCount?: number;
}

/** A user as another user may see them: "@username", else their public name ("Someone"). */
function shownName(username: string | null | undefined): string {
  return username ? `@${username}` : publicDisplayName({ username });
}

/** How many owners a list has: its `owners`, else the usernames it was sent with. */
function ownerCount(list: RowMetaList): number {
  return Math.max(1, list.owners?.length ?? list.ownerUsernames?.length ?? 1);
}

/**
 * Who a row (or a card) names. On someone else's list (`shared`), its primary
 * owner, plus how many co-owners it has ("@dan_w +1"). On your own list, only
 * the co-owners you share it with ("with @ben_carter"), and nothing on a list
 * that's yours alone. Never an email: a user without a username is named by
 * `publicDisplayName`.
 *
 * Your co-owners are told from you by id (`viewerId` against `owners`), never
 * by username, which can change under a page that's open. A co-owner's
 * username is matched to their id only when every owner has one, since
 * `ownerUsernames` leaves out those who don't; otherwise the first co-owner is
 * named "Someone".
 */
export function rowOwnerLabel(
  list: RowMetaList,
  { shared, viewerId }: { shared: boolean; viewerId?: string | null }
): string | null {
  const others = ownerCount(list) - 1;
  if (shared) {
    const primary = shownName(list.ownerUsername);
    return others > 0 ? `${primary} +${others}` : primary;
  }
  if (others === 0) return null;
  const ids = (list.owners ?? []).map(String);
  const usernames = list.ownerUsernames ?? [];
  const at = ids.findIndex((id) => id !== viewerId);
  const coOwner = usernames.length === ids.length && at >= 0 ? usernames[at] : null;
  const rest = others - 1;
  return `with ${shownName(coOwner)}${rest > 0 ? ` +${rest}` : ''}`;
}

/**
 * The whole meta line: the owner label, then "N items" (published items), with
 * the drafts and proposals to review on your own list, as its card shows them.
 * Nothing about reservations: an owner's row is booking-blind like every count.
 */
export function rowMeta(
  list: RowMetaList,
  options: { shared: boolean; viewerId?: string | null }
): string {
  const items = options.shared
    ? formatItemCount(list.itemCount ?? 0)
    : formatOwnerItemSummary({
        items: list.itemCount ?? 0,
        drafts: list.draftCount ?? 0,
        proposals: list.proposalCount ?? 0,
      });
  const owner = rowOwnerLabel(list, options);
  return owner ? `${owner} · ${items}` : items;
}
