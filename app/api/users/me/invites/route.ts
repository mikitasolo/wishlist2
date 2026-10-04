import mongoose from 'mongoose';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistInvite from '@/models/WishlistInvite';
import Reservation from '@/models/Reservation';
import User from '@/models/User';
import { isInvitePaused } from '@/lib/utils/wishlistInvites';
import { getWishlistViewAccess } from '@/lib/utils/wishlistAccess';
import { countReservedBy, countWishlistItems, countsFor } from '@/lib/utils/wishlistItemCounts';
import type { Occasion } from '@/lib/utils/occasion';

/**
 * GET /api/users/me/invites - pending wishlist invites addressed to the current
 * user's account, except paused ones (see `isInvitePaused`).
 *
 * Each says which list, who invited them and as what. What's on the list (its
 * `preview`: banner, occasion, item count) comes only when the invitee could
 * already open it (`getWishlistViewAccess` for them), so an invite never shows
 * more of a list than they could see without it; otherwise `preview` is null
 * (WIS-273).
 *
 * An owner invite also carries `yourReservations`: how many Reservations the
 * invitee holds on that list, which accepting it ends (`addWishlistOwner`'s
 * `cancelledReservations`, the count the accept toast reports). It's the
 * caller's own, about their own bookings, so it may go back to them; it's never
 * on a member invite, which releases nothing. With it goes `holdsBookings`:
 * whether any item there is still booked by them, which accepting frees too,
 * even with no Reservation left (a gift they've marked as given).
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;
    await connectDB();

    const invites = await WishlistInvite.find({
      status: 'pending',
      invitedUser: userId,
    })
      .sort({ createdAt: -1 })
      .lean();

    const wishlists = await Wishlist.find({
      _id: { $in: invites.map((i) => i.wishlist) },
    })
      .select('name slug archived owners visibility bannerUrl occasion')
      .lean();
    const wlMap = new Map(wishlists.map((w) => [w._id.toString(), w]));

    const inviters = await User.find({
      _id: { $in: invites.map((i) => i.invitedBy) },
    }).select('username image');
    const invMap = new Map(inviters.map((u) => [u._id.toString(), u]));

    const shown = invites.flatMap((invite) => {
      const wishlist = wlMap.get(invite.wishlist.toString());
      if (!wishlist) return []; // wishlist was deleted
      // A member invite to an archived list waits, still pending, until the list
      // is unarchived: accepting it now would only answer 404.
      if (isInvitePaused(invite, wishlist)) return [];
      return [{ invite, wishlist }];
    });

    // Whether the invitee could open each list already: only then may the card
    // show what's on it.
    const viewable = new Set<string>();
    await Promise.all(
      shown.map(async ({ wishlist }) => {
        const access = await getWishlistViewAccess(wishlist, userId);
        if (access.allowed) viewable.add(wishlist._id.toString());
      })
    );
    const itemCounts = await countWishlistItems(
      wishlists.filter((w) => viewable.has(w._id.toString())).map((w) => w._id)
    );

    // The caller's own holdings, on the lists they're invited to co-own only:
    // their Reservations, and the items still booked by them (a gift marked as
    // given keeps its booking but no longer has a Reservation), all of which
    // accepting releases.
    const gifter = new mongoose.Types.ObjectId(userId);
    const ownerListIds = shown
      .filter(({ invite }) => invite.role === 'owner')
      .map(({ wishlist }) => wishlist._id);
    const [reservations, bookings] = await Promise.all([
      countReservationsOf(gifter, ownerListIds),
      countReservedBy(ownerListIds, gifter),
    ]);

    const data = shown.map(({ invite, wishlist }) => {
      const id = wishlist._id.toString();
      const inviter = invMap.get(invite.invitedBy.toString());
      return {
        _id: invite._id.toString(),
        role: invite.role,
        wishlistId: id,
        wishlistName: wishlist.name,
        wishlistSlug: wishlist.slug ?? null,
        invitedByUsername: inviter?.username ?? null,
        invitedByImage: inviter?.image ?? null,
        createdAt: invite.createdAt,
        preview: viewable.has(id)
          ? {
              bannerUrl: wishlist.bannerUrl ?? null,
              occasion: plainOccasion(wishlist.occasion),
              itemCount: countsFor(itemCounts, id).items,
            }
          : null,
        ...(invite.role === 'owner'
          ? {
              yourReservations: reservations.get(id) ?? 0,
              holdsBookings: (bookings.get(id) ?? 0) > 0,
            }
          : {}),
      };
    });

    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error) {
    console.error('Error listing my invites:', error);
    return NextResponse.json({ success: false, error: 'Failed to load invites' }, { status: 500 });
  }
}

/** How many Reservations `gifter` holds on each of these lists; a list with none is absent. */
async function countReservationsOf(
  // ObjectIds: an aggregation doesn't cast a string.
  gifter: mongoose.Types.ObjectId,
  wishlistIds: mongoose.Types.ObjectId[]
): Promise<Map<string, number>> {
  if (wishlistIds.length === 0) return new Map();
  const rows = await Reservation.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
    { $match: { gifter, wishlist: { $in: wishlistIds } } },
    { $group: { _id: '$wishlist', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [r._id.toString(), r.count]));
}

/** A stored occasion as plain JSON, or null when the list has none. */
function plainOccasion(occasion: Occasion | null | undefined): Occasion | null {
  if (!occasion) return null;
  return { kind: occasion.kind, date: occasion.date, recurrence: occasion.recurrence ?? null };
}
