import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import WishlistInvite from '@/models/WishlistInvite';
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
    await WishlistInvite.deleteOne({ _id: inviteId });

    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    console.error('Error cancelling invite:', error);
    return NextResponse.json({ success: false, error: 'Failed to cancel invite' }, { status: 500 });
  }
}
