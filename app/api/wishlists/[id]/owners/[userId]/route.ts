import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforce, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import User from '@/models/User';
import type { IWishlist } from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { getOwnerAccess } from '@/lib/utils/wishlistAccess';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';
import {
  isLastOwner,
  type OwnerRemoval,
  releaseUserBookings,
  removeWishlistOwner,
} from '@/lib/utils/wishlistOwnership';
import {
  cancelPendingInvites,
  issueWishlistInvite,
  withdrawInvite,
} from '@/lib/utils/wishlistInvites';
import { publicDisplayName } from '@/lib/utils/displayName';
import { isObjectIdParam } from '@/lib/utils/objectId';
import { createNotification } from '@/lib/notifications';

/**
 * Who owns a wishlist. Owners have no `WishlistMember` row (they live in
 * `Wishlist.owners`), so they're addressed here by *user* id — the `_id` the
 * members listing returns for an owner row.
 *
 *   POST   → invite an existing member to become a co-owner (promotion; needs
 *            their accept). Non-members are invited through POST /members instead.
 *   PATCH  → demote this owner to a plain member
 *   DELETE → remove this owner from the wishlist entirely
 *
 * All three are owner-only. PATCH/DELETE additionally refuse the last owner (a
 * wishlist with no owner is unmanageable — delete it instead) and refuse to act on
 * yourself: demoting yourself is a self-role-change, removing yourself is "leave".
 */
async function requireOwnerCaller(
  wishlistIdParam: string,
  callerId: string
): Promise<{ ok: false; response: NextResponse } | { ok: true; id: string; wishlist: IWishlist }> {
  const id = await resolveWishlistId(wishlistIdParam);
  if (!id) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 }),
    };
  }

  const { isOwner, wishlist } = await getOwnerAccess(id, callerId);
  if (!wishlist) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 }),
    };
  }
  if (!isOwner) return { ok: false, response: notOwnerError() };

  return { ok: true, id, wishlist };
}

const notOwnerError = () =>
  NextResponse.json(
    { success: false, error: 'Only an owner can change who owns this wishlist' },
    { status: 403 }
  );

const lastOwnerError = () =>
  NextResponse.json(
    {
      success: false,
      error: 'A wishlist needs at least one owner. Delete the wishlist instead.',
    },
    { status: 400 }
  );

/** Extra guards for acting on an *existing* owner (demote / remove). */
function checkExistingOwner(wishlist: IWishlist, userId: string): NextResponse | null {
  if (!isWishlistOwner(wishlist, userId)) {
    return NextResponse.json(
      { success: false, error: 'This person is not an owner of this wishlist' },
      { status: 404 }
    );
  }
  if (isLastOwner(wishlist, userId)) return lastOwnerError();
  return null;
}

/**
 * The answer to a demote/remove whose write changed nothing. A caller whom a
 * concurrent request just took off the owners gets what any non-owner gets.
 */
const removalRefused = (result: Exclude<OwnerRemoval, 'removed'>) =>
  result === 'actor-not-owner' ? notOwnerError() : lastOwnerError();

// POST /api/wishlists/[id]/owners/[userId] - invite a member to become a co-owner.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const session = await auth();
    const { id: idParam, userId } = await params;

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    await connectDB();

    const authorized = await requireOwnerCaller(idParam, session.user.id);
    if (!authorized.ok) return authorized.response;
    const { id, wishlist } = authorized;

    if (isWishlistOwner(wishlist, userId)) {
      return NextResponse.json(
        { success: false, error: 'This person already owns this wishlist' },
        { status: 400 }
      );
    }

    // Promotion is only for people already on the list — anyone else is invited
    // through POST /members, which honours their `whoCanInvite`. Without this, an
    // owner could send an owner invite to any user id. "Not a member", "no such
    // user" and a malformed id all get the same 404, so it can't probe who exists.
    // Checked before the rate limit: a request that sends nothing shouldn't spend
    // the budget, and it tells an owner nothing their members list doesn't.
    const notAMember = () =>
      NextResponse.json(
        { success: false, error: "This person isn't a member of this wishlist" },
        { status: 404 }
      );
    if (!isObjectIdParam(userId)) return notAMember();
    const [membership, target] = await Promise.all([
      WishlistMember.exists({ wishlist: id, user: userId }),
      User.findById(userId).select('email username'),
    ]);
    if (!membership || !target) return notAMember();

    // This sends mail, so it carries the same budget as the invite route.
    const limited = await enforce('invite', userKey(session.user.id));
    if (limited) return limited;

    // The owner check above ran against the list as it was read at the start of
    // the request. Re-read it right before the invite is issued: a co-owner may
    // have removed the caller since (or deleted the list), and someone who no
    // longer owns the list can't offer anyone a share of it. Like the kick's
    // re-read, this narrows the race rather than closing it: the invite lives on
    // another collection, so it can't carry the ownership check itself.
    const current = await getOwnerAccess(id, session.user.id);
    if (!current.wishlist) {
      return NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });
    }
    if (!current.isOwner) return notOwnerError();

    // Promotion is consent-gated: co-ownership puts the list on their public
    // profile and cancels the reservations they hold on it, so it can never be a
    // silent write. Their `whoCanInvite` preference isn't re-checked — membership
    // was verified above, so they're already on this list by their own choice:
    // this isn't an unsolicited invite, it's a change to a relationship they
    // opted into. Marked as a promotion, so accepting it can only ever turn their
    // membership into ownership, never make a non-member an owner.
    const invite = await issueWishlistInvite({
      wishlistId: id,
      wishlistName: wishlist.name,
      role: 'owner',
      promotion: true,
      invitedBy: session.user.id,
      inviterName: publicDisplayName(session.user),
      actorUsername: session.user.username ?? null,
      invitedUserId: userId,
      invitedUserEmail: target.email,
    });

    if (!invite) {
      return NextResponse.json(
        { success: false, error: 'This person already has a pending invite' },
        { status: 400 }
      );
    }

    // The membership check above ran before the invite existed, so a kick or
    // leave that landed since then cancelled their invites while this one wasn't
    // there to cancel. Check again now that it is, and take it back if they've
    // gone. (A removal that is still running cancels once more after its delete,
    // which covers this check landing just before that delete.) Accepting takes
    // the membership row too, so no row can also mean they've accepted already:
    // `withdrawInvite` leaves an answered invite alone, and the promotion stands.
    // The email has gone out by now; the invite it points at is what counts.
    if (
      !(await WishlistMember.exists({ wishlist: id, user: userId })) &&
      (await withdrawInvite(invite, 'pending'))
    ) {
      return notAMember();
    }

    return NextResponse.json(
      { success: true, data: { pending: true, role: 'owner', inviteId: invite._id } },
      { status: 202 }
    );
  } catch (error) {
    console.error('Error inviting owner:', error);
    return NextResponse.json({ success: false, error: 'Failed to invite owner' }, { status: 500 });
  }
}

