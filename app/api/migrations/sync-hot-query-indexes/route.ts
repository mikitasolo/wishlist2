import type { Collection } from 'mongoose';
import { createMigration } from '@/lib/utils/migration';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';

/**
 * WIS-377: brings a deployed database's indexes in line with the hot query
 * audit (`test/api/indexAudit.test.ts`).
 *
 *  - Builds `wishlists { visibility: 1, archived: 1 }`, which
 *    `viewableWishlistsFilter` (search, the Booked page) needs to stop scanning
 *    the whole collection. autoIndex builds it on the deploy's first connection
 *    too; this makes sure it's there, and reports a build that failed.
 *  - Drops `wishlistmembers { wishlist: 1 }`: the unique `{ wishlist, user }`
 *    index serves every query by list, so it only cost writes. autoIndex never
 *    drops an index, so it stays until this runs.
 *
 * Idempotent: a re-run finds the first already built and the second already
 * gone, and changes nothing.
 *
 * Deploy order: run **after** the deploy that ships it. A drop before it would
 * be undone: the old code still declares `{ wishlist: 1 }`, so its autoIndex
 * rebuilds it on the next cold start.
 *
 *   curl -X POST -H "X-Migration-Secret: $MIGRATION_SECRET" <host>/api/migrations/sync-hot-query-indexes
 */
export const POST = createMigration(async () => {
  await Wishlist.createIndexes();
  const droppedWishlistMemberIndex = await dropIndexByKey(WishlistMember.collection, {
    wishlist: 1,
  });
  return { wishlistIndexesBuilt: true, droppedWishlistMemberIndex };
});

/**
 * Drops the index on exactly `key` (same fields, same order, same directions),
 * whatever it's named. False when there's none, or no collection yet.
 */
async function dropIndexByKey(
  collection: Collection,
  key: Record<string, 1 | -1>
): Promise<boolean> {
  const wanted = JSON.stringify(Object.entries(key));
  let indexes: Awaited<ReturnType<Collection['indexes']>>;
  try {
    indexes = await collection.indexes();
  } catch (err) {
    // A collection that doesn't exist has no indexes to drop.
    if ((err as { codeName?: string }).codeName === 'NamespaceNotFound') return false;
    throw err;
  }
  const index = indexes.find((i) => JSON.stringify(Object.entries(i.key)) === wanted);
  if (!index?.name) return false;
  await collection.dropIndex(index.name);
  return true;
}
