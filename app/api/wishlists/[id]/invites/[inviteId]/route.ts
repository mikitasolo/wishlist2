import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import WishlistInvite from '@/models/WishlistInvite';
import Notification from '@/models/Notification';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { isOwnerOfWishlist } from '@/lib/utils/wishlistAccess';

// DELETE /api/wishlists/[id]/invites/[inviteId] - cancel a pending invite (owners).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; inviteId: string }> }
) {
  try {
    const session = await auth();
    const { id: idParam, inviteId } = await params;
    const id = await resolveWishlistId(idParam);
    if (!id) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    await connectDB();
    if (!(await isOwnerOfWishlist(id, session.user.id))) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // A malformed id can't match any invite: answer like a missing one, not with
    // the CastError's 500.
    if (!mongoose.isObjectIdOrHexString(inviteId)) {
      return NextResponse.json({ success: false, error: 'Invite not found' }, { status: 404 });
    }

    // Only a pending invite can be cancelled, and that check is part of the
    // delete itself. The owner's invites panel can lag behind the invitee, and an
    // answer recorded between a separate read and the delete would be erased, with
    // the owner told "cancelled" while the person stays in. Accept and decline
    // record the answer before they grant anything, in the same kind of
    // conditional write, so an answer still in flight is covered too: exactly one
    // of the two matches the pending row.
    const cancelledAt = new Date();
    const invite = await WishlistInvite.findOneAndDelete({
      _id: inviteId,
      wishlist: id,
      status: 'pending',
    });
    if (!invite) {
      // Nothing was deleted. If the invite is still on this list it was answered:
      // say so, but not how (accepted and declined get the same reply).
      if (await WishlistInvite.exists({ _id: inviteId, wishlist: id })) {
        return NextResponse.json(
          { success: false, error: 'This invitation has already been answered.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ success: false, error: 'Invite not found' }, { status: 404 });
    }

    // A pending invite's `wishlist_invite` notification links to /invites and
    // looks actionable, but there's nothing left there to accept, so clear it.
    // (An invite that was already accepted or declined never gets this far, and
    // its notification is history, which accept/decline keep too.)
    // Notifications carry no invite id, which bounds what we may delete:
    //  - only while no other pending invite for this person and list remains:
    //    the unique pending index allows one at most, but only once it's built;
    //  - only notifications from before this cancel, so a re-invite landing
    //    between the check and the delete keeps its own.
    // Best-effort: the invite is already gone, so a failed cleanup must not turn
    // a successful cancel into an error.
    try {
      const stillPending = await WishlistInvite.exists({
        wishlist: id,
        invitedUser: invite.invitedUser,
        status: 'pending',
      });
      if (!stillPending) {
        await Notification.deleteMany({
          user: invite.invitedUser,
          wishlist: id,
          type: 'wishlist_invite',
          createdAt: { $lt: cancelledAt },
        });
      }
    } catch (err) {
      console.error(`Notification cleanup failed for cancelled invite ${inviteId}:`, err);
    }

    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    console.error('Error cancelling invite:', error);
    return NextResponse.json({ success: false, error: 'Failed to cancel invite' }, { status: 500 });
  }
}
