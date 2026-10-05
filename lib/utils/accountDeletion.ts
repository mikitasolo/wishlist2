import mongoose from 'mongoose';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Item from '@/models/Item';
import WishlistJoinRequest from '@/models/WishlistJoinRequest';
import NotificationEmailClaim from '@/models/NotificationEmailClaim';
import Follow from '@/models/Follow';
import ShareLink from '@/models/ShareLink';
import WishlistLinkBlock from '@/models/WishlistLinkBlock';
import { clearJoinRequestNotifications } from '@/lib/utils/joinRequests';
import Notification from '@/models/Notification';
import { ownedByFilter } from '@/lib/utils/wishlistOwners';
import {
  isLastOwner,
  leaveAsMember,
  releaseUserBookings,
  removeWishlistOwner,
} from '@/lib/utils/wishlistOwnership';
import { deleteOwnedWishlist } from '@/lib/utils/wishlistDeletion';
import { cancelInvitesSentBy, cancelPendingInvites } from '@/lib/utils/wishlistInvites';
import { deleteGiftLogs, deleteReservations } from '@/lib/utils/reservationSnapshots';
import { deleteOwnBlobs, listUserUploads } from '@/lib/utils/blob';
import { purgeShareCards } from '@/lib/og/purge';

/**
 * Deleting an account and everything in it (WIS-276), at once, with no grace
 * period and no export. Every step goes through the helper the same change
 * goes through anywhere else, so each keeps its invariants:
 *
 *   1. Sessions end first, so none of the account's other devices can start a
 *      request while the rest runs.
 *   0. Nothing changes unless the lists it owns alone are exactly the ones the
 *      confirmation named (`agreedListIds`), or fewer.
 *   2. Lists it owns alone are deleted through the normal list delete
 *      (`deleteOwnedWishlist`, which clears their notifications and purges their
 *      share cards; gifters keep their own records, as with any list delete).
 *      Co-owned lists only lose this owner (`removeWishlistOwner`, which refuses
 *      the last one), and the invites it sent for them are cancelled.
 *   3. Lists it's a member of are left as a member leaves (`leaveAsMember`:
 *      bookings freed, pending invites cancelled), and any other item it still
 *      holds booked is freed.
 *   4. Its own reservations and gift history go (`deleteReservations`,
 *      `deleteGiftLogs`), freeing their snapshots.
 *   5. Its invites, requests to join (with the owners' `join_request`
 *      notifications about them), follows and notifications (its own, and any that name it as
 *      their actor), the record of notification emails sent to it, its proposals' link back to it, its dashboard pins, and its name on the share links it made.
 *   6. Its uploads, once nothing points at them any more.
 *   7. Its sign-in accounts and verification tokens, and its sessions again.
 *   8. Steps 2–6 once more, for anything a request already in flight when the
 *      sessions ended wrote meanwhile, then the user row, then its profile card.
 *
 * The user row goes last, so a deletion that fails part-way leaves the account
 * there to sign in to and delete again, and every step is safe to repeat: it
 * acts only on what's still there. A list is never left without an owner: one
 * the account owns alone is deleted only while that's still so, and one it
 * shares is left only while another owner remains, and either way the loop
 * reads it again until one of the two lands.
 *
 * Nobody is notified: deleting a list notifies nobody, and neither does leaving.
 * Nothing here logs: a failure propagates, as its kind, to the route.
 */
export async function deleteAccount(
  userId: string,
  { agreedListIds }: { agreedListIds: readonly string[] }
): Promise<'deleted' | 'lists-changed'> {
  await connectDB();
  const uid = new mongoose.Types.ObjectId(userId);
  const user = await User.findById(uid).select('email').lean();

  // Only the lists the confirmation named may be deleted. A list that has become
  // the account's alone since (a co-owner left) stops the deletion before
  // anything changes, so the person can confirm it again with that list named.
  const agreed = new Set(agreedListIds);
  const sole = await soleOwnedWishlists(userId);
  if (sole.some((l) => !agreed.has(l._id.toString()))) return 'lists-changed';

  await endSessions(uid);
  await eraseHoldings(userId, agreed);
  await eraseUploads(userId);
  await eraseSignIn(uid, user?.email);
  await eraseHoldings(userId, agreed);
  await eraseUploads(userId);

  await User.deleteOne({ _id: uid });
  await purgeShareCards({ userIds: [userId] });
  return 'deleted';
}

