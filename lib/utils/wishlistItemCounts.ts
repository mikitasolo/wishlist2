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
