import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import User from '@/models/User';
import { inviteMemberSchema, validateRequestBody } from '@/lib/validations';
import { areFriends } from '@/lib/utils/friends';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { getOwnerAccess } from '@/lib/utils/wishlistAccess';
import { isWishlistOwner, ownerIds } from '@/lib/utils/wishlistOwners';
import { issueWishlistInvite } from '@/lib/utils/wishlistInvites';
import { publicDisplayName } from '@/lib/utils/displayName';

const notOwnerError = () =>
  NextResponse.json(
    { success: false, error: 'Unauthorized - Owner access required' },
    { status: 403 }
  );

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

    // Only owners can view the members list
    const { isOwner, wishlist } = await getOwnerAccess(id, session.user.id);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }
    if (!isOwner) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Owner access required' },
        { status: 403 }
      );
    }

    // Owners live in `wishlist.owners`, never in WishlistMember, so fetch them
    // separately. Rows are keyed by the *user* id (they have no membership row) —
    // that's what the owners endpoints take as their [userId] segment.
    const ownerUserIds = ownerIds(wishlist);
    const ownerUsers = await User.find({ _id: { $in: ownerUserIds } }).select('username image');
    const ownerById = new Map(ownerUsers.map((u) => [u._id.toString(), u]));

    // Everyone else on the list — membership carries no role. An owner can still
    // hold a spare membership row that a failed demotion or promotion left behind
    // (see `removeWishlistOwner`). It's skipped, so they're listed once, as an
    // owner, and not again as a member whose "Make owner" and "Remove" both refuse.
    // A read doesn't delete it: if that ownership pull did land, the row is all
    // they have. A retried demotion reuses it; removal or leaving deletes it.
    const allMembers = await WishlistMember.find({ wishlist: id, user: { $nin: ownerUserIds } })
      .sort({ createdAt: -1 })
      .lean();

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
          role: 'member' as const,
          createdAt: member.createdAt,
          updatedAt: member.updatedAt,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    // Owners come first, in `owners` order (so [0] is the creator).
    const ownerRows = ownerUserIds
      .map((id) => ownerById.get(id))
      .filter((u): u is NonNullable<typeof u> => !!u)
      .map((user) => ({
        _id: user._id,
        wishlist: wishlist._id,
        user,
        role: 'owner' as const,
        createdAt: wishlist.createdAt,
        updatedAt: wishlist.updatedAt,
      }));

    return NextResponse.json(
      { success: true, data: [...ownerRows, ...membersWithUsers] },
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

    // Throttle invites so one actor can't flood others' invitation/notification lists.
    const limited = await enforce('invite', userKey(session.user.id));
    if (limited) return limited;

    await connectDB();

    const { isOwner, wishlist } = await getOwnerAccess(id, session.user.id);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }
    if (!isOwner) return notOwnerError();

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

    // Can't invite an existing owner.
    if (isWishlistOwner(wishlist, invitedUser._id.toString())) {
      return NextResponse.json(
        { success: false, error: 'This person already owns this wishlist' },
        { status: 400 }
      );
    }
    // Someone already on the list is promoted, not re-invited — that path is
    // POST /owners/[userId], so it can be driven from the members UI.
    const existingMember = await WishlistMember.findOne({ wishlist: id, user: invitedUser._id });
    if (existingMember) {
      return NextResponse.json(
        {
          success: false,
          error:
            role === 'owner'
              ? 'This person is already a member — promote them from the members list'
              : 'This person is already a member',
        },
        { status: 400 }
      );
    }

    // The owner check above ran against the list as it was read at the start of
    // the request. Re-read it right before the invite is issued: a co-owner may
    // have removed the caller since (or deleted the list), and someone who no
    // longer owns the list can't invite anyone to it. Like the kick's re-read,
    // this narrows the race rather than closing it: the invite lives on another
    // collection, so it can't carry the ownership check itself.
    const current = await getOwnerAccess(id, session.user.id);
    if (!current.wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }
    if (!current.isOwner) return notOwnerError();

    // Create a pending invite (membership/ownership is granted only on accept),
    // and notify the invitee at their account email — fetched here, never stored
    // on the invite.
    const invite = await issueWishlistInvite({
      wishlistId: id,
      wishlistName: wishlist.name,
      role,
      invitedBy: session.user.id,
      inviterName: publicDisplayName(session.user),
      actorUsername: session.user.username ?? null,
      invitedUserId: invitedUser._id,
      invitedUserEmail: invitedUser.email,
    });

    if (!invite) {
      return NextResponse.json(
        { success: false, error: 'This person already has a pending invite' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { success: true, data: { _id: invite._id, status: invite.status, role: invite.role } },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error inviting member:', error);
    return NextResponse.json({ success: false, error: 'Failed to invite member' }, { status: 500 });
  }
}
