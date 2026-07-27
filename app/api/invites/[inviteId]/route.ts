import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import { createNotification } from '@/lib/notifications';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';
import { addWishlistOwner } from '@/lib/utils/wishlistOwnership';

// PATCH /api/invites/[inviteId] - accept or decline a pending invite (invitee).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ inviteId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { inviteId } = await params;
    const body = await request.json().catch(() => ({}));
    const action = body?.action;
    if (action !== 'accept' && action !== 'decline') {
      return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
    }

    await connectDB();

    const invite = await WishlistInvite.findById(inviteId);
    if (!invite || invite.status !== 'pending') {
      return NextResponse.json({ success: false, error: 'Invite not found' }, { status: 404 });
    }

    // Verify the invite is addressed to this user's account.
    if (invite.invitedUser?.toString() !== session.user.id) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (action === 'decline') {
      invite.status = 'declined';
      await invite.save();
      return NextResponse.json({ success: true, data: { status: 'declined' } }, { status: 200 });
    }

    // Accept: grant the invited role (unless already an owner), then mark accepted.
    const wishlist = await Wishlist.findById(invite.wishlist).select(
      'owners owner featuredBy featured slug name'
    );
    if (!wishlist) {
      invite.status = 'declined';
      await invite.save();
      return NextResponse.json(
        { success: false, error: 'This wishlist no longer exists' },
        { status: 404 }
      );
    }

    // This is where co-ownership is actually granted — the consent step. Becoming
    // an owner releases every booking the invitee held here and cancels their
    // reservations: an owner can never see, cancel, or receive their own booking.
    let released = { unbookedItems: 0, cancelledReservations: 0 };
    if (!isWishlistOwner(wishlist, session.user.id)) {
      if (invite.role === 'owner') {
        released = await addWishlistOwner(wishlist, session.user.id);
      } else {
        // Membership carries no role, so joining twice is a no-op.
        await WishlistMember.findOneAndUpdate(
          { wishlist: invite.wishlist, user: session.user.id },
          { $set: { wishlist: invite.wishlist, user: session.user.id } },
          { upsert: true }
        );
      }
    }

    invite.status = 'accepted';
    await invite.save();

    // Let the inviter know their invitation was accepted.
    await createNotification({
      user: invite.invitedBy,
      type: 'invite_accepted',
      actorUsername: session.user.username ?? null,
      wishlist: invite.wishlist,
      wishlistName: wishlist.name,
      wishlistSlug: wishlist.slug ?? null,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          status: 'accepted',
          role: invite.role,
          wishlistSlug: wishlist.slug ?? null,
          wishlistId: invite.wishlist.toString(),
          releasedBookings: released.unbookedItems,
          cancelledReservations: released.cancelledReservations,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error responding to invite:', error);
    return NextResponse.json({ success: false, error: 'Failed to update invite' }, { status: 500 });
  }
}
