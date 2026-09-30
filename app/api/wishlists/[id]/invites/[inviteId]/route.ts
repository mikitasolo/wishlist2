import { NextRequest, NextResponse } from 'next/server';
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

    const invite = await WishlistInvite.findOne({ _id: inviteId, wishlist: id });
    if (!invite) {
      return NextResponse.json({ success: false, error: 'Invite not found' }, { status: 404 });
    }
    const cancelledAt = new Date();
    await WishlistInvite.deleteOne({ _id: inviteId });

    // A pending invite's `wishlist_invite` notification links to /invites and
    // looks actionable, but there's nothing left there to accept, so clear it.
    // (Once an invite is accepted or declined its notification is history, which
    // accept/decline keep too, so a stale "cancel" of one leaves it alone.)
    // Notifications carry no invite id, which bounds what we may delete:
    //  - only while no other pending invite for this person and list remains:
    //    the unique pending index allows one at most, but only once it's built;
    //  - only notifications from before this cancel, so a re-invite landing
    //    between the check and the delete keeps its own.
    // Best-effort: the invite is already gone, so a failed cleanup must not turn
    // a successful cancel into an error.
    if (invite.status === 'pending') {
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
    }

    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    console.error('Error cancelling invite:', error);
    return NextResponse.json({ success: false, error: 'Failed to cancel invite' }, { status: 500 });
  }
}
