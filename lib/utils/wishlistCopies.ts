/**
 * The server's records of "Start a new list from this one" requests (WIS-325,
 * `models/WishlistCopy.ts`): finishing, taking back and sweeping them.
 */
import mongoose from 'mongoose';
import Item from '@/models/Item';
import Wishlist from '@/models/Wishlist';
import WishlistCopy from '@/models/WishlistCopy';
import { deleteOwnBlobs } from '@/lib/utils/blob';
import { deleteOwnedWishlist } from '@/lib/utils/wishlistDeletion';
import { COPY_STALE_MS } from '@/lib/utils/wishlistCopy';

/** How long a finished copy's row answers retries. */
export const FINISHED_COPY_TTL_MS = 24 * 60 * 60 * 1000;

type Id = string | mongoose.Types.ObjectId;

/** Marks a copy finished: from now on a retry is answered with its list. */
export async function finishCopy(copyId: Id): Promise<void> {
  await WishlistCopy.updateOne(
    { _id: copyId },
    { $set: { done: true, expiresAt: new Date(Date.now() + FINISHED_COPY_TTL_MS) } }
  );
}

/**
 * Takes back a copy that won't be finished: its list if it got that far
 * (through the list delete, so anything attached goes too), the items written
 * for it, every image recorded as copied for it, then its row. Read afresh, so
 * images recorded since the caller read the row are freed too. Each step is
 * safe to run twice, so a sweep and an undo crossing do no harm.
 */
export async function takeBackCopy(copyId: Id, userId: string): Promise<void> {
  const row = await WishlistCopy.findById(copyId).lean();
  if (!row) return;
  const listId = row.wishlist.toString();
  if (await Wishlist.exists({ _id: listId })) await deleteOwnedWishlist(listId, userId);
  await Item.deleteMany({ wishlist: listId });
  await deleteOwnBlobs(row.copiedUrls);
  await WishlistCopy.deleteOne({ _id: row._id });
}

/**
 * Settles a copy whose attempt is over: finished if its list was written (only
 * the last mark failed), else taken back. Returns which.
 */
export async function settleCopy(copyId: Id, userId: string): Promise<'finished' | 'taken back'> {
  const row = await WishlistCopy.findById(copyId).select('wishlist').lean();
  if (row && (await Wishlist.exists({ _id: row.wishlist }))) {
    await finishCopy(copyId);
    return 'finished';
  }
  await takeBackCopy(copyId, userId);
  return 'taken back';
}

/** Whether an unfinished copy's attempt must be over (past the route's `maxDuration`). */
export function isStaleCopy(row: { createdAt: Date }, now = Date.now()): boolean {
  return now - row.createdAt.getTime() >= COPY_STALE_MS;
}

/**
 * Settles every unfinished copy of `userId` whose attempt must be over, so one
 * that died (a killed function, whose key the dialog has since dropped) never
 * leaves its items and images behind for long: run at the start of their next
 * copy.
 */
export async function settleStaleCopies(userId: string): Promise<void> {
  const stale = await WishlistCopy.find({
    user: userId,
    done: false,
    createdAt: { $lte: new Date(Date.now() - COPY_STALE_MS) },
  })
    .select('_id')
    .lean();
  for (const { _id } of stale) await settleCopy(_id, userId);
}
