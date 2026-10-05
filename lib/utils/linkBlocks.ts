import type mongoose from 'mongoose';
import WishlistLinkBlock from '@/models/WishlistLinkBlock';
import { errorKind } from '@/lib/utils/errorKind';

type Id = string | mongoose.Types.ObjectId;

/**
 * Keeping people kicked from a list out of its share links (WIS-338). See
 * `models/WishlistLinkBlock.ts` for the rule.
 *
 * - A kick calls `blockFromShareLinks` once its membership delete landed.
 * - Resolving a link for a signed-in viewer asks `isBlockedFromShareLinks` and
 *   answers a blocked one exactly as a dead link (`resolveLinkFor` in
 *   `shareLinkAccess.ts`, and the `/l/[token]` page).
 * - A link join (WIS-337) asks it again **after** its membership upsert and, if
 *   blocked, deletes only the row it created: a join racing a kick never keeps
 *   them on the list.
 * - Accepting a `member` or `owner` invite calls `clearShareLinkBlock`.
 */

/** Keep `userId` out of `wishlistId`'s share links. Idempotent. */
export async function blockFromShareLinks(wishlistId: Id, userId: Id): Promise<void> {
  await WishlistLinkBlock.updateOne(
    { wishlist: wishlistId, user: userId },
    { $setOnInsert: { wishlist: wishlistId, user: userId } },
    { upsert: true }
  ).catch((err: unknown) => {
    // Two kicks at once: the other upsert made the row, which is the point.
    if ((err as { code?: number })?.code === 11000) return;
    throw err;
  });
}

/** Whether `userId` (signed in) is kept out of `wishlistId`'s share links. */
export async function isBlockedFromShareLinks(
  wishlistId: Id,
  userId: Id | null | undefined
): Promise<boolean> {
  if (!userId) return false;
  return !!(await WishlistLinkBlock.exists({ wishlist: wishlistId, user: userId }));
}

/**
 * Let `userId` use `wishlistId`'s share links again: an owner's invite brought
 * them back. Best-effort, after the role is granted: a leftover row only keeps
 * someone already on the list out of links that would send them to its own URL.
 */
export async function clearShareLinkBlock(wishlistId: Id, userId: Id): Promise<void> {
  try {
    await WishlistLinkBlock.deleteOne({ wishlist: wishlistId, user: userId });
  } catch (err) {
    console.error('Share link block cleanup failed:', errorKind(err));
  }
}
