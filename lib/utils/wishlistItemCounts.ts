import type mongoose from 'mongoose';
import Item from '@/models/Item';
import { NO_ITEMS, PUBLISHED_ITEM_STATUSES, type ItemCounts } from '@/lib/utils/itemCounts';

/**
 * Each list's item counts, by the one rule in `lib/utils/itemCounts.ts`, in one
 * aggregation. A list with no items is absent from the map: read it through
 * `countsFor`, which answers zeros for it.
 *
 * Every read that returns a list's count goes through this (the share card,
 * which counts one list, through `PUBLISHED_ITEM_STATUSES`), so no two screens
 * can count one list differently. `drafts` and `proposals` are for an owner's own
 * lists only: a caller hands them to nobody else.
 */
export async function countWishlistItems(
  // ObjectIds, not strings: an aggregation doesn't cast like a query does, so a
  // string id would match nothing.
  wishlistIds: mongoose.Types.ObjectId[]
): Promise<Map<string, ItemCounts>> {
  if (wishlistIds.length === 0) return new Map();
  const rows = await Item.aggregate<{ _id: mongoose.Types.ObjectId } & ItemCounts>([
    { $match: { wishlist: { $in: wishlistIds } } },
    {
      $group: {
        _id: '$wishlist',
        items: { $sum: { $cond: [{ $in: ['$status', [...PUBLISHED_ITEM_STATUSES]] }, 1, 0] } },
        drafts: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
        proposals: { $sum: { $cond: [{ $eq: ['$status', 'proposed'] }, 1, 0] } },
      },
    },
  ]);
  return new Map(
    rows.map((r) => [
      r._id.toString(),
      { items: r.items, drafts: r.drafts, proposals: r.proposals },
    ])
  );
}

/** One list's counts from `countWishlistItems`' map. */
export function countsFor(
  counts: Map<string, ItemCounts>,
  wishlistId: mongoose.Types.ObjectId | string
): ItemCounts {
  return counts.get(wishlistId.toString()) ?? { ...NO_ITEMS };
}

/**
 * How many items `gifterId` has reserved on each of these lists (status
 * `booked`, `bookedBy` them), in one aggregation: the "2 reserved by you" on
 * the card of a list shared with them. A list where they hold none is absent
 * from the map.
 *
 * Their own bookings only, and for the gifter alone: never ask it for a list
 * the caller owns (owners never see booking status, and no count of
 * reservations ever goes to an owner), and never count anyone else's.
 */
export async function countReservedBy(
  wishlistIds: mongoose.Types.ObjectId[],
  // An ObjectId, as above: the aggregation doesn't cast a string.
  gifterId: mongoose.Types.ObjectId
): Promise<Map<string, number>> {
  if (wishlistIds.length === 0) return new Map();
  const rows = await Item.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
    { $match: { wishlist: { $in: wishlistIds }, status: 'booked', bookedBy: gifterId } },
    { $group: { _id: '$wishlist', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.count]));
}