/** The lists `userId` owns alone, which deleting the account deletes with it. */
export async function soleOwnedWishlists(
  userId: string
): Promise<Array<{ _id: mongoose.Types.ObjectId; name: string }>> {
  await connectDB();
  return Wishlist.find({ ...ownedByFilter(userId), 'owners.1': { $exists: false } })
    .select('_id name')
    .sort({ createdAt: -1 })
    .lean();
}

/** How many times a list is read again while concurrent changes keep refusing its write. */
const MAX_LIST_ATTEMPTS = 5;

/** Steps 2–5: everything the account holds on lists and other people. Repeatable. */
async function eraseHoldings(userId: string, agreed: ReadonlySet<string>): Promise<void> {
  const uid = new mongoose.Types.ObjectId(userId);

  // 2. Lists it owns.
  const owned = await Wishlist.find(ownedByFilter(userId)).select('_id').lean();
  for (const { _id } of owned) await giveUpOwnedList(_id.toString(), userId, agreed);

  // 3. Lists it's a member of, then anything it still has booked anywhere.
  const memberships = await WishlistMember.find({ user: uid }).select('_id wishlist').lean();
  for (const m of memberships) await leaveAsMember(m.wishlist.toString(), userId, m._id);
  const booked: mongoose.Types.ObjectId[] = await Item.distinct('wishlist', {
    bookedBy: uid,
    status: 'booked',
  });
  for (const wishlistId of booked) await releaseUserBookings(wishlistId.toString(), userId);

  // 4. Its reservations and gift history, with their snapshots.
  await deleteReservations({ gifter: uid });
  await deleteGiftLogs({ gifter: uid });

  // 5. Invites: pending ones through the conditional deletes that race an
  // accept, then whatever answered rows are left.
  const received: mongoose.Types.ObjectId[] = await WishlistInvite.distinct('wishlist', {
    invitedUser: uid,
    status: 'pending',
  });
  for (const wishlistId of received) await cancelPendingInvites(wishlistId, uid);
  const sent: mongoose.Types.ObjectId[] = await WishlistInvite.distinct('wishlist', {
    invitedBy: uid,
    status: 'pending',
  });
  for (const wishlistId of sent) await cancelInvitesSentBy(wishlistId, uid);
  await WishlistInvite.deleteMany({
    $or: [{ invitedUser: uid }, { invitedBy: uid }],
    status: { $ne: 'pending' },
  });

  // Its requests to join (WIS-314): first the owners' `join_request`
  // notifications naming it, then the rows, so a failure in between leaves rows
  // that the next run finds again.
  const asked: mongoose.Types.ObjectId[] = await WishlistJoinRequest.distinct('wishlist', {
    user: uid,
  });
  for (const wishlistId of asked) await clearJoinRequestNotifications(wishlistId, uid);
  await WishlistJoinRequest.deleteMany({ user: uid });

  await Follow.deleteMany({ $or: [{ follower: uid }, { following: uid }] });
  await Notification.deleteMany({ $or: [{ user: uid }, { actor: uid }] });
  await NotificationEmailClaim.deleteMany({ user: uid });
  // Proposals stay on the lists they were made for, which are their owners',
  // without the link back to who made it (owners never saw it anyway).
  await Item.updateMany({ proposedBy: uid }, { $unset: { proposedBy: 1 } });
  await Wishlist.updateMany({ featuredBy: uid }, { $pull: { featuredBy: uid } });
  // Share links it made stay with their lists (links are the list's, and a
  // printed QR code keeps working), without the record of who made them.
  await ShareLink.updateMany({ createdBy: uid }, { $set: { createdBy: null } });
  // The lists that kicked it keeping it out of their share links (WIS-338).
  await WishlistLinkBlock.deleteMany({ user: uid });
}

