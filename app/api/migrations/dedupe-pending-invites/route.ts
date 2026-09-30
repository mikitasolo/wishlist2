import mongoose from 'mongoose';
import WishlistInvite from '@/models/WishlistInvite';
import { createMigration } from '@/lib/utils/migration';

/**
 * POST /api/migrations/dedupe-pending-invites
 *
 * Makes way for the unique partial index on `WishlistInvite { wishlist, invitedUser }`
 * (`status: 'pending'`), then builds it. Before that index, two concurrent invites
 * could both pass the "already pending?" check and leave one person with two
 * pending invites to the same list — and the index can't be built while any such
 * pair exists. So, in this order:
 *
 *   1. keep the newest pending invite per (wishlist, invitedUser) — latest
 *      `createdAt`, tie-broken on `_id` — and delete the others. Accepted and
 *      declined rows are never touched; they sit outside the index.
 *   2. build the index here (`WishlistInvite.createIndexes()`), so it exists when
 *      this returns instead of whenever autoIndex next gets to it.
 *
 * Why build it here: `lib/mongodb.ts` leaves Mongoose's `autoIndex` at its default
 * (on), so each cold start sends `createIndex` for every schema index. On a
 * collection that still holds duplicates, that build fails with E11000 — quietly:
 * Mongoose catches its own automatic `Model.init()`, so the error only reaches the
 * model's `'index'` event, which nothing listens to. It never throws into a
 * request, and the model's other indexes still build. Where there are no
 * duplicates, autoIndex will already have built it and step 2 is a no-op.
 *
 * **Run after the deploy** — this route ships with the index definition and the
 * code that relies on it. The gap is safe: until the index exists,
 * `issueWishlistInvite`'s `findOne` pre-check keeps the old behaviour (no new
 * duplicate except under a true race, which this cleans up).
 *
 * Idempotent: once every pair is down to one pending invite and the index exists,
 * a re-run deletes nothing and `createIndexes()` leaves the existing index alone.
 * A failed index build rejects, so a success response means the index is in place.
 *
 * Delete this route and its test in a follow-up once it has run on every environment.
 */

interface Pair {
  wishlist: mongoose.Types.ObjectId;
  invitedUser: mongoose.Types.ObjectId;
}

export const POST = createMigration(async () => {
  // Only the pairs that actually have duplicates — a count per pair, no sort.
  const duplicates = await WishlistInvite.aggregate<{ _id: Pair }>([
    { $match: { status: 'pending' } },
    {
      $group: {
        _id: { wishlist: '$wishlist', invitedUser: '$invitedUser' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  let invitesDeleted = 0;
  for (const { _id: pair } of duplicates) {
    const pending = { wishlist: pair.wishlist, invitedUser: pair.invitedUser, status: 'pending' };
    const newest = await WishlistInvite.findOne(pending)
      .sort({ createdAt: -1, _id: -1 })
      .select('_id')
      .lean();
    if (!newest) continue; // answered since the count
    // Still filtered on `pending`, so an invite answered mid-run is never deleted.
    const { deletedCount } = await WishlistInvite.deleteMany({
      ...pending,
      _id: { $ne: newest._id },
    });
    invitesDeleted += deletedCount;
  }

  await WishlistInvite.createIndexes();

  return { duplicatePairs: duplicates.length, invitesDeleted };
});
