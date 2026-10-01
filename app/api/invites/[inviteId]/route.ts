import { NextRequest, NextResponse } from 'next/server';
import type mongoose from 'mongoose';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import { createNotification } from '@/lib/notifications';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';
import {
  addWishlistOwner,
  promoteMemberToOwner,
  releaseHoldingsForRole,
} from '@/lib/utils/wishlistOwnership';
import { withdrawInvite } from '@/lib/utils/wishlistInvites';
import { isObjectIdParam } from '@/lib/utils/objectId';

const inviteNotFound = () =>
  NextResponse.json({ success: false, error: 'Invite not found' }, { status: 404 });

/**
 * Record the invitee's answer on a still-pending invite, in one conditional write.
 * This is the claim: of an accept, a decline, an owner cancelling it and a removal
 * cancelling it, whichever write reaches the row first wins, and every later one
 * matches nothing. So nothing may be granted before it. `false` if another got
 * there first.
 */
async function claimInvite(
  inviteId: mongoose.Types.ObjectId,
  answer: 'accepted' | 'declined'
): Promise<boolean> {
  const { modifiedCount } = await WishlistInvite.updateOne(
    { _id: inviteId, status: 'pending' },
    { $set: { status: answer } }
  );
  return modifiedCount === 1;
}

/**
 * Put back an accept's claim when granting the role then failed, so the invitee
 * can try again instead of holding an "accepted" invite that granted nothing.
 * The grant may have got part of the way (ownership landed, bookings not yet
 * released); accepting again finishes it. Best-effort: the request is failing
 * already.
 */
async function releaseClaim(inviteId: mongoose.Types.ObjectId): Promise<void> {
  try {
    await WishlistInvite.updateOne(
      { _id: inviteId, status: 'accepted' },
      { $set: { status: 'pending' } }
    );
  } catch (err) {
    console.error(`Could not reopen invite ${inviteId} after a failed accept:`, err);
  }
}

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

    const invite = isObjectIdParam(inviteId) ? await WishlistInvite.findById(inviteId) : null;
    if (!invite || invite.status !== 'pending') return inviteNotFound();

    // Verify the invite is addressed to this user's account.
    const userId = session.user.id;
    if (invite.invitedUser?.toString() !== userId) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    if (action === 'decline') {
      if (!(await claimInvite(invite._id, 'declined'))) return inviteNotFound();
      return NextResponse.json({ success: true, data: { status: 'declined' } }, { status: 200 });
    }

    // Read before the claim. For the membership the order matters: a kick or a
    // member leaving cancels pending invites before it deletes the membership. So
    // if the membership is here now and the claim below succeeds, no removal has
    // deleted it yet, and `promoteMemberToOwner` settles which of the two lands.
    const [wishlist, membership] = await Promise.all([
      Wishlist.findById(invite.wishlist).select('owners featuredBy slug name'),
      WishlistMember.exists({ wishlist: invite.wishlist, user: userId }),
    ]);
    if (!wishlist) {
      await claimInvite(invite._id, 'declined');
      return NextResponse.json(
        { success: false, error: 'This wishlist no longer exists' },
        { status: 404 }
      );
    }
    // An owner invite promotes a member when it was issued as a promotion, or when
    // they're a member now (a promotion issued before the mark existed). A marked
    // one stays a promotion after they've gone, so it can't make a non-member an
    // owner however their removal and this accept interleave.
    const promotion = invite.role === 'owner' && (invite.promotion === true || !!membership);

    // Claim the invite before granting anything. If an owner's cancel or a removal
    // got there first, there's nothing left to claim and nothing is granted.
    if (!(await claimInvite(invite._id, 'accepted'))) return inviteNotFound();

    // This is where co-ownership is actually granted — the consent step. Becoming
    // an owner releases every booking the invitee held here and cancels their
    // reservations: an owner can never see, cancel, or receive their own booking.
    let released: { unbookedItems: number; cancelledReservations: number } | null = {
      unbookedItems: 0,
      cancelledReservations: 0,
    };
    try {
      if (isWishlistOwner(wishlist, userId)) {
        // Nothing to grant. An owner invite still settles their bookings, which an
        // earlier accept of it may have made them an owner without releasing.
        if (invite.role === 'owner') {
          released = await releaseHoldingsForRole(wishlist._id.toString(), userId, 'owner');
        }
      } else if (invite.role !== 'owner') {
        // Membership carries no role, so joining twice is a no-op.
        await WishlistMember.findOneAndUpdate(
          { wishlist: invite.wishlist, user: userId },
          { $set: { wishlist: invite.wishlist, user: userId } },
          { upsert: true }
        );
      } else if (promotion) {
        released = await promoteMemberToOwner(wishlist, userId);
      } else {
        released = await addWishlistOwner(wishlist, userId);
      }
    } catch (err) {
      await releaseClaim(invite._id);
      throw err;
    }

    if (!released) {
      // A promotion whose member was taken off the list before it could land. That
      // removal's cancel found the invite already claimed (or it was issued after
      // that cancel), so finish its job: the invite goes, as it would have had the
      // removal come first.
      await withdrawInvite(invite, 'accepted');
      return inviteNotFound();
    }

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
