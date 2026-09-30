import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';
import {
  isLastOwner,
  releaseUserBookings,
  removeWishlistOwner,
} from '@/lib/utils/wishlistOwnership';

const onlyOwnerError = () =>
  NextResponse.json(
    { success: false, error: 'You are the only owner. Delete the wishlist instead.' },
    { status: 400 }
  );

// DELETE /api/wishlists/[id]/members/me - Leave a wishlist
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const { id: idParam } = await params;
    const wishlistId = await resolveWishlistId(idParam);
    if (!wishlistId) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    await connectDB();

    // Check if wishlist exists
    const wishlist = await Wishlist.findById(wishlistId);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    // A co-owner may step down, as long as somebody is left holding the list.
    // The sole owner still can't: there'd be nobody to manage it.
    if (isWishlistOwner(wishlist, session.user.id)) {
      if (isLastOwner(wishlist, session.user.id)) return onlyOwnerError();

      // Leaving means leaving — no membership left behind. Also drops this list
      // from their dashboard pin, since `featuredBy` is per-owner. `false`: a
      // co-owner stepped down at the same moment and got there first, leaving
      // them the only owner — so nothing was changed and nothing is released.
      if (!(await removeWishlistOwner(wishlist, session.user.id, false))) return onlyOwnerError();
      const unbookedCount = await releaseUserBookings(wishlistId, session.user.id);

      return NextResponse.json(
        { success: true, data: { unbookedItemsCount: unbookedCount, wasOwner: true } },
        { status: 200 }
      );
    }

    // Check if user is a member
    const membership = await WishlistMember.findOne({
      wishlist: wishlistId,
      user: session.user.id,
    });

    if (!membership) {
      return NextResponse.json(
        { success: false, error: 'You are not a member of this wishlist' },
        { status: 404 }
      );
    }

    // Free the items they had booked. Their durable reservations survive so they
    // can still log a gift they went on to give.
    const unbookedCount = await releaseUserBookings(wishlistId, session.user.id);

    if (unbookedCount > 0) {
      console.log(
        `Unbooked ${unbookedCount} item(s) for user ${session.user.id} in wishlist ${wishlistId}`
      );
    }

    // Remove membership
    await WishlistMember.findByIdAndDelete(membership._id);

    return NextResponse.json(
      {
        success: true,
        data: { unbookedItemsCount: unbookedCount },
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
