/**
 * "Save to my list": saving a copy of an item you can see into one of your own
 * lists. The copy is a new, independent item (a snapshot of the source's name,
 * price, link and image, never its notes, flag, status or booking). Nothing on
 * it points back at the source, and the source's owners aren't told.
 *
 * Pure, so the wishlist page (which offers the action) and
 * `POST /api/wishlists/[id]/items` (which checks it) share one rule.
 */

/** The fields of an item that decide whether a viewer may copy it. */
interface CopyableItem {
  status: string;
  proposedBy?: { toString(): string } | string | null;
}

/**
 * May `viewerId` save a copy of `item`, given they can see the list it's on?
 *
 * Drafts never: they're their owners' unpublished work, so even an owner copies
 * an item only once it's published. A proposal only by its proposer: anyone
 * else seeing it is one of the list's owners, reviewing it.
 */
export function canCopyItem(item: CopyableItem, viewerId: string | null | undefined): boolean {
  if (!viewerId) return false;
  if (item.status === 'draft') return false;
  if (item.status === 'proposed') return !!item.proposedBy && String(item.proposedBy) === viewerId;
  return true;
}

/** Sent back with the saved copy when its image couldn't be copied for lack of quota. */
export const COPY_IMAGE_QUOTA_NOTICE =
  'Saved without the image: your upload space is full. Delete or replace some images to free up space.';

/** Sent back with the saved copy when copying its image failed for any other reason. */
export const COPY_IMAGE_FAILED_NOTICE =
  "Saved without the image: it couldn't be copied. You can add one by editing the item.";

/**
 * A member's Release on the list, said with Undo before it's sent (WIS-387).
 * Undone, the toast goes with it, so it never claims a reservation went that
 * stayed.
 */
export const RELEASED_TOAST = 'Released';
