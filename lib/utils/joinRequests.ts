import mongoose from 'mongoose';
import WishlistJoinRequest from '@/models/WishlistJoinRequest';
import Notification from '@/models/Notification';
import { errorKind } from '@/lib/utils/errorKind';

type Id = string | mongoose.Types.ObjectId;

/** How long a declined request holds its requester off before they may ask again. */
export const ASK_AGAIN_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** The oldest decline that still holds a requester off, as of `now`. */
export function declineCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - ASK_AGAIN_AFTER_MS);
}

/**
 * Whether `userId` reads as having asked to join the list: a pending request,
 * or one declined less than `ASK_AGAIN_AFTER_MS` ago that they haven't
 * cancelled. A decline is silent, so to the requester it looks pending until
 * they may ask again.
 */
export async function hasRequestedToJoin(wishlistId: Id, userId: Id): Promise<boolean> {
  const row = await WishlistJoinRequest.exists({
    wishlist: wishlistId,
    user: userId,
    $or: [
      { status: 'pending' },
      { status: 'declined', declinedAt: { $gt: declineCutoff() }, withdrawn: { $ne: true } },
    ],
  });
  return !!row;
}

/**
 * Take away the owners' `join_request` notifications about one person's
 * request for a list, once it's ended (invited, declined, cancelled, or the
 * person is on the list now): there's nothing left on them to act on.
 * Best-effort: a failure is logged by its kind only (the filter names who
 * asked to join which list) and swallowed.
 */
export async function clearJoinRequestNotifications(wishlistId: Id, userId: Id): Promise<void> {
  try {
    await Notification.deleteMany({ type: 'join_request', wishlist: wishlistId, actor: userId });
  } catch (err) {
    console.error('Join request notification cleanup failed:', errorKind(err));
  }
}

/**
 * End the pending request a person has on a list now that they're on it, or
 * have just left or been taken off it: joined through an invite (any role), or
 * a leave or a kick (through `cancelPendingInvites`). A request never grants
 * anything by itself, so a leftover one couldn't put them back on the list,
 * but it would show the owners a request from someone who's already a member,
 * or bring an old one back the moment they're removed.
 *
 * Declined rows stay: the wait before asking again still holds. Best-effort,
 * like the notification cleanup: a failure is logged by its kind and swallowed,
 * and the owners' Requests list leaves out anyone already on the list anyway.
 */
export async function endPendingJoinRequest(wishlistId: Id, userId: Id): Promise<void> {
  try {
    const { deletedCount } = await WishlistJoinRequest.deleteMany({
      wishlist: wishlistId,
      user: userId,
      status: 'pending',
    });
    if (deletedCount) await clearJoinRequestNotifications(wishlistId, userId);
  } catch (err) {
    console.error('Join request cleanup failed:', errorKind(err));
  }
}
