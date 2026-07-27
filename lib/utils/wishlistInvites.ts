import mongoose from 'mongoose';
import WishlistInvite, { IWishlistInvite } from '@/models/WishlistInvite';
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

/**
 * Create a pending invite and tell the invitee about it (email + in-app
 * notification). Membership/ownership is only granted when they accept, so this
 * is also the promotion path for co-ownership.
 *
 * Returns `null` when the invitee already has a pending invite for this list.
 */
export async function issueWishlistInvite(args: IssueInviteArgs): Promise<IWishlistInvite | null> {
  const existing = await WishlistInvite.findOne({
    wishlist: args.wishlistId,
    invitedUser: args.invitedUserId,
    status: 'pending',
  });
  if (existing) return null;

  const invite = await WishlistInvite.create({
    wishlist: args.wishlistId,
    invitedBy: args.invitedBy,
    invitedUser: args.invitedUserId,
    role: args.role,
  });

  if (args.invitedUserEmail) {
    await sendWishlistInvitationEmail(args.invitedUserEmail, args.wishlistName, args.inviterName);
  }

  await createNotification({
    user: args.invitedUserId,
    type: 'wishlist_invite',
    actorUsername: args.actorUsername ?? null,
    wishlist: args.wishlistId,
    wishlistName: args.wishlistName,
  });

  return invite;
}
