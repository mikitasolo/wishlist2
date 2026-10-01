import mongoose from 'mongoose';
import connectDB from '@/lib/mongodb';
import Item from '@/models/Item';
import { deleteReservations } from '@/lib/utils/reservationSnapshots';
import Wishlist, { IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { ownedByFilter, ownerIds } from '@/lib/utils/wishlistOwners';
import { isOwnerOfWishlist } from '@/lib/utils/wishlistAccess';

/**
 * Changing who owns a wishlist. Ownership is consequential in both directions,
 * so the cleanup lives here rather than being re-derived per route.
 */

/** A loaded wishlist document (or `.lean()` row) these helpers can mutate. */
type WishlistShape = Pick<IWishlist, '_id' | 'owners'> & Pick<Partial<IWishlist>, 'featuredBy'>;

/**
 * Release everything a user holds *as a gifter* on a wishlist, because they are
 * becoming an owner: free the items they booked and delete their reservations.
 *
 * This deliberately goes further than leave/kick, which frees the item but keeps
 * the durable `Reservation` alive so the gifter can still log the gift. An owner
 * can't be a gifter on their own list — they can never see the booking again, so
 * they could never cancel it, and the reservation would name them as its own
 * recipient. Already-logged `GiftLog` history is untouched: that's the past.
 */
export async function releaseGifterHoldings(
  wishlistId: string,
  userId: string
): Promise<{ unbookedItems: number; cancelledReservations: number }> {
  await connectDB();

  const [items, reservations] = await Promise.all([
    Item.updateMany(
      { wishlist: wishlistId, bookedBy: userId, status: 'booked' },
      { $set: { status: 'available', bookedBy: null } }
    ),
    deleteReservations({ wishlist: wishlistId, gifter: userId }),
  ]);

  return {
    unbookedItems: items.modifiedCount ?? 0,
    cancelledReservations: reservations,
  };
}

/**
 * Free the items a user booked on a wishlist without touching their durable
 * reservations — used when they leave or are removed. They keep the ability to
 * mark the gift as given from their reservations page; the list just stops
 * showing the item as claimed.
 */
export async function releaseUserBookings(wishlistId: string, userId: string): Promise<number> {
  await connectDB();
  const result = await Item.updateMany(
    { wishlist: wishlistId, bookedBy: userId, status: 'booked' },
    { $set: { status: 'available', bookedBy: null } }
  );
  return result.modifiedCount ?? 0;
}

/**
 * Settle a user's bookings when their role on a wishlist changes to `role`.
 *
 * A booking can only ever be cancelled by the person holding it, and owners are
 * booking-blind (`booked` folds into `available` for them). So becoming an owner
 * would otherwise strand a booking: they can't see the item to release it, and
 * nobody else can either — it stays claimed forever, invisible to the owners and
 * unbookable by everyone else.
 *
 *   - owner  → free the items *and* delete the reservations. They're now a
 *              recipient of this list; you can't be your own gifter.
 *   - member → nothing. Members see their own bookings and can unbook normally.
 */
export async function releaseHoldingsForRole(
  wishlistId: string,
  userId: string,
  role: 'owner' | 'member'
): Promise<{ unbookedItems: number; cancelledReservations: number }> {
  if (role === 'owner') return releaseGifterHoldings(wishlistId, userId);
  return { unbookedItems: 0, cancelledReservations: 0 };
}

/**
 * Promote a user to owner. Drops any `WishlistMember` row they had (owners live
 * only in `Wishlist.owners`) and resets the bookings they held as a gifter.
 *
 * Consent is the caller's job: promotion always goes through an accepted
 * `WishlistInvite`, never a silent role write — ownership puts the list on the
 * new owner's public profile and destroys their reservations on it.
 *
 * For someone who isn't on the list. Promote a member with `promoteMemberToOwner`,
 * which can't race a kick.
 *
 * Returns `null`, having changed nothing, when the ownership write matched no list:
 * it was deleted since the caller read it. Nothing is released then either. On a
 * deleted list that would only destroy their reservations, which the delete keeps
 * on purpose so they can still log the gift.
 */
export async function addWishlistOwner(
  wishlist: WishlistShape,
  userId: string
): Promise<{ unbookedItems: number; cancelledReservations: number } | null> {
  await connectDB();

  const wishlistId = wishlist._id.toString();
  const { matchedCount } = await Wishlist.updateOne(
    { _id: wishlistId },
    { $addToSet: { owners: new mongoose.Types.ObjectId(userId) } }
  );
  if (matchedCount === 0) return null;
  await WishlistMember.deleteMany({ wishlist: wishlistId, user: userId });

  return releaseHoldingsForRole(wishlistId, userId, 'owner');
}

/**
 * `addWishlistOwner` for a member of the list, who accepted an owner invite:
 * their membership row becomes ownership, or nothing happens.
 *
 * The row is taken first, in one conditional delete, and ownership is granted only
 * if that delete matched. A kick or a member leaving deletes the same row, so of a
 * removal and a promotion racing each other exactly one lands. Without this a kick
 * could land after accept claimed the invite and before it granted the role, and
 * the member the owners had just removed would come back as a co-owner. Returns
 * `null`, having changed nothing, when the row is already gone.
 *
 * Also `null` when the list was deleted after the row was taken, so the ownership
 * write matched nothing. The row stays gone (the delete removes every membership
 * of the list), and nothing is released, as in `addWishlistOwner`.
 *
 * If the ownership write then fails, the row is put back (same id, same join date)
 * before the error propagates, so they aren't left off the list altogether. Not
 * when the write landed after all and only its acknowledgement was lost: they're
 * an owner then, and an owner has no membership row.
 */
export async function promoteMemberToOwner(
  wishlist: WishlistShape,
  userId: string
): Promise<{ unbookedItems: number; cancelledReservations: number } | null> {
  await connectDB();

  const wishlistId = wishlist._id.toString();
  const membership = await WishlistMember.findOneAndDelete({ wishlist: wishlistId, user: userId });
  if (!membership) return null;

  let matchedCount: number;
  try {
    ({ matchedCount } = await Wishlist.updateOne(
      { _id: wishlistId },
      { $addToSet: { owners: new mongoose.Types.ObjectId(userId) } }
    ));
  } catch (err) {
    try {
      if (!(await isOwnerOfWishlist(wishlistId, userId))) {
        await WishlistMember.create({
          _id: membership._id,
          wishlist: membership.wishlist,
          user: membership.user,
          createdAt: membership.createdAt,
        });
      }
    } catch (restoreErr) {
      console.error(
        `Could not restore membership ${membership._id} after a failed promotion:`,
        restoreErr
      );
    }
    throw err;
  }
  if (matchedCount === 0) return null;

  return releaseHoldingsForRole(wishlistId, userId, 'owner');
}

/**
 * How a `removeWishlistOwner` call ended. Anything but `'removed'` changed
 * nothing, and the caller must stop before any follow-on side effect.
 *
 *   - removed         → done.
 *   - actor-not-owner → whoever is acting stopped being an owner since the
 *                       caller checked (a concurrent request removed them), so
 *                       they no longer get to change who owns the list.
 *   - last-owner      → the user is the only owner left. The same write miss
 *                       also covers a user who already stopped being an owner.
 */
export type OwnerRemoval = 'removed' | 'actor-not-owner' | 'last-owner';

/**
 * Remove a user from a wishlist's owners, on the say-so of `actorId`: another
 * owner demoting or removing them, or the user themselves when they leave.
 * Named rather than positional, so the actor can't be swapped with the user.
 *
 * `keepAsMember` demotes them to a plain member; otherwise they're off the list
 * entirely (leaving or being removed). Either way they lose their dashboard pin
 * for this list — `featuredBy` is per-owner, so a non-owner must not keep a list
 * pinned as their profile hero.
 *
 * Refuses to remove the *last* owner, which would leave the wishlist unreachable,
 * and refuses an actor who is no longer an owner, since only owners may change
 * ownership. Both are enforced by the write itself, not by `wishlist`: that's a
 * copy read earlier, so two co-owners stepping down at once would each see the
 * other still there, and two owners removing each other at once would each still
 * see themselves as an owner. Callers still pre-check (`isLastOwner`, and that the
 * caller owns the list) for the common case.
 */
export async function removeWishlistOwner(
  wishlist: WishlistShape,
  userId: string,
  { actorId, keepAsMember }: { actorId: string; keepAsMember: boolean }
): Promise<OwnerRemoval> {
  await connectDB();

  const wishlistId = wishlist._id.toString();
  const uid = new mongoose.Types.ObjectId(userId);
  // One conditional write: only matches while the actor and the user are both
  // owners *and* a second owner exists (`owners.1`). So of two racing removals on
  // a two-owner list exactly one lands, and an owner whom a concurrent request
  // just removed can't go on to remove anyone else. The schema's non-empty
  // `owners` validator doesn't run on `updateOne`, so this filter is the only
  // thing keeping the list an owner.
  const { modifiedCount } = await Wishlist.updateOne(
    {
      _id: wishlistId,
      $and: [ownedByFilter(actorId), ownedByFilter(userId)],
      'owners.1': { $exists: true },
    },
    { $pull: { owners: uid, featuredBy: uid } }
  );
  if (modifiedCount === 0) {
    // The write already refused, so this read only picks the answer. It can be a
    // moment newer than the write; nothing was changed either way.
    return (await isOwnerOfWishlist(wishlistId, actorId)) ? 'last-owner' : 'actor-not-owner';
  }

  if (keepAsMember) {
    await WishlistMember.findOneAndUpdate(
      { wishlist: wishlistId, user: userId },
      { $set: { wishlist: wishlistId, user: userId } },
      { upsert: true }
    );
  } else {
    await WishlistMember.deleteMany({ wishlist: wishlistId, user: userId });
  }
  return 'removed';
}

/**
 * Whether `userId` is the only owner left — the case every removal must refuse.
 * A pre-check against an already-read document, for a clean error on the common
 * path; `removeWishlistOwner` re-enforces it atomically.
 */
export function isLastOwner(wishlist: WishlistShape, userId: string): boolean {
  const owners = ownerIds(wishlist);
  return owners.length <= 1 && owners.includes(userId);
}
