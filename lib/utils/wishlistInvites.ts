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
  invitedBy: Id;
  /** Public name of the inviter, for the email body. Never their email address. */
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
 * case — and the sole guard on an environment where the index isn't built yet
 * (between a deploy and the `dedupe-pending-invites` migration).
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
 * co-owner, and a demoted owner back to owner. Re-checking membership on accept
 * isn't an option, because `owner` invites legitimately go to non-members too.
 *
 * Call it only after the membership/ownership write has landed. Never before it,
 * and never when `removeWishlistOwner` refused it (returned `false`).
 *
 * Only *pending* invites go. Accepted and declined rows are kept on purpose.
 *
 * The invite delete is the fix itself, so its failure propagates and the request
 * reports an error rather than a clean success. The removal has landed by then
 * and a retry stops early, but the leftover invite still shows in the owners'
 * Pending invites panel, where they can cancel it.
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
  if (!deletedCount) return;

  try {
    await Notification.deleteMany({ user: userId, wishlist: wishlistId, type: 'wishlist_invite' });
  } catch (err) {
    console.error(`Invite notification cleanup failed for wishlist ${wishlistId}:`, err);
  }
}
