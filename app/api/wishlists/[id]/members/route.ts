import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist, { IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import User from '@/models/User';
import { sendWishlistInvitationEmail } from '@/lib/email';
import { inviteMemberSchema, validateRequestBody } from '@/lib/validations';

// Helper function to check if user has admin or owner access
async function checkAdminOrOwnerAccess(
  wishlistId: string,
  userId: string
): Promise<{ hasAccess: boolean; wishlist?: IWishlist }> {
  await connectDB();

  const wishlist = await Wishlist.findById(wishlistId);
  if (!wishlist) {
    return { hasAccess: false };
  }

  // Owner always has access
  if (wishlist.owner.toString() === userId) {
    return { hasAccess: true, wishlist };
  }

  // Check if user is admin
  const membership = await WishlistMember.findOne({
    wishlist: wishlistId,
    user: userId,
    role: 'admin',
  });

  return { hasAccess: !!membership, wishlist };
}

// GET /api/wishlists/[id]/members - Get all members of a wishlist
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const { id } = await params;

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    await connectDB();

    // Only admins and owners can view members list
    const { hasAccess } = await checkAdminOrOwnerAccess(id, session.user.id);
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Admin or owner access required' },
        { status: 403 }
      );
    }

    const wishlist = await Wishlist.findById(id);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }

    // Fetch owner separately (owner is stored in wishlist.owner, not in WishlistMember)
    const owner = await User.findById(wishlist.owner);
    if (!owner) {
      return NextResponse.json(
        { success: false, error: 'Wishlist owner not found' },
        { status: 404 }
      );
    }

    // Get all members from WishlistMember (only 'admin' and 'member' roles)
    const allMembers = await WishlistMember.find({ wishlist: id }).sort({ createdAt: -1 }).lean();

    // Fetch user details for all members
    const memberUserIds = allMembers.map((m) => m.user);
    const memberUsers = await User.find({
      _id: { $in: memberUserIds },
    }).select('email');

    const userMap = new Map(memberUsers.map((u) => [u._id.toString(), u]));

    // Process all members from WishlistMember
    const membersWithUsers = allMembers
      .map((member) => {
        const user = userMap.get(member.user.toString());
        if (!user) return null; // Skip if user not found

        return {
          _id: member._id,
          wishlist: member.wishlist,
          user,
          role: member.role, // 'admin' or 'member'
          createdAt: member.createdAt,
          updatedAt: member.updatedAt,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    // Always add original owner at the beginning (owner is never in WishlistMember)
    const ownerMember = {
      _id: owner._id,
      wishlist: wishlist._id,
      user: owner,
      role: 'owner' as const,
      createdAt: wishlist.createdAt,
      updatedAt: wishlist.updatedAt,
    };

    return NextResponse.json(
      { success: true, data: [ownerMember, ...membersWithUsers] },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error fetching members:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch members' }, { status: 500 });
  }
}

// POST /api/wishlists/[id]/members - Invite a user to a wishlist
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    const { id } = await params;

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    await connectDB();

    const { hasAccess, wishlist } = await checkAdminOrOwnerAccess(id, session.user.id);
    if (!hasAccess || !wishlist) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Admin or owner access required' },
        { status: 403 }
      );
    }

    // Validate request body
    const validation = await validateRequestBody(request, inviteMemberSchema);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: validation.status }
      );
    }

    const { email, role = 'member' } = validation.data;

    // Find or create user
    let invitedUser = await User.findOne({ email: email.toLowerCase() });
    if (!invitedUser) {
      // Create user account (they'll need to verify email)
      invitedUser = await User.create({
        email: email.toLowerCase(),
      });
    }

    // Prevent inviting owner (they're already the owner)
    if (wishlist.owner.toString() === invitedUser._id.toString()) {
      return NextResponse.json(
        { success: false, error: 'User is already the owner of this wishlist' },
        { status: 400 }
      );
    }

    // Check if user is already a member
    const existingMember = await WishlistMember.findOne({
      wishlist: id,
      user: invitedUser._id,
    });

    if (existingMember) {
      return NextResponse.json(
        { success: false, error: 'User is already a member of this wishlist' },
        { status: 400 }
      );
    }

    // Create membership with specified role
    const membership = await WishlistMember.create({
      wishlist: id,
      user: invitedUser._id,
      role,
    });

    // Send invitation email
    await sendWishlistInvitationEmail(email, wishlist.name, session.user.email, id);

    // Fetch user details for response
    const membershipUser = await User.findById(membership.user).select('email');

    const responseData = {
      ...membership.toObject(),
      user: membershipUser || membership.user,
    };

    return NextResponse.json({ success: true, data: responseData }, { status: 201 });
  } catch (error) {
    console.error('Error inviting member:', error);
    return NextResponse.json({ success: false, error: 'Failed to invite member' }, { status: 500 });
  }
}
