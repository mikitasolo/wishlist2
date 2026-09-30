import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import WishlistMember from '@/models/WishlistMember';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { getOwnerAccess } from '@/lib/utils/wishlistAccess';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';
import { releaseUserBookings } from '@/lib/utils/wishlistOwnership';
import { cancelPendingInvites } from '@/lib/utils/wishlistInvites';

const notOwnerError = () =>
  NextResponse.json(
    { success: false, error: 'Unauthorized - Owner access required' },
    { status: 403 }
  );

// DELETE /api/wishlists/[id]/members/[memberId] - Remove a member from a wishlist.
//
// There's no PATCH here: membership carries no role. The only move up is to
// co-owner, which needs the member's consent and lives at
// POST /api/wishlists/[id]/owners/[userId].
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const session = await auth();
    const { id: idParam, memberId } = await params;
    const id = await resolveWishlistId(idParam);
    if (!id) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    await connectDB();

    const { isOwner, wishlist } = await getOwnerAccess(id, session.user.id);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }
    if (!isOwner) return notOwnerError();

    const membership = await WishlistMember.findById(memberId);
    if (!membership) {
      return NextResponse.json({ success: false, error: 'Membership not found' }, { status: 404 });
    }

    // Verify membership belongs to this wishlist
    if (membership.wishlist.toString() !== id) {
      return NextResponse.json({ success: false, error: 'Membership not found' }, { status: 404 });
    }

    const membershipUserId = membership.user.toString();

    // Defensive: owners aren't memberships — removing one goes through
    // /owners/[userId], which also guards the last-owner case.
    if (isWishlistOwner(wishlist, membershipUserId)) {
      return NextResponse.json(
        { success: false, error: 'This person is an owner — remove them in the owners list' },
        { status: 400 }
      );
    }

    // Prevent removing yourself
    if (membershipUserId === session.user.id) {
      return NextResponse.json(
        { success: false, error: 'Cannot remove yourself. Leave the wishlist instead.' },
        { status: 400 }
      );
    }

    // The access check above ran against the list as it was read at the start of
    // the request. Re-read it right before the first change: a co-owner may have
    // removed the caller since (or deleted the list), and someone who no longer
    // owns the list can't take anyone off it. This narrows the race to the gap
    // before the next write rather than closing it: the writes below are on other
    // collections, so none of them can carry the ownership check itself.
    const current = await getOwnerAccess(id, session.user.id);
    if (!current.wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }
    if (!current.isOwner) return notOwnerError();

    // Free the items they had booked. Their durable reservations survive, so they
    // can still log a gift they went on to give.
    await releaseUserBookings(id, membershipUserId);

    // Remove membership
    await WishlistMember.findByIdAndDelete(memberId);

    // Otherwise accepting a leftover invite would bring them straight back.
    await cancelPendingInvites(id, membershipUserId);

    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    console.error('Error removing member:', error);
    return NextResponse.json({ success: false, error: 'Failed to remove member' }, { status: 500 });
  }
}
