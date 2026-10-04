import { NextRequest, NextResponse } from 'next/server';
import type mongoose from 'mongoose';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite, { type IWishlistInvite } from '@/models/WishlistInvite';
import { createNotifications, recordInviteAnswer } from '@/lib/notifications';
import { isWishlistOwner, ownerIds } from '@/lib/utils/wishlistOwners';
import { errorKind } from '@/lib/utils/errorKind';
import {
  addWishlistOwner,
  promoteMemberToOwner,
  releaseHoldingsForRole,
} from '@/lib/utils/wishlistOwnership';
import {
  isInvitePaused,
  withdrawInvite,
  withdrawUnlessInviterOwns,
} from '@/lib/utils/wishlistInvites';
import { isObjectIdParam } from '@/lib/utils/objectId';
import { getWishlistViewAccess, isHiddenByArchive } from '@/lib/utils/wishlistAccess';
import { endPendingJoinRequest } from '@/lib/utils/joinRequests';

const inviteNotFound = () =>
  NextResponse.json({ success: false, error: 'Invite not found' }, { status: 404 });

const wishlistGone = () =>
  NextResponse.json({ success: false, error: 'This wishlist no longer exists' }, { status: 404 });

/**
 * The answer to an invitee answering their own invite that isn't pending any
 * more (WIS-100): accepted or declined already, from another tab or device.
 * 409 with the invite's `status`, so they're told they joined (or declined)
 * instead of that the invite is gone. Only ever for the invitee: an invite
 * addressed to anyone else is answered like a missing one before this is
 * reached. An accepted one carries the list's link (`wishlistSlug`,
 * `wishlistId`) only while the invitee can open the list
 * (`getWishlistViewAccess`), so it never hands out a link to a list that's
 * private to them since, or one they've been taken off. A list that's gone gets
 * the deleted list's 404: its invites go with it, and an accept that found it
 * gone declined the invite on the way out, which isn't their answer. An archived
 * list they don't own gets the `Invite not found` 404, as a paused invite does,
 * so to a non-owner it stays indistinguishable from a missing one.
 */
async function alreadyAnswered(
  invite: Pick<IWishlistInvite, 'wishlist' | 'status'>,
  userId: string
): Promise<NextResponse> {
  const list = await Wishlist.findById(invite.wishlist).select('owners visibility archived slug');
  if (!list) return wishlistGone();
  if (isHiddenByArchive(list, userId)) return inviteNotFound();
  const data: { status: string; wishlistSlug?: string | null; wishlistId?: string } = {
    status: invite.status,
  };
  if (invite.status === 'accepted' && (await getWishlistViewAccess(list, userId)).allowed) {
    data.wishlistSlug = list.slug ?? null;
    data.wishlistId = list._id.toString();
  }
  return NextResponse.json(
    { success: false, error: 'This invitation has already been answered.', data },
    { status: 409 }
  );
}

/**
 * The answer when this request's claim matched nothing: something else reached
 * the pending invite first. Read again to tell which. The invitee's own answer
 * (another tab's accept or decline) is `alreadyAnswered`; an owner's cancel or a
 * removal deleted the row, and anything else (a claim already put back to
 * pending) keeps the 404 it always had.
 */
async function lostClaim(inviteId: mongoose.Types.ObjectId, userId: string): Promise<NextResponse> {
  const now = await WishlistInvite.findById(inviteId).select('wishlist invitedUser status').lean();
  if (!now || now.status === 'pending' || now.invitedUser?.toString() !== userId) {
    return inviteNotFound();
  }
  return alreadyAnswered(now, userId);
}

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
 *
 * An invite whose sender has stopped owning the list since is withdrawn instead
 * (`withdrawUnlessInviterOwns`), unless the grant already made the invitee an
 * owner, which only accepting again can finish. While it was claimed, a removal
 * or demotion of its sender skipped it (`cancelInvitesSentBy` only takes pending
 * invites), so reopening it would bring back an invite that removal cancels.
 */
