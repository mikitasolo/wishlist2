import mongoose from 'mongoose';
import WishlistInvite, { IWishlistInvite } from '@/models/WishlistInvite';
import Wishlist, { IWishlist } from '@/models/Wishlist';
import Notification from '@/models/Notification';
import { sendWishlistInvitationEmail } from '@/lib/email';
import { createNotification } from '@/lib/notifications';
import { isDuplicateKeyError } from '@/lib/utils/mongoErrors';
import { errorKind } from '@/lib/utils/errorKind';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';

type Id = string | mongoose.Types.ObjectId;

interface IssueInviteArgs {
  wishlistId: Id;
  wishlistName: string;
  role: IWishlistInvite['role'];
  /** Promoting a member of the list (an `owner` invite): see `WishlistInvite.promotion`. */
  promotion?: boolean;
  invitedBy: Id;
  /** Public name of the inviter, for the email body: `publicDisplayName`, never from their email. */
  inviterName: string;
  /**
   * Inviter's username, or null to stay anonymous: names them in the in-app
   * notification and in the email's subject, which takes no free-text name.
   */
  actorUsername?: string | null;
  invitedUserId: Id;
  /** Account email of the invitee — fetched by the caller, never stored on the invite. */
  invitedUserEmail?: string | null;
}

/**
 * What this layer logs about a failed invite email: enough to tell a bad address
 * from a dead transport, but not the error message — an SMTP rejection quotes the
 * recipient's address.
 */
function mailFailure(err: unknown) {
  return errorKind(err, ['name', 'code', 'responseCode']);
}

/**
 * Create a pending invite and tell the invitee about it (in-app notification +
 * email). Membership/ownership is only granted when they accept, so this is also
 * the promotion path for co-ownership.
 *
 * Returns `null` when the invitee already has a pending invite for this list —
 * in which case nothing is sent: no second email, no second notification.
 *
 * At most one pending invite per (wishlist, invitee) is enforced by the unique
 * partial index on `WishlistInvite`, so two concurrent calls can't both create
 * one: the loser's insert fails with a duplicate-key error and is answered as
 * "already pending". The `findOne` before it is only a fast path for the common
 * case — and the sole guard on an environment where the index isn't built.
 *
 * Once the invite exists it is real — the invitee sees it on their Invitations
 * page — so nothing after that depends on the email: the notification is created
 * regardless, and a failed send is logged and swallowed. Failing the call there
 * would tell the inviter it didn't work while leaving the invite in place, and
 * their retry would be refused as already pending.
 */
export async function issueWishlistInvite(args: IssueInviteArgs): Promise<IWishlistInvite | null> {
  const existing = await WishlistInvite.findOne({
    wishlist: args.wishlistId,
    invitedUser: args.invitedUserId,
    status: 'pending',
  });
  if (existing) return null;

  let invite: IWishlistInvite;
  try {
    invite = await WishlistInvite.create({
      wishlist: args.wishlistId,
      invitedBy: args.invitedBy,
      invitedUser: args.invitedUserId,
      role: args.role,
      ...(args.promotion ? { promotion: true } : {}),
    });
  } catch (err) {
    // A concurrent call created the pending invite after our check. It sends the
    // email and the notification; this one sends nothing.
    if (isDuplicateKeyError(err)) return null;
    throw err;
  }

  await createNotification({
    user: args.invitedUserId,
    type: 'wishlist_invite',
    actorUsername: args.actorUsername ?? null,
    wishlist: args.wishlistId,
    wishlistName: args.wishlistName,
  });

  if (args.invitedUserEmail) {
    try {
      await sendWishlistInvitationEmail(args.invitedUserEmail, {
        wishlistName: args.wishlistName,
        role: args.role,
        inviterName: args.inviterName,
        inviterUsername: args.actorUsername ?? null,
      });
    } catch (err) {
      console.error(
        `Wishlist invite ${invite._id} was issued, but its email failed to send:`,
        mailFailure(err)
      );
    }
  }

  return invite;
}

/**
 * Whether an invite is paused: a `member` invite to an archived list. An archived
 * list is its owners' alone, so joining one as a member would leave the invitee
 * on a list they can't open. A paused invite stays pending, but the invitee isn't
 * shown it (`GET /api/users/me/invites`, its `wishlist_invite` notification) and
 * can't accept it, and no new one can be issued. Unarchiving the list resumes it.
 * An `owner` invite never pauses: owners see an archived list, so management can
 * still be handed over.
 */
export function isInvitePaused(
  invite: Pick<IWishlistInvite, 'role'>,
  wishlist: Pick<IWishlist, 'archived'>
): boolean {
  return invite.role !== 'owner' && !!wishlist.archived;
}

