import mongoose from 'mongoose';
import type { IWishlist } from '@/models/Wishlist';
import type { IWishlistInvite } from '@/models/WishlistInvite';
import type { IUser } from '@/models/User';
import { areFriends } from '@/lib/utils/friends';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';
import {
  INVITE_REFUSAL,
  PENDING_INVITE_CAP_ERROR,
  issueWishlistInvite,
  type IssueInviteArgs,
} from '@/lib/utils/wishlistInvites';

/**
 * The per-person rules of inviting someone to a list, shared by the single
 * invite (`POST /api/wishlists/[id]/members`) and a group's fan-out
 * (`POST /api/wishlists/[id]/members/group`, WIS-37), so the two can't drift.
 * Each check answers the refusal both routes give for it, in `INVITE_REFUSAL`'s
 * words, with the status the single invite answers it with; the routes pick
 * the order (the single invite reads `whoCanInvite` first, the group spends a
 * rate-limit token before it).
 */
export interface InviteRefusal {
  error: string;
  status: 400 | 403 | 429;
}

type Invitee = Pick<IUser, 'username' | 'privacy'> & { _id: mongoose.Types.ObjectId };

/** The invitee's "who can invite me" preference (`privacy.whoCanInvite`). */
export async function whoCanInviteRefusal(
  inviterId: string,
  invitee: Pick<Invitee, '_id' | 'privacy'>
): Promise<InviteRefusal | null> {
  const policy = invitee.privacy?.whoCanInvite ?? 'everyone';
  if (policy === 'nobody') return { error: INVITE_REFUSAL.nobody, status: 403 };
  if (policy === 'friends' && !(await areFriends(inviterId, invitee._id.toString()))) {
    return { error: INVITE_REFUSAL.friendsOnly, status: 403 };
  }
  return null;
}

/**
 * Where the invitee already stands on the list: an owner can't be invited, and
 * a member is promoted from their row, never re-invited. `isMember` is the
 * caller's own read of their membership.
 */
export function listStandingRefusal(
  wishlist: Pick<IWishlist, 'owners'>,
  inviteeId: string,
  { isMember, role }: { isMember: boolean; role: IWishlistInvite['role'] }
): InviteRefusal | null {
  if (isWishlistOwner(wishlist, inviteeId)) return { error: INVITE_REFUSAL.owner, status: 400 };
  if (isMember) {
    return {
      error: role === 'owner' ? INVITE_REFUSAL.memberAsOwner : INVITE_REFUSAL.member,
      status: 400,
    };
  }
  return null;
}

/**
 * Issue the invite (`issueWishlistInvite`), answering its two refusals as both
 * routes do: one already pending, and the invitee at `PENDING_INVITE_CAP`.
 */
export async function issueInvite(
  args: IssueInviteArgs
): Promise<{ invite: IWishlistInvite } | { refusal: InviteRefusal }> {
  const invite = await issueWishlistInvite(args);
  if (!invite) return { refusal: { error: INVITE_REFUSAL.pending, status: 400 } };
  if (invite === 'capped') return { refusal: { error: PENDING_INVITE_CAP_ERROR, status: 429 } };
  return { invite };
}
