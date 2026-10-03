import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import WishlistInvite from '@/models/WishlistInvite';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { clearCancelledInviteNotifications } from '@/lib/utils/wishlistInvites';
import { getOwnerAccess } from '@/lib/utils/wishlistAccess';
import { isObjectIdParam } from '@/lib/utils/objectId';

// DELETE /api/wishlists/[id]/invites/[inviteId] - cancel a pending invite (owners).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; inviteId: string }> }
) {
  try {
    const session = await auth();
    // Before the list is looked up, so a signed-out caller is told the same
    // whether or not it exists (an archived list's existence is its owners').
    if (!session?.user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { id: idParam, inviteId } = await params;
    const id = await resolveWishlistId(idParam);
    if (!id) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }
    await connectDB();
    // An archived list comes back as no list at all to anyone but its owners
    // (see `getOwnerAccess`).
    const { isOwner, wishlist } = await getOwnerAccess(id, session.user.id);
    if (!wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }
    if (!isOwner) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    // A malformed id can't match any invite: answer like a missing one, not with
    // the CastError's 500.
    if (!isObjectIdParam(inviteId)) {
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

    // Its notification has nothing left to act on. Best-effort: the invite is
    // already gone, so a failed cleanup must not turn a successful cancel into an
    // error.
    await clearCancelledInviteNotifications(invite, cancelledAt);

    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    console.error('Error cancelling invite:', error);
    return NextResponse.json({ success: false, error: 'Failed to cancel invite' }, { status: 500 });
  }
}
