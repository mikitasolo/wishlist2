import { NextRequest, NextResponse } from 'next/server';
import type mongoose from 'mongoose';
import { auth } from '@/lib/auth';
import connectDB from '@/lib/mongodb';
import { enforce, ipKey, userKey } from '@/lib/rateLimit';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import { createNotifications } from '@/lib/notifications';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { isWishlistOwner, ownerIds } from '@/lib/utils/wishlistOwners';
import { isDuplicateKeyError } from '@/lib/utils/mongoErrors';
import { errorKind } from '@/lib/utils/errorKind';
import { isShareTokenFormat, SHARE_TOKEN_HEADER } from '@/lib/utils/shareLinkFields';
import {
  admitListViewer,
  linkModeAnswer,
  wishlistNotFoundResponse,
} from '@/lib/utils/shareLinkAccess';
import { isBlockedFromShareLinks } from '@/lib/utils/linkBlocks';
import { withdrawInvite } from '@/lib/utils/wishlistInvites';
import { endPendingJoinRequest } from '@/lib/utils/joinRequests';

/**
 * POST /api/wishlists/[id]/join — join a list as a member through one of its
 * **Join** share links (WIS-337). The link travels in `X-Share-Token`, never
 * in the URL. The joiner's consent is the confirmation they clicked; the
 * owners' is having made the link. A link never makes anyone an owner.
 *
 * - Signed out → 401, before any lookup (it says nothing about the list).
 * - No header, a malformed / unknown / revoked / expired token, another list's
 *   token, an archived or missing list, a **View** link, or a caller kicked
 *   from the list (`WishlistLinkBlock`) → the dead link's `Wishlist not found`
 *   404, all alike. Failed lookups spend the IP's `shareLinkInvalid` budget.
 * - An owner → 409 "You already own this list"; a member → 200, nothing done
 *   and nobody notified.
 * - Otherwise, limited as `linkJoin` (new-account tier), the membership is
 *   upserted with `viaLink` (the owners' per-link joined count). Then the list
 *   and the block are **read again**: if the list is gone or archived, the
 *   caller is now an owner (`addWishlistOwner` / `promoteMemberToOwner`
 *   raced), or a kick's block appeared, only the row this call created is
 *   deleted and the join is refused (the owner's 409, else the 404). A kick
 *   whose block lands after that re-read takes the row itself
 *   (`removeRacingLinkJoins`).
 * - Once it stands: a pending **member** invite to them is settled (one
 *   conditional delete on the pending row, its notification cleared; no
 *   `invite_accepted`), a pending **owner** invite stays pending, and their
 *   request to join ends. Becoming a member releases nothing.
 * - Every owner gets `link_join` (`createNotifications`): in-app per join, by
 *   email at most once per list per owner a day.
 *
 * Every answer to a request carrying the header is `private, no-store`.
 */

const alreadyOwner = () =>
  NextResponse.json({ success: false, error: 'You already own this list' }, { status: 409 });

