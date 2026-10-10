import mongoose from 'mongoose';
import Item, { type IItem } from '@/models/Item';
import ItemBatch, { type IItemBatch } from '@/models/ItemBatch';
import type { IWishlist } from '@/models/Wishlist';
import { copyBlobsToUploads, deleteOwnBlobs, isOwnBlob } from '@/lib/utils/blob';
import { deleteItem } from '@/lib/utils/itemActions';
import { remapLinks } from '@/lib/utils/itemLinks';
import { getOwnerAccess } from '@/lib/utils/wishlistAccess';
import { copiedItemFields } from '@/lib/utils/wishlistCopy';
import { BULK_ACTION_STATUSES } from '@/lib/utils/bulkItems';
import { errorKind } from '@/lib/utils/errorKind';

/**
 * Moving an owner's picked items to another list of theirs (WIS-434), the
 * bulk route's `move`. A move is a copy onto the target and a delete here,
 * through the paths those already take: each image is copied into the
 * caller's uploads as `/copy` copies it (never one blob shared by two items),
 * the copies are written with the links among the moved items remapped onto
 * them (`remapLinks`), and each moved item is then deleted by `deleteItem`,
 * so it ends its group gifts, unlinks the items it leaves behind, frees its
 * image (only now, once the copy has landed) and leaves every gifter's
 * `Reservation` as any delete does. A reservation can't follow an item: the
 * target has other members. The copies start unreserved.
 *
 * Owners are booking-blind, and so is a move: which items it takes is decided
 * by status with `booked` counted as `available`, and nothing it answers or
 * skips depends on a booking.
 */

/** How long a move spends copying images before it gives up on the rest. */
export const MOVE_IMAGES_BUDGET_MS = 20_000;

/**
 * How long after it starts a move stops deleting moved items: any left then
 * stay where they are (`failed`), their copies taken back. Keeps a move well
 * inside the route's 60 s `maxDuration` and the page's 45 s
 * `BULK_REQUEST_TIMEOUT_MS`, so it's never killed between a copy and a delete.
 */
export const MOVE_DEADLINE_MS = 35_000;

/** How many moved items are deleted from their list at once. */
const MOVE_CONCURRENCY = 4;

/**
 * Whether `target` is a list `userId` may move items to from `sourceId`: one
 * they own, that isn't archived, and isn't the list itself. Every other case
 * gets the same `false` (and the route one answer), so it says nothing about
 * a list that isn't theirs.
 */
export function isMoveTarget(
  access: { isOwner: boolean; wishlist?: Pick<IWishlist, '_id' | 'archived'> },
  sourceId: string
): boolean {
  return (
    !!access.wishlist &&
    access.isOwner &&
    !access.wishlist.archived &&
    access.wishlist._id.toString() !== sourceId
  );
}

type Kind = 'done' | 'skipped' | 'gone' | 'failed';

export type BulkMoveOutcome =
  | {
      /** The re-check after the copies were written refused the move; they're taken back. */
      refused: 'source gone' | 'not owner' | 'target';
    }
  | {
      kinds: Map<string, Kind>;
      /** The items left as they were (not in a status a move takes). */
      skipped: Map<string, IItem>;
    };

/**
 * Take back one copy a move wrote: deleted as any item is (`deleteItem`), so a
 * reservation or group gift a target member made on it meanwhile ends as a
 * delete ends it, its links go and its image (the copy's own) is freed.
 * Best-effort and safe to run twice: a copy already gone is left at that.
 */
async function takeBackCopy(copyId: mongoose.Types.ObjectId, userId: string): Promise<void> {
  try {
    const copy = await Item.findById(copyId);
    if (!copy) return;
    await deleteItem({
      item: copy,
      wishlist: { _id: copy.wishlist },
      isOwner: true,
      userId,
      expectsProposal: false,
      purgeShareCard: false,
    });
  } catch (err) {
    console.error(`Taking back a moved item's copy failed (${errorKind(err)})`);
  }
}

/**
 * Settle a move whose attempt is over without finishing (it died, or the
 * re-check refused it): each copy whose item is still on its list is taken
 * back, a copy whose item is gone stays (that item was moved), and every
 * image the attempt copied that no kept copy holds is freed. Safe to run
 * twice.
 */
export async function settleDeadMove(
  row: Pick<IItemBatch, 'moves' | 'copiedUrls'>,
  userId: string
): Promise<void> {
  const moves = row.moves ?? [];
  const kept = new Set<string>();
  if (moves.length) {
    const ids = moves.flatMap((m) => [m.from, m.to]);
    const there = new Set(
      (
        await Item.find({ _id: { $in: ids } })
          .select('_id')
          .lean()
      ).map((i) => i._id.toString())
    );
    for (const move of moves) {
      if (there.has(move.from.toString())) await takeBackCopy(move.to, userId);
      else if (there.has(move.to.toString()) && move.imageUrl) kept.add(move.imageUrl);
    }
  }
  await deleteOwnBlobs((row.copiedUrls ?? []).filter((url) => !kept.has(url)));
}

/**
 * Move `itemIds` from `source` to the list `targetId`, both already checked as
 * the caller's (`getOwnerAccess`, `isMoveTarget`). `batchId` is the request's
 * claimed `ItemBatch` row, where the copies are recorded before they're
 * written. Never throws for one item: one whose image can't be copied, or
 * whose delete fails, stays where it was (`failed`), its copy taken back.
 */
