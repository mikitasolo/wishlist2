import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import { validateRequestBody } from '@/lib/validations';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { isAdminOrOwner } from '@/lib/utils/wishlistAccess';
import { z } from 'zod';

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

const updateMemberRoleSchema = z.object({
  role: z.enum(['admin', 'member']),
});

// PATCH /api/wishlists/[id]/members/[memberId] - Update member role
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
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

    const hasAccess = await isAdminOrOwner(id, session.user.id);
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Admin or owner access required' },
        { status: 403 }
      );
    }

    // Validate request body
    const validation = await validateRequestBody(request, updateMemberRoleSchema);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: validation.status }
      );
    }

    const { role } = validation.data;

    const membership = await WishlistMember.findById(memberId);
    if (!membership) {
      return NextResponse.json({ success: false, error: 'Membership not found' }, { status: 404 });
    }

    // Verify membership belongs to this wishlist
    if (membership.wishlist.toString() !== id) {
      return NextResponse.json({ success: false, error: 'Membership not found' }, { status: 404 });
    }

    // Prevent changing role of original owner (they're always owner, not in WishlistMember)
    const wishlist = await Wishlist.findById(id);
    if (wishlist && wishlist.owner.toString() === membership.user.toString()) {
      return NextResponse.json(
        { success: false, error: 'Cannot change role of the original wishlist owner' },
        { status: 400 }
      );
    }

    // Update membership role (only 'admin' or 'member' allowed)
    membership.role = role;
    await membership.save();

    // Fetch user details for response
    const User = (await import('@/models/User')).default;
    const membershipUser = await User.findById(membership.user).select('email');

    const responseData = {
      ...membership.toObject(),
      user: membershipUser || membership.user,
    };

    return NextResponse.json({ success: true, data: responseData }, { status: 200 });
  } catch (error) {
    console.error('Error updating member role:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update member role' },
      { status: 500 }
    );
  }
}

// DELETE /api/wishlists/[id]/members/[memberId] - Remove member from wishlist
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
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

    const hasAccess = await isAdminOrOwner(id, session.user.id);
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Admin or owner access required' },
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

    // Prevent deleting the original owner (they're not in WishlistMember, but defensive check)
    const wishlist = await Wishlist.findById(id);
    if (wishlist && wishlist.owner.toString() === membership.user.toString()) {
      return NextResponse.json(
        { success: false, error: 'Cannot remove the original wishlist owner' },
        { status: 400 }
      );
    }

    const membershipUserId = membership.user.toString();

    // Prevent removing yourself
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
