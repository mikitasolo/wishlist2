import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import WishlistJoinRequest from '@/models/WishlistJoinRequest';
import {
  clearJoinRequestNotifications,
  declineCutoff,
  hasRequestedToJoin,
} from '@/lib/utils/joinRequests';
import { readListForRequester } from '@/lib/utils/joinRequestAccess';

const signInError = () =>
  NextResponse.json({ success: false, error: 'Unauthorized - Please sign in' }, { status: 401 });

// GET /api/wishlists/[id]/requests/me - whether you've asked to join this list
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return signInError();

    const { id: idParam } = await params;
    await connectDB();
    const access = await readListForRequester(idParam, session.user.id);
    if (access.response) return access.response;

    // An owner or a member has nothing to ask.
    const asked =
      !access.isOwner && !access.isMember && (await hasRequestedToJoin(access.id, session.user.id));
    return NextResponse.json({ success: true, data: { requested: asked } });
  } catch (error) {
    console.error('Error reading a join request:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to read your request' },
      { status: 500 }
    );
  }
}

// DELETE /api/wishlists/[id]/requests/me - cancel your request to join this list
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return signInError();
    const userId = session.user.id;

    const { id: idParam } = await params;
    await connectDB();
    // As anywhere a requester asks about a list: one they can't open (archived
    // included) answers as missing.
    const access = await readListForRequester(idParam, userId);
    if (access.response) return access.response;
    const { id } = access;

    const { deletedCount } = await WishlistJoinRequest.deleteMany({
      wishlist: id,
      user: userId,
      status: 'pending',
    });
    if (deletedCount) {
      await clearJoinRequestNotifications(id, userId);
    } else {
      // Declined, unknown to them: keep the row, so the wait before asking
      // again still holds, and only stop showing it as theirs.
      await WishlistJoinRequest.updateMany(
        { wishlist: id, user: userId, status: 'declined', declinedAt: { $gt: declineCutoff() } },
        { $set: { withdrawn: true } }
      );
    }

    // The same answer whether there was anything to cancel, or it was declined.
    return NextResponse.json({ success: true, data: { requested: false } });
  } catch (error) {
    console.error('Error cancelling a join request:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to cancel your request' },
      { status: 500 }
    );
  }
}
