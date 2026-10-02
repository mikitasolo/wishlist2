import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';
import { getOwnerAccess } from '@/lib/utils/wishlistAccess';
import {
  isLastOwner,
  releaseLateBookings,
  releaseUserBookings,
  removeWishlistOwner,
} from '@/lib/utils/wishlistOwnership';
import { cancelPendingInvites } from '@/lib/utils/wishlistInvites';

const onlyOwnerError = () =>
  NextResponse.json(
    { success: false, error: 'You are the only owner. Delete the wishlist instead.' },
    { status: 400 }
  );

const notFoundError = () =>
  NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });

/**
 * The answer for a caller who isn't on the list, or no longer is by the time
 * their request gets there. An archived list is its owners' alone, so anyone else
 * is answered exactly as for a list that doesn't exist, never with "not a
 * member", which would confirm that it does (see `getOwnerAccess`). The read only
 * picks the answer, and it's a fresh one because the caller's standing may have
 * changed since the request's first read.
 */
async function notOnListError(wishlistId: string, userId: string): Promise<NextResponse> {
  if (!(await getOwnerAccess(wishlistId, userId)).wishlist) return notFoundError();
  return NextResponse.json(
    { success: false, error: 'You are not a member of this wishlist' },
    { status: 404 }
  );
}

// DELETE /api/wishlists/[id]/members/me - Leave a wishlist
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    // Before the list is looked up, so a signed-out caller is told the same
    // whether or not it exists (an archived list's existence is its owners').
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    const { id: idParam } = await params;
    const wishlistId = await resolveWishlistId(idParam);
    if (!wishlistId) return notFoundError();

    await connectDB();

    // Check if wishlist exists
    const wishlist = await Wishlist.findById(wishlistId);
    if (!wishlist) return notFoundError();

    // A co-owner may step down, as long as somebody is left holding the list.
    // The sole owner still can't: there'd be nobody to manage it.
    if (isWishlistOwner(wishlist, session.user.id)) {
      if (isLastOwner(wishlist, session.user.id)) return onlyOwnerError();

      // Leaving means leaving — no membership left behind. Also drops this list
      // from their dashboard pin, since `featuredBy` is per-owner. They act on
      // themselves, so they're the actor too.
      const removal = await removeWishlistOwner(wishlist, session.user.id, {
        actorId: session.user.id,
        keepAsMember: false,
      });
      // A co-owner stepped down at the same moment and got there first, leaving
      // them the only owner — so nothing was changed and nothing is released.
      if (removal === 'last-owner') return onlyOwnerError();
      if (removal === 'removed') {
        const unbookedCount = await releaseUserBookings(wishlistId, session.user.id);
        // Leaving means no way back in through an invite that was already pending.
        await cancelPendingInvites(wishlistId, session.user.id);

        return NextResponse.json(
          { success: true, data: { unbookedItemsCount: unbookedCount, wasOwner: true } },
          { status: 200 }
        );
      }
      // 'actor-not-owner': they stopped being an owner before their write could
      // land (a co-owner removed or demoted them, or their own leave from another
      // tab got there first), and nothing was changed. They're anyone else now, so
      // the request goes on as anyone else's: as a member, which a demotion left
      // them, they leave; otherwise they're told they aren't on the list.
    }

    // Check if user is a member
    const membership = await WishlistMember.findOne({
      wishlist: wishlistId,
      user: session.user.id,
    });
    if (!membership) return await notOnListError(wishlistId, session.user.id);

    // A member may leave an archived list too, as from any other: it only takes
    // their access away, and the list may be unarchived later with them still on it.

    // Free the items they had booked. Their durable reservations survive so they
    // can still log a gift they went on to give.
    const unbookedCount = await releaseUserBookings(wishlistId, session.user.id);

    // Leaving means no way back in through an invite that was already pending.
    // Cancelled before the membership goes and again after it, as a kick does
    // (see `cancelPendingInvites`).
    await cancelPendingInvites(wishlistId, session.user.id);

    const { deletedCount } = await WishlistMember.deleteOne({ _id: membership._id });
    if (!deletedCount) {
      // A concurrent request took the row first: another leave, a kick, or their
      // own accept of a promotion. This request didn't take them off the list.
      return await notOnListError(wishlistId, session.user.id);
    }

    // And free their items once more, now that they're off the list, for a
    // booking that checked their membership before the delete.
    const lateCount = await releaseLateBookings(wishlistId, session.user.id);

    await cancelPendingInvites(wishlistId, session.user.id);

    return NextResponse.json(
      {
        success: true,
        data: { unbookedItemsCount: unbookedCount + lateCount },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error leaving wishlist:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to leave wishlist' },
      { status: 500 }
    );
  }
}