async function releaseClaim(
  invite: Pick<IWishlistInvite, '_id' | 'wishlist' | 'invitedUser' | 'invitedBy'>
): Promise<void> {
  try {
    const { modifiedCount } = await WishlistInvite.updateOne(
      { _id: invite._id, status: 'accepted' },
      { $set: { status: 'pending' } }
    );
    if (!modifiedCount) return;
    const list = await Wishlist.findById(invite.wishlist).select('owners').lean();
    if (list && isWishlistOwner(list, invite.invitedUser.toString())) return;
    await withdrawUnlessInviterOwns(invite);
  } catch (err) {
    console.error(`Could not reopen invite ${invite._id} after a failed accept:`, err);
  }
}

/**
 * Make the invitee a member, unless the list has been deleted or archived since
 * accept read it. Then nothing is left behind for it: `'gone'` with no membership
 * row, or `'paused'` with no row this call wrote, since a member can't open an
 * archived list (see `isInvitePaused`). `'removed'` when the list was archived
 * and the row this call wrote was already gone when it came to take it back: an
 * owner kicked the brief member, and that kick's invite cleanup found this
 * invite claimed, so it mustn't be reopened.
 *
 * The upsert can't be made conditional on the list, which lives in another
 * collection, so the list is checked after it. Deleting a list removes the list
 * before its memberships. So either this check finds the list gone and takes the
 * row back, or the list was still there, and the delete's membership cleanup runs
 * after the row exists and removes it. A check before the upsert would miss a
 * delete that finished in between, and leave the row for good. Archiving works
 * the same way: a list this check finds unarchived was archived, if at all, after
 * the row existed, so they joined first, as any member of it may have.
 */
async function joinAsMember(
  wishlistId: mongoose.Types.ObjectId,
  userId: string
): Promise<'joined' | 'gone' | 'paused' | 'removed'> {
  // Membership carries no role, so joining twice is a no-op. The row as it was
  // before: null when this upsert created it.
  const existing = await WishlistMember.findOneAndUpdate(
    { wishlist: wishlistId, user: userId },
    { $set: { wishlist: wishlistId, user: userId } },
    { upsert: true }
  );
  const list = await Wishlist.findById(wishlistId).select('archived').lean();
  if (!list) {
    await WishlistMember.deleteMany({ wishlist: wishlistId, user: userId });
    return 'gone';
  }
  if (!list.archived) return 'joined';
  // Only a row this accept created: one that was already there is a membership
  // they held before, which isn't this accept's to take.
  if (existing) return 'paused';
  const { deletedCount } = await WishlistMember.deleteMany({ wishlist: wishlistId, user: userId });
  return deletedCount ? 'paused' : 'removed';
}

/**
 * Who's told that an invite was accepted: whoever sent it, while they still own
 * the list. An owner who has since left, or been removed or demoted, is off the
 * list's management and mustn't learn who joins it, so it goes to the current
 * owners instead, the invitee aside (a promotion has just made them one).
 *
 * Read once the role is granted, so the owners are the list's as of the join. A
 * removal landing after this read is one the join came before, while the inviter
 * still owned the list. Best-effort, like the notification itself: a failed read
 * is logged by its kind and tells nobody. So does a list that's gone by now.
 */
