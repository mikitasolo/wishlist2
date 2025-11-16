import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist, { IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';

// Helper function to check if user has owner access
async function checkOwnerAccess(
  wishlistId: string,
  userId: string
): Promise<{ hasAccess: boolean; wishlist?: IWishlist }> {
  await connectDB();

  const wishlist = await Wishlist.findById(wishlistId);
  if (!wishlist) {
    return { hasAccess: false };
  }

  // Only owner has access
  return { hasAccess: wishlist.owner.toString() === userId, wishlist };
}

// Helper function to unbook all items for a user in a wishlist
async function unbookAllItemsForUser(wishlistId: string, userId: string): Promise<void> {
  await connectDB();

  // Find all items in this wishlist booked by the user
  await Item.updateMany(
    {
      wishlist: wishlistId,
      bookedBy: userId,
      status: 'booked',
    },
    {
      $set: {
        status: 'available',
        bookedBy: null,
      },
    }
  );
}

// DELETE /api/wishlists/[id]/members/[memberId] - Remove member from wishlist
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const { id, memberId } = await params;

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    await connectDB();

    const { hasAccess } = await checkOwnerAccess(id, session.user.id);
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Owner access required' },
        { status: 403 }
      );
    }

    const membership = await WishlistMember.findById(memberId);
    if (!membership) {
      return NextResponse.json({ success: false, error: 'Membership not found' }, { status: 404 });
    }

    // Verify membership belongs to this wishlist
    if (membership.wishlist.toString() !== id) {
      return NextResponse.json({ success: false, error: 'Membership not found' }, { status: 404 });
    }

    const membershipUserId = membership.user.toString();

    // Prevent removing yourself (owners should use leave endpoint)
    if (membershipUserId === session.user.id) {
      return NextResponse.json(
        { success: false, error: 'Cannot remove yourself. Leave the wishlist instead.' },
        { status: 400 }
      );
    }

    // Remove all bookings by this user
    await unbookAllItemsForUser(id, membershipUserId);

    // Remove membership
    await WishlistMember.findByIdAndDelete(memberId);

    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    console.error('Error removing member:', error);
    return NextResponse.json({ success: false, error: 'Failed to remove member' }, { status: 500 });
  }
}
