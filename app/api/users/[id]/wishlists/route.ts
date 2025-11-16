import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import User from '@/models/User';

// GET /api/users/[id]/wishlists - Get wishlists for a specific user
// Returns: public wishlists + wishlists the current user has access to
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const { id: userId } = await params;

    await connectDB();

    // Check if target user exists
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    // Get all public wishlists owned by this user (always visible)
    const publicWishlists = await Wishlist.find({
      owner: userId,
      isPublic: true,
    });

    // Get private wishlists the current user has access to (if authenticated)
    let privateWishlists: typeof publicWishlists = [];
    if (session?.user) {
      const currentUserId = session.user.id;

      // Get all memberships for the current user
      const memberships = await WishlistMember.find({
        user: currentUserId,
      });
      const wishlistIds = memberships.map((m) => m.wishlist.toString());

      // Get private wishlists owned by target user where current user is a member
      privateWishlists = await Wishlist.find({
        _id: { $in: wishlistIds },
        owner: userId,
        isPublic: false,
      });
    }

    // Merge: public wishlists + accessible private wishlists
    const allWishlists = [...publicWishlists, ...privateWishlists];
    const uniqueWishlists = Array.from(
      new Map(allWishlists.map((w) => [w._id.toString(), w])).values()
    );

    // Get membership information for current user (if authenticated)
    let membershipMap = new Map<string, boolean>();
    if (session?.user) {
      const currentUserId = session.user.id;
      const memberships = await WishlistMember.find({
        user: currentUserId,
        wishlist: { $in: uniqueWishlists.map((w) => w._id) },
      });
      memberships.forEach((m) => {
        membershipMap.set(m.wishlist.toString(), true);
      });
    }

    // Get owner emails for all wishlists
    const ownerIds = uniqueWishlists.map((w) => w.owner.toString());
    const owners = await User.find({ _id: { $in: ownerIds } }).select('email');
    const ownerMap = new Map(owners.map((o) => [o._id.toString(), o.email]));

    // Add membership status and owner email to each wishlist
    const wishlistsWithMembership = uniqueWishlists.map((wishlist) => ({
      ...wishlist.toObject(),
      isMember: membershipMap.get(wishlist._id.toString()) || false,
      ownerEmail: ownerMap.get(wishlist.owner.toString()) || null,
    }));

    // Sort by creation date (newest first)
    wishlistsWithMembership.sort((a, b) => {
      const dateA = a.createdAt?.getTime() || 0;
      const dateB = b.createdAt?.getTime() || 0;
      return dateB - dateA;
    });

    return NextResponse.json({ success: true, data: wishlistsWithMembership }, { status: 200 });
  } catch (error) {
    console.error('Error fetching user wishlists:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch wishlists' },
      { status: 500 }
    );
  }
}