/**
 * The lists on which `userId` holds a paused invite (see `isInvitePaused`), whose
 * `wishlist_invite` notifications are kept out of their feed while they stay so.
 */
export async function pausedInviteWishlistIds(userId: Id): Promise<mongoose.Types.ObjectId[]> {
  const invites = await WishlistInvite.find({
    invitedUser: userId,
    status: 'pending',
    role: { $ne: 'owner' },
  })
    .select('wishlist')
    .lean();
  if (invites.length === 0) return [];
  const archived = await Wishlist.find({
    _id: { $in: invites.map((i) => i.wishlist) },
    archived: true,
  })
    .select('_id')
    .lean();
  return archived.map((w) => w._id);
}

/**
 * Cancel the invites a user still has pending on a wishlist they've just left or
 * lost a role on (leave, kick, owner removal, demotion), along with the
 * `wishlist_invite` notifications that point them at those invites. (The invites
 * a removed or demoted owner *sent* go through `cancelInvitesSentBy`.)
 *
 * Accepting an invite grants the role it names, so a leftover one lets the person
 * who was removed undo it: an `owner` invite brings a kicked member back as a
 * co-owner, and a demoted owner back to owner. Accept can't just refuse
 * non-members, because `owner` invites legitimately go to non-members too.
 *
 * When to call it depends on the write it goes with:
 *   - An owner write that can be refused (remove-owner, demote, a co-owner
 *     leaving): only once it has landed. Never before it, and never when
 *     `removeWishlistOwner` refused it.
 *   - The membership delete of a kick or of a member leaving: both before and
 *     after it. Before, so that once someone is off the list none of their
 *     invites is still pending. Accept tells whether an `owner` invite without
 *     the `promotion` mark is one by reading the membership before it claims the
 *     invite, and would otherwise take a just-kicked member for a newcomer and
 *     grant the role. After, for an invite a promotion issued between the first
 *     cancel and the delete.
 *
 * Only *pending* invites go. Accepted and declined rows are kept on purpose. An
 * invite that accept has already claimed isn't pending any more, so this never
 * pulls one out from under an accept in flight: `promoteMemberToOwner` settles
 * that race on the membership row instead.
 *
 * The invite delete is the fix itself, so its failure propagates and the request
 * reports an error rather than a clean success. A retry can finish the job, and
 * until then a leftover invite still shows in the owners' Pending invites panel,
 * where they can cancel it.
 *
 * The notification cleanup is best-effort, like a deleted wishlist's: a failure is
 * logged and swallowed. Notifications carry no invite id, so it runs only when a
 * pending invite was actually cancelled, and then clears every `wishlist_invite`
 * notification this person has for the list, including one left by an invite they
 * answered earlier. None of them has anything left to act on.
 */
export async function cancelPendingInvites(wishlistId: Id, userId: Id): Promise<void> {
  const { deletedCount } = await WishlistInvite.deleteMany({
    wishlist: wishlistId,
    invitedUser: userId,
    status: 'pending',
  });
  if (deletedCount) await clearInviteNotifications(wishlistId, userId);
}

/**
 * Cancel the invites an owner sent for a list, once they've lost ownership of it
 * against their will: another owner removed or demoted them. An owner who was
 * taken off the owners shouldn't still be bringing people onto the list (as
 * co-owners, even) after the fact. An owner who leaves of their own accord keeps
 * theirs: those stay the list's, and any owner can still cancel them from the
 * Pending invites panel.
 *
 * Call it only once the removal or demotion has landed (`removeWishlistOwner`
 * returned `'removed'`), never before it, and never for a refused one.
 *
 * Each invite goes in its own conditional delete on the pending row, the one an
 * owner's cancel uses, so it races accept and decline the same way: exactly one
 * of them lands. An invite the invitee has already claimed isn't pending, so it
 * isn't touched, and that accept completes. Answered rows are kept.
 *
 * An invite issued after the read below, by a request that checked its caller's
 * ownership before the removal landed, is taken back by that request itself: the
 * invite routes re-check the inviter's ownership once the invite exists
 * (`withdrawUnlessInviterOwns`).
 *
 * As in `cancelPendingInvites`, the invite delete is the fix, so its failure
 * propagates, and the notification cleanup is best-effort.
 */
export async function cancelInvitesSentBy(wishlistId: Id, inviterId: Id): Promise<void> {
  const sent = await WishlistInvite.find({
    wishlist: wishlistId,
    invitedBy: inviterId,
    status: 'pending',
  })
    .select('_id')
    .lean();
  // Each invite is its own, so they go side by side.
  await Promise.all(
    sent.map(async ({ _id }) => {
      // Before the delete, so a re-invite landing after it keeps its notification.
      const cancelledAt = new Date();
      const invite = await WishlistInvite.findOneAndDelete({
        _id,
        wishlist: wishlistId,
        status: 'pending',
      });
      if (invite) await clearCancelledInviteNotifications(invite, cancelledAt);
    })
  );
}