async function inviteAcceptedRecipients(
  invite: Pick<IWishlistInvite, 'wishlist' | 'invitedBy'>,
  inviteeId: string
): Promise<string[]> {
  try {
    const list = await Wishlist.findById(invite.wishlist).select('owners').lean();
    if (!list) return [];
    const inviter = invite.invitedBy.toString();
    if (isWishlistOwner(list, inviter)) return [inviter];
    return ownerIds(list).filter((id) => id !== inviteeId);
  } catch (err) {
    console.error('Could not read who to tell about an accepted invite:', errorKind(err));
    return [];
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
    // Someone else's invite is answered as a missing one: nothing about it, not
    // even that it exists, reaches anyone but its invitee.
    const userId = session.user.id;
    if (!invite || invite.invitedUser?.toString() !== userId) return inviteNotFound();
    if (invite.status !== 'pending') return alreadyAnswered(invite, userId);

    // Before the claim, so a re-invite (which only the claim makes possible) is
    // newer: see `recordInviteAnswer`.
    const answeredAt = new Date();

    if (action === 'decline') {
      // A paused invite (see `isInvitePaused`) can't be declined either: answered
      // as accept answers it, like an invite that isn't there, so an archived list
      // can't be told from a missing one. It's back, to decline, on unarchive. An
      // archive landing after this read lets the decline through, which only
      // takes the invite away, as declining just before the archive would have.
      const list = await Wishlist.findById(invite.wishlist).select('archived').lean();
      if (list && isInvitePaused(invite, list)) return inviteNotFound();
      if (!(await claimInvite(invite._id, 'declined'))) return lostClaim(invite._id, userId);
      await recordInviteAnswer({ invite, answer: 'declined', answeredAt });
      return NextResponse.json({ success: true, data: { status: 'declined' } }, { status: 200 });
    }

    // Read before the claim. For the membership the order matters: a kick or a
    // member leaving cancels pending invites before it deletes the membership. So
    // if the membership is here now and the claim below succeeds, no removal has
    // deleted it yet, and `promoteMemberToOwner` settles which of the two lands.
    const [wishlist, membership] = await Promise.all([
      Wishlist.findById(invite.wishlist).select('owners featuredBy slug name archived'),
      WishlistMember.exists({ wishlist: invite.wishlist, user: userId }),
    ]);
    if (!wishlist) {
      await claimInvite(invite._id, 'declined');
      return wishlistGone();
    }
    // A member invite to an archived list is paused: it stays pending, unclaimed,
    // for when the list is unarchived. Answered like an invite that isn't there,
    // which is how the invitee's invites read leaves it.
    if (isInvitePaused(invite, wishlist)) return inviteNotFound();
    // An owner invite promotes a member when it was issued as a promotion, or when
    // they're a member now (a promotion issued before the mark existed). A marked
    // one stays a promotion after they've gone, so it can't make a non-member an
    // owner however their removal and this accept interleave.
    const promotion = invite.role === 'owner' && (invite.promotion === true || !!membership);

    // Claim the invite before granting anything. If an owner's cancel or a removal
    // got there first, there's nothing left to claim and nothing is granted.
    if (!(await claimInvite(invite._id, 'accepted'))) return lostClaim(invite._id, userId);

    // This is where co-ownership is actually granted — the consent step. Becoming
    // an owner releases every booking the invitee held here and cancels their
    // reservations: an owner can never see, cancel, or receive their own booking.
    // `null` once nothing was granted (see below).
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
        const joined = await joinAsMember(invite.wishlist, userId);
        if (joined === 'gone' || joined === 'removed') released = null;
        if (joined === 'paused') {
          // The list was archived since the read above. The invite is paused, not
          // over, so the claim is put back, as a failed grant's is, and the answer
          // is the one an accept that came after the archive gets.
          await releaseClaim(invite);
          return inviteNotFound();
        }
      } else if (promotion) {
        released = await promoteMemberToOwner(wishlist, userId);
      } else {
        released = await addWishlistOwner(wishlist, userId);
      }
    } catch (err) {
      await releaseClaim(invite);
      throw err;
    }

    if (!released) {
      // Nothing was granted, because something beat the grant to it since the read
      // above: the list was deleted, or a promotion's member was taken off the list
      // (or a new member, on a list archived under the accept). Either one's invite cleanup found this invite already claimed (or, for a
      // promotion, it was issued after that cleanup), so finish its job: the invite
      // goes, as it would have had the delete or the removal come first. It isn't
      // reopened, as a failed grant's is, because accepting again can't succeed.
      await withdrawInvite(invite, 'accepted');
      // Only picks the answer. A deleted list stays deleted.
      return (await Wishlist.exists({ _id: invite.wishlist })) ? inviteNotFound() : wishlistGone();
    }

    // Let the inviter know their invitation was accepted (or the current owners,
    // if the inviter isn't one any more), and turn the invitee's own invite
    // notification into "You joined …". Only now that the role is granted: a
    // failed grant reopens the invite, which is pending again.
    await Promise.all([
      inviteAcceptedRecipients(invite, userId).then((recipients) =>
        createNotifications(recipients, {
          type: 'invite_accepted',
          actorUsername: session.user.username ?? null,
          actor: userId,
          wishlist: invite.wishlist,
          wishlistName: wishlist.name,
          wishlistSlug: wishlist.slug ?? null,
        })
      ),
      recordInviteAnswer({ invite, answer: 'accepted', answeredAt }),
      // On the list now, so a request to join it is over (best-effort).
      endPendingJoinRequest(invite.wishlist, userId),
    ]);

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
