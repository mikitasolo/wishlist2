import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import { createNotification } from '@/lib/notifications';

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

    // Accept: create the membership (unless already owner/member), then mark accepted.
    const wishlist = await Wishlist.findById(invite.wishlist).select('owner slug name');
    if (!wishlist) {
      invite.status = 'declined';
      await invite.save();
      return NextResponse.json(
        { success: false, error: 'This wishlist no longer exists' },
        { status: 404 }
      );
    }

    if (wishlist.owner.toString() !== session.user.id) {
      const existing = await WishlistMember.findOne({
        wishlist: invite.wishlist,
        user: session.user.id,
      });
      if (!existing) {
        await WishlistMember.create({
          wishlist: invite.wishlist,
          user: session.user.id,
          role: invite.role,
        });
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
          wishlistSlug: wishlist.slug ?? null,
          wishlistId: invite.wishlist.toString(),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error responding to invite:', error);
    return NextResponse.json({ success: false, error: 'Failed to update invite' }, { status: 500 });
  }
}
