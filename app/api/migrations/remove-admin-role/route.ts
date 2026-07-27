import mongoose from 'mongoose';
import Wishlist from '@/models/Wishlist';
import WishlistInvite from '@/models/WishlistInvite';
import WishlistMember from '@/models/WishlistMember';
import { createMigration } from '@/lib/utils/migration';
import { addWishlistOwner } from '@/lib/utils/wishlistOwnership';

/**
 * POST /api/migrations/remove-admin-role
 *
 * Retires the per-wishlist `admin` role. An admin was a manager of someone else's
 * list — a relationship the product doesn't need: anyone trusted to manage a list
 * is a co-owner of it. So every admin becomes an owner:
 *
 *   WishlistMember{role:'admin'}  → Wishlist.owners += user, membership row deleted
 *   WishlistInvite{role:'admin'}  → role:'owner'  (still pending — they consent by accepting)
 *   WishlistMember.role           → unset on the remaining plain members
 *
 * Promotion runs through `addWishlistOwner`, so it carries the full side effects:
 * the items that person had booked are freed and their reservations on that list
 * are cancelled. Owners are booking-blind, so a booking they can no longer see
 * must not survive — this is the same path an accepted owner invite takes.
 *
 * No invite for the existing admins: they already held management rights, so this
 * is a rename of what they have, not a new grant.
 *
 * **Not backward compatible — run only after the deploy.** The previous code
 * authorizes admins from `WishlistMember.role`; once these rows move to `owners`,
 * that code stops recognizing them (they'd get 403s until the new code is live).
 *
 * Idempotent: with no admin rows and no admin invites left, a re-run is a no-op.
 */
export const POST = createMigration(async () => {
  // `role` is gone from the schema, so query and read it through the raw collection.
  const admins = await WishlistMember.collection
    .find<{ _id: mongoose.Types.ObjectId; wishlist: mongoose.Types.ObjectId; user: unknown }>({
      role: 'admin',
    })
    .toArray();

  let promoted = 0;
  let unbookedItems = 0;
  let cancelledReservations = 0;
  let orphaned = 0;

  for (const row of admins) {
    const wishlist = await Wishlist.findById(row.wishlist).select(
      'owners owner featuredBy featured'
    );
    if (!wishlist) {
      // The wishlist is gone; the stale membership row goes with it.
      await WishlistMember.collection.deleteOne({ _id: row._id });
      orphaned++;
      continue;
    }

    // Deletes the membership row, backfills `owners` on pre-migration rows, and
    // releases the bookings/reservations they held as a gifter.
    const released = await addWishlistOwner(wishlist, String(row.user));
    unbookedItems += released.unbookedItems;
    cancelledReservations += released.cancelledReservations;
    promoted++;
  }

  // Pending admin invites become owner invites: same intent ("help me run this
  // list"), and the invitee still has to accept, so nothing is granted silently.
  const invites = await WishlistInvite.collection.updateMany(
    { role: 'admin', status: 'pending' },
    { $set: { role: 'owner' } }
  );

  // Drop the now-meaningless role from every remaining membership row.
  const cleared = await WishlistMember.collection.updateMany(
    { role: { $exists: true } },
    { $unset: { role: '' } }
  );

  return {
    adminsFound: admins.length,
    promoted,
    orphanedMembershipsRemoved: orphaned,
    unbookedItems,
    cancelledReservations,
    pendingInvitesConverted: invites.modifiedCount ?? 0,
    memberRoleFieldsCleared: cleared.modifiedCount ?? 0,
  };
});
