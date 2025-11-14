import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';

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

// DELETE /api/wishlists/[id]/members/me - Leave a wishlist
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const { id: wishlistId } = await params;

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
      return NextResponse.json(
        { success: false, error: 'Wishlist not found' },
        { status: 404 }
      );
    }

    // Prevent owner from leaving (they should delete the wishlist instead)
    if (wishlist.owner.toString() === session.user.id) {
      return NextResponse.json(
        { success: false, error: 'Owner cannot leave wishlist. Delete the wishlist instead.' },
        { status: 400 }
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

    // Remove all bookings by this user
    await unbookAllItemsForUser(wishlistId, session.user.id);

    // Remove membership
    await WishlistMember.findByIdAndDelete(membership._id);

    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    console.error('Error leaving wishlist:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to leave wishlist' },
      { status: 500 }
    );
  }
}

