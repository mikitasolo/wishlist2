import mongoose from 'mongoose';
import connectDB from '@/lib/mongodb';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import Wishlist, { IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { ownedByFilter, ownerIds } from '@/lib/utils/wishlistOwners';

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
    Reservation.deleteMany({ wishlist: wishlistId, gifter: userId }),
  ]);

  return {
    unbookedItems: items.modifiedCount ?? 0,
    cancelledReservations: reservations.deletedCount ?? 0,
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
 */
export async function addWishlistOwner(
  wishlist: WishlistShape,
  userId: string
): Promise<{ unbookedItems: number; cancelledReservations: number }> {
  await connectDB();

  const wishlistId = wishlist._id.toString();
  await Wishlist.updateOne(
    { _id: wishlistId },
    { $addToSet: { owners: new mongoose.Types.ObjectId(userId) } }
  );
  await WishlistMember.deleteMany({ wishlist: wishlistId, user: userId });

  return releaseHoldingsForRole(wishlistId, userId, 'owner');
}

/**
 * Remove a user from a wishlist's owners.
 *
 * `keepAsMember` demotes them to a plain member; otherwise they're off the list
 * entirely (leaving or being removed). Either way they lose their dashboard pin
 * for this list — `featuredBy` is per-owner, so a non-owner must not keep a list
 * pinned as their profile hero.
 *
 * Refuses to remove the *last* owner, which would leave the wishlist unreachable,
 * and returns `false` having changed nothing — callers must then stop before any
 * follow-on side effect (freeing bookings, and so on). The refusal is enforced by
 * the write itself, not by `wishlist`: that's a copy read earlier, and two
 * co-owners stepping down at once would each see the other still there. Callers
 * still pre-check `isLastOwner` for the common case.
 *
 * `false` also covers a user who stopped being an owner since `wishlist` was read
 * (a concurrent request already removed them): with the list as it now stands,
 * there's nobody left to remove.
 */
export async function removeWishlistOwner(
  wishlist: WishlistShape,
  userId: string,
  keepAsMember: boolean
): Promise<boolean> {
  await connectDB();

  const wishlistId = wishlist._id.toString();
  const uid = new mongoose.Types.ObjectId(userId);
  // One conditional write: only matches while they're an owner *and* a second
  // owner exists (`owners.1`), so of two racing removals on a two-owner list,
  // exactly one lands. The schema's non-empty `owners` validator doesn't run on
  // `updateOne`, so this filter is the only thing holding the invariant.
  const { modifiedCount } = await Wishlist.updateOne(
    { _id: wishlistId, ...ownedByFilter(userId), 'owners.1': { $exists: true } },
    { $pull: { owners: uid, featuredBy: uid } }
  );
  if (modifiedCount === 0) return false;

  if (keepAsMember) {
    await WishlistMember.findOneAndUpdate(
      { wishlist: wishlistId, user: userId },
      { $set: { wishlist: wishlistId, user: userId } },
      { upsert: true }
    );
  } else {
    await WishlistMember.deleteMany({ wishlist: wishlistId, user: userId });
  }
  return true;
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