/**
 * Take back an invite its request has just issued if the inviter stopped owning
 * the list meanwhile: a co-owner removed or demoted them (or they left) after the
 * request last checked. That removal's `cancelInvitesSentBy` may have read the
 * pending invites before this one existed, so this request has to do it. Of the
 * two, at least one sees the other: the removal's write lands before its read of
 * the invites, and this check runs after the invite is written.
 *
 * Returns whether the invite was withdrawn, and then the request answers as it
 * would any non-owner. `false` when the inviter still owns the list, and also when
 * the invitee has already answered the invite (`withdrawInvite`): an accept that
 * claimed it first completes, as one that beats a removal's cleanup does.
 */
export async function withdrawUnlessInviterOwns(
  invite: Pick<IWishlistInvite, '_id' | 'wishlist' | 'invitedUser' | 'invitedBy'>
): Promise<boolean> {
  const list = await Wishlist.findById(invite.wishlist).select('owners').lean();
  if (list && isWishlistOwner(list, invite.invitedBy.toString())) return false;
  return withdrawInvite(invite, 'pending');
}

/**
 * Clear the `wishlist_invite` notification of an invite that an owner cancelled
 * (by hand, or by removing or demoting whoever sent it). It links to /invites and
 * looks actionable, but there's nothing left there to accept. Notifications carry
 * no invite id, which bounds what may go:
 *  - only while no other pending invite for this person and list remains: the
 *    unique pending index allows one at most, but only once it's built;
 *  - only notifications from before `cancelledAt`, taken before the invite was
 *    deleted, so a re-invite landing in between keeps its own.
 * An invite that was already accepted or declined is never cancelled, so its
 * notification, which is history by then, is never reached.
 *
 * Best-effort: the invite is already gone, so a failure is logged and swallowed:
 * the invite's id, which is all a repair by hand needs and names nobody (the row
 * is deleted), and the error by its kind only, since a driver error can quote
 * the filter, the invitee's id included.
 */
export async function clearCancelledInviteNotifications(
  invite: Pick<IWishlistInvite, '_id' | 'wishlist' | 'invitedUser'>,
  cancelledAt: Date
): Promise<void> {
  try {
    const stillPending = await WishlistInvite.exists({
      wishlist: invite.wishlist,
      invitedUser: invite.invitedUser,
      status: 'pending',
    });
    if (stillPending) return;
    await Notification.deleteMany({
      user: invite.invitedUser,
      wishlist: invite.wishlist,
      type: 'wishlist_invite',
      createdAt: { $lt: cancelledAt },
    });
  } catch (err) {
    console.error(
      `Notification cleanup failed for cancelled invite ${invite._id}:`,
      errorKind(err)
    );
  }
}

/**
 * Take back one invite that a concurrent removal's `cancelPendingInvites` (or a
 * list delete's invite cleanup) missed, as that cleanup would have:
 *   - `pending`: a promotion found the member gone right after issuing it.
 *   - `accepted`: accept had already claimed it when the invitee was taken off
 *     the list, and found their membership gone before granting anything. Or the
 *     list was deleted under the accept, which then granted nothing.
 *
 * The row goes only while it still has that status. Returns whether the invite is
 * gone now: `false` means it has been answered since, so it wasn't this call's to
 * take back, and nothing was changed.
 *
 * Unlike `cancelPendingInvites`, this clears the notifications even when the row
 * was already gone: the invite was issued with one, and a removal's cancel may
 * have deleted the row before that notification was written.
 */
export async function withdrawInvite(
  invite: Pick<IWishlistInvite, '_id' | 'wishlist' | 'invitedUser'>,
  status: 'pending' | 'accepted'
): Promise<boolean> {
  const { deletedCount } = await WishlistInvite.deleteOne({ _id: invite._id, status });
  // Not deleted but still there: it was answered in the meantime.
  if (!deletedCount && (await WishlistInvite.exists({ _id: invite._id }))) return false;
  await clearInviteNotifications(invite.wishlist, invite.invitedUser);
  return true;
}

/** Best-effort: a failure is logged and swallowed, never failing the request. */
async function clearInviteNotifications(wishlistId: Id, userId: Id): Promise<void> {
  try {
    await Notification.deleteMany({ user: userId, wishlist: wishlistId, type: 'wishlist_invite' });
  } catch (err) {
    // No wishlist id: this runs when someone leaves a list or loses a role on it,
    // and the logs must not record who left which list.
    console.error('Invite notification cleanup failed:', err);
  }
}