/**
 * Stop owning one list: delete it while `userId` is its only owner, or else take
 * them off its owners while somebody else is left. Each write is conditional on
 * that still being so, and a refused one reads the list again, so a co-owner
 * leaving or joining at the same moment can neither leave it ownerless nor have
 * it deleted from under them.
 */
async function giveUpOwnedList(
  wishlistId: string,
  userId: string,
  agreed: ReadonlySet<string>
): Promise<void> {
  for (let attempt = 0; attempt < MAX_LIST_ATTEMPTS; attempt++) {
    const list = await Wishlist.findOne({ _id: wishlistId, ...ownedByFilter(userId) })
      .select('_id owners featuredBy')
      .lean();
    if (!list) return; // gone, or no longer theirs

    if (isLastOwner(list, userId)) {
      // A list the confirmation didn't name became the account's alone during
      // the deletion: stop, rather than delete it unasked. The account is still
      // there, so confirming again (with it named) finishes the job.
      if (!agreed.has(wishlistId)) throw new Error('A wishlist became solely owned mid-deletion');
      if (await deleteOwnedWishlist(wishlistId, userId, { soleOwner: true })) return;
      continue; // someone became a co-owner meanwhile (or it went): read it again
    }

    const removal = await removeWishlistOwner(list, userId, {
      actorId: userId,
      keepAsMember: false,
    });
    if (removal === 'removed') {
      // As a co-owner leaving does, and the invites they sent go with them.
      await releaseUserBookings(wishlistId, userId);
      await cancelPendingInvites(wishlistId, userId);
      await cancelInvitesSentBy(wishlistId, userId);
      return;
    }
    // A co-owner demoted or removed them first: they're no longer an owner, and
    // a membership a demotion left them is the member pass's.
    // (The account acts on itself, so `'target-not-owner'` means the same.)
    if (removal === 'actor-not-owner' || removal === 'target-not-owner') return;
    // 'last-owner': the other owners left meanwhile, so read it again and delete it.
  }
  throw new Error('An owned wishlist kept changing during account deletion');
}

/** Step 6: free the account's uploads, after taking them off anything still showing them. */
async function eraseUploads(userId: string): Promise<void> {
  const urls = await listUserUploads(userId);
  if (!urls.length) return;
  // Images it put on co-owned lists' items and banners, or on proposals that
  // were approved: those records are someone else's now, so they keep the
  // record and lose the picture (the cover placeholder takes its place).
  await Item.updateMany({ imageUrl: { $in: urls } }, { $unset: { imageUrl: 1 } });
  const banners = await Wishlist.find({ bannerUrl: { $in: urls } })
    .select('_id')
    .lean();
  if (banners.length) {
    await Wishlist.updateMany({ bannerUrl: { $in: urls } }, { $set: { bannerUrl: null } });
    await purgeShareCards({ wishlistIds: banners.map((w) => w._id.toString()) });
  }
  await deleteOwnBlobs(urls);
}

/** Step 7: Auth.js's own records for the account (`@auth/mongodb-adapter`'s collections). */
async function eraseSignIn(uid: mongoose.Types.ObjectId, email: string | undefined) {
  const db = mongoose.connection;
  await db.collection('accounts').deleteMany({ userId: uid });
  if (email) await db.collection('verification_tokens').deleteMany({ identifier: email });
  await endSessions(uid);
}

async function endSessions(uid: mongoose.Types.ObjectId): Promise<void> {
  await mongoose.connection.collection('sessions').deleteMany({ userId: uid });
}