// PATCH /api/wishlists/[id]/owners/[userId] - demote an owner to a plain member.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const session = await auth();
    const { id: idParam, userId } = await params;

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    await connectDB();

    if (userId === session.user.id) {
      return NextResponse.json(
        { success: false, error: 'You cannot change your own role' },
        { status: 403 }
      );
    }

    const authorized = await requireOwnerCaller(idParam, session.user.id);
    if (!authorized.ok) return authorized.response;

    const invalid = checkExistingOwner(authorized.wishlist, userId);
    if (invalid) return invalid;

    // Losing ownership also drops their dashboard pin for this list (per-owner).
    // Nothing to release: they land as a member, who can see and cancel their own
    // bookings — the stranded-booking problem only runs the other way. Not
    // `'removed'`: a concurrent removal took the caller off the owners, or left
    // the target the last one, so nothing was changed.
    const removal = await removeWishlistOwner(authorized.wishlist, userId, {
      actorId: session.user.id,
      keepAsMember: true,
    });
    if (removal !== 'removed') return removalRefused(removal);

    // Nothing left for them to accept: a pending invite would undo the demotion.
    await cancelPendingInvites(authorized.id, userId);

    // Only now that it has landed. Just to them, and without naming who did it.
    // Links to the list, which they can still open as a member (unless it's
    // archived, which is owner-only until it's unarchived).
    await createNotification({
      user: userId,
      type: 'role_changed',
      wishlist: authorized.id,
      wishlistName: authorized.wishlist.name,
      wishlistSlug: authorized.wishlist.slug ?? null,
    });

    const user = await User.findById(userId).select('username image');
    return NextResponse.json({ success: true, data: { role: 'member', user } }, { status: 200 });
  } catch (error) {
    console.error('Error demoting owner:', error);
    return NextResponse.json({ success: false, error: 'Failed to update owner' }, { status: 500 });
  }
}

// DELETE /api/wishlists/[id]/owners/[userId] - remove an owner from the wishlist.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const session = await auth();
    const { id: idParam, userId } = await params;

    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }

    await connectDB();

    if (userId === session.user.id) {
      return NextResponse.json(
        { success: false, error: 'Cannot remove yourself. Leave the wishlist instead.' },
        { status: 400 }
      );
    }

    const authorized = await requireOwnerCaller(idParam, session.user.id);
    if (!authorized.ok) return authorized.response;

    const invalid = checkExistingOwner(authorized.wishlist, userId);
    if (invalid) return invalid;

    // Not `'removed'`: a concurrent removal took the caller off the owners, or
    // left the target the last one — release nothing.
    const removal = await removeWishlistOwner(authorized.wishlist, userId, {
      actorId: session.user.id,
      keepAsMember: false,
    });
    if (removal !== 'removed') return removalRefused(removal);
    // Defensive: an owner shouldn't hold a booking on their own list, but if a
    // stale one exists don't leave the item stuck as claimed.
    await releaseUserBookings(authorized.id, userId);
    // Otherwise accepting a leftover invite would bring them straight back.
    await cancelPendingInvites(authorized.id, userId);

    // Just to them, without naming who did it. No slug: the notification doesn't
    // link to a list they may no longer be able to see.
    await createNotification({
      user: userId,
      type: 'removed_from_wishlist',
      wishlist: authorized.id,
      wishlistName: authorized.wishlist.name,
    });

    return NextResponse.json({ success: true, data: {} }, { status: 200 });
  } catch (error) {
    console.error('Error removing owner:', error);
    return NextResponse.json({ success: false, error: 'Failed to remove owner' }, { status: 500 });
  }
}
