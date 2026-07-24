import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import User from '@/models/User';
import { sendWishlistInvitationEmail } from '@/lib/email';
import { inviteMemberSchema, validateRequestBody } from '@/lib/validations';
import { areFriends } from '@/lib/utils/friends';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { getAdminOrOwnerAccess } from '@/lib/utils/wishlistAccess';

// GET /api/wishlists/[id]/members - Get all members of a wishlist
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    const { id: idParam } = await params;
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

    // Only admins and owners can view members list
    const { hasAccess } = await getAdminOrOwnerAccess(id, session.user.id);
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
    const owner = await User.findById(wishlist.owner).select('username image');
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
    }).select('username image');

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
    const session = await auth();
    const { id: idParam } = await params;
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

    const { hasAccess, wishlist } = await getAdminOrOwnerAccess(id, session.user.id);
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

    const { username, role = 'member' } = validation.data;

    // Invites always target an existing account, resolved by username.
    const invitedUser = await User.findOne({ username }).select('email privacy');
    if (!invitedUser) {
      return NextResponse.json(
        { success: false, error: `No user found with the username @${username}` },
        { status: 404 }
      );
    }

    // Respect the invitee's "who can invite me" preference
    const policy = invitedUser.privacy?.whoCanInvite ?? 'everyone';
    if (policy === 'nobody') {
      return NextResponse.json(
        { success: false, error: 'This person isn’t accepting wishlist invites.' },
        { status: 403 }
      );
    }
    if (policy === 'friends') {
      const friends = await areFriends(session.user.id, invitedUser._id.toString());
      if (!friends) {
        return NextResponse.json(
          { success: false, error: 'This person only accepts invites from friends.' },
          { status: 403 }
        );
      }
    }

    // Can't invite the owner or an existing member.
    if (wishlist.owner.toString() === invitedUser._id.toString()) {
      return NextResponse.json(
        { success: false, error: 'This person already owns this wishlist' },
        { status: 400 }
      );
    }
    const existingMember = await WishlistMember.findOne({ wishlist: id, user: invitedUser._id });
    if (existingMember) {
      return NextResponse.json(
        { success: false, error: 'This person is already a member' },
        { status: 400 }
      );
    }
    const existingInvite = await WishlistInvite.findOne({
      wishlist: id,
      invitedUser: invitedUser._id,
      status: 'pending',
    });
    if (existingInvite) {
      return NextResponse.json(
        { success: false, error: 'This person already has a pending invite' },
        { status: 400 }
      );
    }

    // Create a pending invite (membership is created only when they accept).
    const invite = await WishlistInvite.create({
      wishlist: id,
      invitedBy: session.user.id,
      invitedUser: invitedUser._id,
      role,
    });

    // Notify the invitee at their account email (fetched here, never stored on
    // the invite) with a link to their invites page.
    const inviterName = session.user.username || session.user.email?.split('@')[0] || 'Someone';
    if (invitedUser.email) {
      await sendWishlistInvitationEmail(invitedUser.email, wishlist.name, inviterName);
    }

    return NextResponse.json(
      { success: true, data: { _id: invite._id, status: invite.status } },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error inviting member:', error);
    return NextResponse.json({ success: false, error: 'Failed to invite member' }, { status: 500 });
  }
}