const joinedAnswer = (
  list: { _id: mongoose.Types.ObjectId; slug?: string | null },
  alreadyMember: boolean
) =>
  NextResponse.json(
    {
      success: true,
      ...(alreadyMember ? { message: 'You’re already on this list' } : {}),
      data: {
        joined: true,
        alreadyMember,
        wishlistId: list._id.toString(),
        wishlistSlug: list.slug ?? null,
      },
    },
    { status: 200 }
  );

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = request.headers.get(SHARE_TOKEN_HEADER);
  // Only a request that carries a link gets the link-mode headers.
  const answer = <T extends Response>(response: T): T =>
    token === null ? response : linkModeAnswer(response);
  try {
    const session = await auth();
    if (!session?.user) {
      return answer(
        NextResponse.json(
          { success: false, error: 'Unauthorized - Please sign in' },
          { status: 401 }
        )
      );
    }
    const userId = session.user.id;

    // A join only ever comes through a link. No header: nothing was tried.
    if (token === null) return answer(wishlistNotFoundResponse());
    // The token's shape before any query, as everywhere a token arrives.
    if (!isShareTokenFormat(token)) {
      const limited = await enforce('shareLinkInvalid', ipKey(request.headers));
      return answer(limited ?? wishlistNotFoundResponse());
    }

    const { id: idParam } = await params;
    await connectDB();
    const id = await resolveWishlistId(idParam);
    const wishlist = id ? await Wishlist.findById(id) : null;
    if (!id || !wishlist) return answer(wishlistNotFoundResponse());

    // Live, this list's, and the caller not kicked (else the 404 or the 429).
    const admission = await admitListViewer(request, wishlist, userId);
    if (!admission.allowed) return answer(admission.response);
    const link = admission.link;
    // A View link opens the list; only a Join link joins it.
    if (!link || link.level !== 'join') return answer(wishlistNotFoundResponse());

    if (admission.isOwner) return answer(alreadyOwner());
    if (admission.isMember) return answer(joinedAnswer(wishlist, true));

    // Each join notifies every owner. Only once the caller may join, so a 429
    // can't stand in for an answer about the link.
    const limited = await enforce('linkJoin', userKey(userId), {
      newAccount: session.user.newAccount,
    });
    if (limited) return answer(limited);

    // Membership carries no role: one row per person and list. `upsertedId` is
    // the row this call created, null when one was already there (a join from
    // another tab, an invite accepted meanwhile): nothing to undo or announce.
    let createdId: mongoose.Types.ObjectId | null;
    try {
      const result = await WishlistMember.updateOne(
        { wishlist: wishlist._id, user: userId },
        { $setOnInsert: { wishlist: wishlist._id, user: userId, viaLink: link._id } },
        { upsert: true }
      );
      createdId = (result.upsertedId as mongoose.Types.ObjectId | null) ?? null;
    } catch (err) {
      // Two inserts at once: the other one made the row.
      if (!isDuplicateKeyError(err)) throw err;
      createdId = null;
    }
    if (!createdId) return answer(joinedAnswer(wishlist, true));

    // Read again now the row exists: what changed while it was being written
    // can't be undone by the write, so the row is. Only this call's row, by its
    // id: a membership held before isn't this join's to take.
    const [current, blocked] = await Promise.all([
      Wishlist.findById(wishlist._id).select('owners archived name slug'),
      isBlockedFromShareLinks(wishlist._id, userId),
    ]);
    if (!current || current.archived || blocked || isWishlistOwner(current, userId)) {
      await WishlistMember.deleteOne({ _id: createdId });
      if (current && !current.archived && !blocked && isWishlistOwner(current, userId)) {
        return answer(alreadyOwner());
      }
      return answer(wishlistNotFoundResponse());
    }

    await Promise.all([
      settlePendingMemberInvite(wishlist._id, userId),
      // On the list now, so a request to join it is over (best-effort).
      endPendingJoinRequest(wishlist._id, userId),
    ]);

    // Every owner, by the joiner's public handle (never an email), and the
    // link by its label. The emails wait for the membership to still stand
    // once the rows are written: an email can't be taken back.
    const stillMember = async () => !!(await WishlistMember.exists({ _id: createdId }));
    await createNotifications(
      ownerIds(current),
      {
        type: 'link_join',
        actorUsername: session.user.username ?? null,
        actor: userId,
        wishlist: wishlist._id,
        wishlistName: current.name,
        wishlistSlug: current.slug ?? null,
        linkLabel: link.label ?? null,
      },
      { stillHolds: stillMember }
    );

    return answer(joinedAnswer(current, false));
  } catch (error) {
    // By kind: a duplicate-key error would quote what it collided on.
    console.error('Error joining through a share link:', errorKind(error));
    return answer(
      NextResponse.json({ success: false, error: 'Failed to join the list' }, { status: 500 })
    );
  }
}

/**
 * A pending `member` invite to someone who has just joined through a link has
 * nothing left to offer: it goes, in the same conditional delete on the
 * pending row an owner's cancel uses (`withdrawInvite`), so an accept racing
 * it lands exactly once, and its `wishlist_invite` notification with it. No
 * `invite_accepted`: they didn't accept it. A pending `owner` invite stays: a
 * link never grants ownership, and only accepting it can. Best-effort: the
 * join has landed.
 */
async function settlePendingMemberInvite(
  wishlistId: mongoose.Types.ObjectId,
  userId: string
): Promise<void> {
  try {
    const invite = await WishlistInvite.findOne({
      wishlist: wishlistId,
      invitedUser: userId,
      status: 'pending',
      role: 'member',
    }).select('_id wishlist invitedUser');
    if (invite) await withdrawInvite(invite, 'pending');
  } catch (err) {
    console.error('Settling a pending invite after a link join failed:', errorKind(err));
  }
}