export async function applyBulkMove({
  source,
  targetId,
  userId,
  itemIds,
  batchId,
}: {
  source: Pick<IWishlist, '_id'>;
  targetId: string;
  userId: string;
  itemIds: readonly string[];
  batchId: IItemBatch['_id'];
}): Promise<BulkMoveOutcome> {
  const sourceId = source._id.toString();
  const deadline = Date.now() + MOVE_DEADLINE_MS;
  const kinds = new Map<string, Kind>();
  const skipped = new Map<string, IItem>();

  // Only the list's own items: an id from another list is answered as gone,
  // exactly as a deleted one. Oldest first, so the copies keep their order.
  const found = await Item.find({ _id: { $in: itemIds }, wishlist: source._id }).sort({
    createdAt: 1,
    _id: 1,
  });
  const byId = new Map(found.map((item) => [item._id.toString(), item]));
  const applies = BULK_ACTION_STATUSES.move;
  for (const id of itemIds) {
    const item = byId.get(id);
    if (!item) kinds.set(id, 'gone');
    else if (!applies.includes(item.status)) {
      kinds.set(id, 'skipped');
      skipped.set(id, item);
    }
  }
  const moving = found.filter((item) => !kinds.has(item._id.toString()));
  if (!moving.length) return { kinds, skipped };

  // Each image of ours is copied into the caller's uploads before anything is
  // written; one that can't be (quota, failure, out of time) keeps its item
  // where it is, rather than moving it without its picture. An external URL
  // goes as it is: we never delete those.
  const toCopy = moving.filter((item) => isOwnBlob(item.imageUrl));
  const copied = await copyBlobsToUploads(
    toCopy.map((item) => item.imageUrl as string),
    userId,
    MOVE_IMAGES_BUDGET_MS,
    async (url) => {
      await ItemBatch.updateOne({ _id: batchId }, { $push: { copiedUrls: url } });
    }
  );
  const images = new Map<string, string>();
  toCopy.forEach((item, k) => {
    const copy = copied[k];
    if (copy.ok) images.set(item._id.toString(), copy.url);
    else kinds.set(item._id.toString(), 'failed');
  });
  const going = moving.filter((item) => !kinds.has(item._id.toString()));
  if (!going.length) return { kinds, skipped };

  // The copies' ids are picked here, so each can name its partners' copies in
  // the same write, and recorded on the batch before the write, so an attempt
  // that dies part-way can be settled (`settleDeadMove`).
  const copyIds = new Map(
    going.map((item) => [item._id.toString(), new mongoose.Types.ObjectId()])
  );
  const links = remapLinks(going, copyIds);
  const moves = going.map((item) => {
    const id = item._id.toString();
    return { from: item._id, to: copyIds.get(id)!, imageUrl: images.get(id) };
  });
  await ItemBatch.updateOne({ _id: batchId }, { $set: { moves } });

  const takeBackAll = async () => {
    const row = await ItemBatch.findById(batchId).select('moves copiedUrls').lean();
    await settleDeadMove(row ?? { moves, copiedUrls: [...images.values()] }, userId);
  };

  // Stamped over the milliseconds before now, in the order they were added,
  // so they land together at the top of a newest-first list.
  const base = Date.now() - going.length;
  try {
    await Item.insertMany(
      going.map((item, i) => {
        const id = item._id.toString();
        return {
          _id: copyIds.get(id),
          wishlist: targetId,
          // Unreserved: the target's members start afresh with it.
          ...copiedItemFields(item),
          imageUrl: images.get(id) ?? (isOwnBlob(item.imageUrl) ? undefined : item.imageUrl),
          relatedItems: links.get(id) ?? [],
          createdAt: new Date(base + i),
          updatedAt: new Date(base + i),
        };
      }),
      { ordered: true }
    );
  } catch (err) {
    await takeBackAll();
    throw err;
  }

  // Both lists were the caller's when the request started. Re-read them now
  // the copies are written: a caller taken off either (or a list deleted, or
  // the target archived) meanwhile gets the copies taken back, nothing here
  // deleted, and the answer the route gives up front.
  let after, afterTarget;
  try {
    [after, afterTarget] = await Promise.all([
      getOwnerAccess(sourceId, userId),
      getOwnerAccess(targetId, userId),
    ]);
  } catch (err) {
    await takeBackAll();
    throw err;
  }
  const refused = !after.wishlist
    ? 'source gone'
    : !after.isOwner
      ? 'not owner'
      : !isMoveTarget(afterTarget, sourceId)
        ? 'target'
        : null;
  if (refused) {
    await takeBackAll();
    return { refused };
  }

  // Each moved item is deleted here as a single delete would be. One that
  // can't be (another owner deleted it first, a failure) has its copy taken
  // back, unless the delete went through before failing: then it's moved.
  const deleteOne = async (item: IItem) => {
    const id = item._id.toString();
    if (Date.now() >= deadline) {
      kinds.set(id, 'failed');
      await takeBackCopy(copyIds.get(id)!, userId);
      return;
    }
    let kind: Kind;
    try {
      const deleted = await deleteItem({
        item,
        wishlist: source,
        isOwner: true,
        userId,
        expectsProposal: false,
        purgeShareCard: false,
      });
      kind = deleted.ok ? 'done' : deleted.status === 404 ? 'gone' : 'failed';
    } catch (err) {
      console.error('A bulk item move failed:', errorKind(err));
      // Moved if the delete went through before failing. Unknown (the read
      // fails too): the copy stays, as an item on two lists beats one lost.
      const stillHere = await Item.exists({ _id: item._id }).then(Boolean, () => null);
      kind = stillHere === false ? 'done' : 'failed';
      if (stillHere === null) {
        kinds.set(id, kind);
        return;
      }
    }
    kinds.set(id, kind);
    if (kind !== 'done') await takeBackCopy(copyIds.get(id)!, userId);
  };
  let next = 0;
  const runNext = async () => {
    while (next < going.length) await deleteOne(going[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(MOVE_CONCURRENCY, going.length) }, runNext));
  return { kinds, skipped };
}
