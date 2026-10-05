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
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';

const signInError = () =>
  NextResponse.json({ success: false, error: 'Unauthorized - Please sign in' }, { status: 401 });

// GET /api/wishlists/[id]/requests/me - whether you've asked to join this list
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return signInError();

    const { id: idParam } = await params;
    await connectDB();
    const access = await readListForRequester(request, idParam, session.user.id);
    if (access.response) return access.response;

    // An owner or a member has nothing to ask.
    const asked =
      !access.isOwner && !access.isMember && (await hasRequestedToJoin(access.id, session.user.id));
    return access.answer(NextResponse.json({ success: true, data: { requested: asked } }));
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
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return signInError();
    const userId = session.user.id;

    const { id: idParam } = await params;
    await connectDB();
    // As anywhere a requester asks about a list: one they can't open (archived
    // included, or through a share link that has died since) answers as
    // missing. Their own request still goes then (a list made private after
    // they asked mustn't keep it in front of its owners), but the answer is the
    // missing list's, whatever there was to cancel.
    const access = await readListForRequester(request, idParam, userId);
    const id = access.response ? await resolveWishlistId(idParam) : access.id;
    if (id) await cancelOwnRequest(id, userId);
    if (access.response) return access.response;

    // The same answer whether there was anything to cancel, or it was declined.
    return access.answer(NextResponse.json({ success: true, data: { requested: false } }));
  } catch (error) {
    console.error('Error cancelling a join request:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to cancel your request' },
      { status: 500 }
    );
  }
}

/** Delete their pending request, or withdraw one declined (unknown to them) within the wait. */
async function cancelOwnRequest(id: string, userId: string): Promise<void> {
  const { deletedCount } = await WishlistJoinRequest.deleteMany({
    wishlist: id,
    user: userId,
    status: 'pending',
  });
  if (deletedCount) {
    await clearJoinRequestNotifications(id, userId);
    return;
  }
  // Declined, unknown to them: keep the row, so the wait before asking again
  // still holds, and only stop showing it as theirs.
  await WishlistJoinRequest.updateMany(
    { wishlist: id, user: userId, status: 'declined', declinedAt: { $gt: declineCutoff() } },
    { $set: { withdrawn: true } }
  );
}
