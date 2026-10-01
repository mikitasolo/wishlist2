import mongoose from 'mongoose';
import WishlistInvite, { IWishlistInvite } from '@/models/WishlistInvite';
import Notification from '@/models/Notification';
import { sendWishlistInvitationEmail } from '@/lib/email';
import { createNotification } from '@/lib/notifications';

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
  /** Inviter's username for the in-app notification, or null to stay anonymous. */
  actorUsername?: string | null;
  invitedUserId: Id;
  /** Account email of the invitee — fetched by the caller, never stored on the invite. */
  invitedUserEmail?: string | null;
}

/** MongoDB's duplicate-key error — here, the unique pending-invite index refusing a second row. */
function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

/**
 * What this layer logs about a failed invite email: enough to tell a bad address
 * from a dead transport, but not the error message — an SMTP rejection quotes the
 * recipient's address.
 */
function mailFailure(err: unknown) {
  if (typeof err !== 'object' || err === null) return { name: typeof err };
  const { name, code, responseCode } = err as Record<string, unknown>;
  return { name, code, responseCode };
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
      await sendWishlistInvitationEmail(args.invitedUserEmail, args.wishlistName, args.inviterName);
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
 * Cancel the invites a user still has pending on a wishlist they've just left or
 * lost a role on (leave, kick, owner removal, demotion), along with the
 * `wishlist_invite` notifications that point them at those invites.
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
 * Take back one invite that a concurrent removal's `cancelPendingInvites` missed,
 * as that cancel would have:
 *   - `pending`: a promotion found the member gone right after issuing it.
 *   - `accepted`: accept had already claimed it when the invitee was taken off
 *     the list, and found their membership gone before granting anything.
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
    console.error(`Invite notification cleanup failed for wishlist ${wishlistId}:`, err);
  }
}
