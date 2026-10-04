import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import WishlistMember from '@/models/WishlistMember';
import WishlistJoinRequest, { type IWishlistJoinRequest } from '@/models/WishlistJoinRequest';
import User from '@/models/User';
import { joinRequestAnswerSchema, validateRequestBody } from '@/lib/validations';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { getOwnerAccess } from '@/lib/utils/wishlistAccess';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';
import {
  isInvitePaused,
  issueWishlistInvite,
  withdrawUnlessInviterOwns,
} from '@/lib/utils/wishlistInvites';
import { clearJoinRequestNotifications } from '@/lib/utils/joinRequests';
import { isDuplicateKeyError } from '@/lib/utils/mongoErrors';
import { isObjectIdParam } from '@/lib/utils/objectId';
import { publicDisplayName } from '@/lib/utils/displayName';
import { errorKind } from '@/lib/utils/errorKind';

const wishlistNotFound = () =>
  NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
const requestNotFound = () =>
  NextResponse.json({ success: false, error: 'Request not found' }, { status: 404 });
const notOwnerError = () =>
  NextResponse.json(
    { success: false, error: 'Unauthorized - Owner access required' },
    { status: 403 }
  );

/**
 * Put back a request this answer claimed (deleted) and then couldn't carry
 * through, so it's still there for an owner to answer. Best-effort: a pending
 * one made since (they asked again) already stands for it.
 */
async function restoreRequest(row: IWishlistJoinRequest): Promise<void> {
  try {
    await WishlistJoinRequest.create({
      _id: row._id,
      wishlist: row.wishlist,
      user: row.user,
      status: 'pending',
      createdAt: row.createdAt,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) return;
    console.error(`Could not restore join request ${row._id}:`, errorKind(err));
  }
}

/**
 * PATCH /api/wishlists/[id]/requests/[requestId] - an owner answers a request
 * to join: `{ action: 'invite' }` issues a normal member invite, which the
 * requester still has to accept, and ends the request; `{ action: 'decline' }`
 * ends it and tells nobody. Each claims the pending request in one conditional
 * write, so of an Invite, a Decline (from any owner) and the requester's own
 * cancel, exactly one lands.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }
    const callerId = session.user.id;

    const { id: idParam, requestId } = await params;
    const id = await resolveWishlistId(idParam);
    if (!id) return wishlistNotFound();

    await connectDB();
    // Owners only, and an archived list is no list at all to anyone else.
    const { isOwner, wishlist } = await getOwnerAccess(id, callerId);
    if (!wishlist) return wishlistNotFound();
    if (!isOwner) return notOwnerError();
    // After the access check, so a malformed id tells nothing more.
    if (!isObjectIdParam(requestId)) return requestNotFound();

    const validation = await validateRequestBody(request, joinRequestAnswerSchema);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: validation.status }
      );
    }
    const { action } = validation.data;

    if (action === 'decline') {
      // The owner check above read the list before the body was parsed:
      // re-read it right before the write, which lives on another collection
      // and so can't carry the check itself.
      const stillOwner = await getOwnerAccess(id, callerId);
      if (!stillOwner.wishlist) return wishlistNotFound();
      if (!stillOwner.isOwner) return notOwnerError();
      // Silent: the requester's page keeps reading "Requested" until they may
      // ask again (see `WishlistJoinRequest`), and nobody is notified.
      const declined = await WishlistJoinRequest.findOneAndUpdate(
        { _id: requestId, wishlist: id, status: 'pending' },
        { $set: { status: 'declined', declinedAt: new Date(), withdrawn: false } }
      );
      if (!declined) return requestNotFound();
      await clearJoinRequestNotifications(id, declined.user);
      return NextResponse.json({ success: true, data: { status: 'declined' } });
    }

    // Invite: an invite, so it spends the inviter's invite budget.
    const limited = await enforce('invite', userKey(callerId));
    if (limited) return limited;

    const pending = await WishlistJoinRequest.findOne({
      _id: requestId,
      wishlist: id,
      status: 'pending',
    });
    if (!pending) return requestNotFound();
    const requesterId = pending.user.toString();

    // Re-read the caller's ownership right before any write, as the invite
    // routes do: a co-owner may have removed them (or deleted the list) since.
    const current = await getOwnerAccess(id, callerId);
    if (!current.wishlist) return wishlistNotFound();
    if (!current.isOwner) return notOwnerError();

    const requester = await User.findById(requesterId).select('email');
    const onList =
      isWishlistOwner(current.wishlist, requesterId) ||
      !!(await WishlistMember.exists({ wishlist: id, user: requesterId }));
    if (!requester || onList) {
      // Nothing to invite them to: the request is over either way.
      await WishlistJoinRequest.deleteOne({ _id: pending._id, status: 'pending' });
      await clearJoinRequestNotifications(id, requesterId);
      if (!requester) return requestNotFound();
      return NextResponse.json(
        { success: false, error: 'This person is already on the list' },
        { status: 409 }
      );
    }

    // A member invite to an archived list would only wait, paused.
    if (isInvitePaused({ role: 'member' }, current.wishlist)) {
      return NextResponse.json(
        { success: false, error: 'Unarchive this list to invite members' },
        { status: 409 }
      );
    }

    // Claim it: of this, a decline and the requester's cancel, one lands.
    const claimed = await WishlistJoinRequest.findOneAndDelete({
      _id: pending._id,
      status: 'pending',
    });
    if (!claimed) return requestNotFound();

    // A normal member invite, exactly as the invite form issues one, except
    // that the requester's `whoCanInvite` doesn't apply: they asked.
    let invite;
    try {
      invite = await issueWishlistInvite({
        wishlistId: id,
        wishlistName: current.wishlist.name,
        role: 'member',
        invitedBy: callerId,
        inviterName: publicDisplayName(session.user),
        actorUsername: session.user.username ?? null,
        invitedUserId: requesterId,
        invitedUserEmail: requester.email,
      });
    } catch (err) {
      await restoreRequest(claimed);
      throw err;
    }

    // As the invite routes do: a removal that landed meanwhile may have missed
    // it, so take it back (and put the request back) if the caller lost the list.
    if (invite && (await withdrawUnlessInviterOwns(invite))) {
      const after = await getOwnerAccess(id, callerId);
      // A deleted list's requests went with it: nothing to put back then.
      if (!after.wishlist) return wishlistNotFound();
      await restoreRequest(claimed);
      return notOwnerError();
    }

    // `null`: they already had a pending invite, which answers the request too.
    await clearJoinRequestNotifications(id, requesterId);
    return NextResponse.json({ success: true, data: { status: 'invited' } });
  } catch (error) {
    console.error('Error answering a join request:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to answer the request' },
      { status: 500 }
    );
  }
}
