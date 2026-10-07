import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { checkRateLimit, userKey } from '@/lib/rateLimit';
import connectDB from '@/lib/mongodb';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite, { type IWishlistInvite } from '@/models/WishlistInvite';
import User from '@/models/User';
import { inviteGroupSchema, validateRequestBody } from '@/lib/validations';
import { resolveWishlistId } from '@/lib/utils/wishlistSlug';
import { getOwnerAccess } from '@/lib/utils/wishlistAccess';
import {
  INVITE_REFUSAL,
  isInvitePaused,
  withdrawUnlessInviterOwns,
} from '@/lib/utils/wishlistInvites';
import {
  issueInvite,
  listStandingRefusal,
  usernameRefusal,
  whoCanInviteRefusal,
} from '@/lib/utils/inviteChecks';
import { groupMemberIds } from '@/lib/utils/peopleGroups';
import { publicDisplayName } from '@/lib/utils/displayName';
import type { GroupInvitePerson, GroupInviteResult } from '@/lib/utils/groupInviteResult';

// One invite (and its email) per person, one after another: up to the `invite`
// budget of them (30), so more time than a single invite gets.
export const maxDuration = 60;

const notOwnerError = () =>
  NextResponse.json(
    { success: false, error: 'Unauthorized - Owner access required' },
    { status: 403 }
  );

const listNotFound = () =>
  NextResponse.json({ success: false, error: 'Wishlist not found' }, { status: 404 });

/**
 * POST /api/wishlists/[id]/members/group — invite one of your groups (WIS-37).
 *
 * Body `{ groupId, role }`. It fans out to one ordinary invite per person in the
 * group, each through `issueWishlistInvite` and each held to every rule a single
 * invite (`POST /members`) is: the invitee's `whoCanInvite`, nobody already an
 * owner, a member or with a pending invite, `PENDING_INVITE_CAP`, and one
 * `invite` rate-limit token per person invited. Nothing links the group to the
 * list afterwards: each person accepts or declines their own invite.
 * The checks are `lib/utils/inviteChecks.ts`, which the single invite uses too.
 * Someone with no username is skipped (invites go by username only).
 *
 * Answers who was invited and who was skipped, each skip with the single
 * invite's wording for its reason (`INVITE_REFUSAL`), plus `notInvited`: how many
 * the `invite` rate limit left out once it ran dry. People are named with
 * `publicDisplayName`, never an email, and only people the caller tagged into
 * their own group are named, so nothing comes back that the caller couldn't
 * learn by inviting each of them by hand.
 *
 * A group that isn't the caller's (or doesn't exist, or a malformed id) is the
 * `Group not found` 404, the same for each.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized - Please sign in' },
        { status: 401 }
      );
    }
    const callerId = session.user.id;

    const { id: idParam } = await params;
    const id = await resolveWishlistId(idParam);
    if (!id) return listNotFound();

    await connectDB();

    // An archived list comes back as no list at all to anyone but its owners.
    const { isOwner, wishlist } = await getOwnerAccess(id, callerId);
    if (!wishlist) return listNotFound();
    if (!isOwner) return notOwnerError();

    const validation = await validateRequestBody(request, inviteGroupSchema);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: validation.status }
      );
    }
    const { groupId, role = 'member' } = validation.data;

    // Only ever the caller's own group, read only through `groupMemberIds`.
    const memberIds = await groupMemberIds(callerId, groupId);
    if (!memberIds) {
      return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 });
    }

    // Re-read ownership right before the first invite, as the single invite does:
    // a co-owner may have taken the caller off meanwhile.
    const current = await getOwnerAccess(id, callerId);
    if (!current.wishlist) return listNotFound();
    if (!current.isOwner) return notOwnerError();
    // A member invite to an archived list would only wait, paused: none is issued,
    // for anyone in the group, with the single invite's answer.
    if (isInvitePaused({ role }, current.wishlist)) {
      return NextResponse.json(
        { success: false, error: 'Unarchive this list to invite members' },
        { status: 409 }
      );
    }

    // Who's a member or has a pending invite is what the owner already sees on
    // the People tab, so it's checked for everyone up front without spending an
    // invite token on them.
    const [users, members, pending] = await Promise.all([
      User.find({ _id: { $in: memberIds } })
        .select('username name email privacy')
        .lean(),
      WishlistMember.find({ wishlist: id, user: { $in: memberIds } })
        .select('user')
        .lean(),
      WishlistInvite.find({ wishlist: id, invitedUser: { $in: memberIds }, status: 'pending' })
        .select('invitedUser')
        .lean(),
    ]);
    const userById = new Map(users.map((u) => [u._id.toString(), u]));
    const memberSet = new Set(members.map((m) => m.user.toString()));
    const pendingSet = new Set(pending.map((i) => i.invitedUser.toString()));

    const invited: GroupInvitePerson[] = [];
    const skipped: (GroupInvitePerson & { reason: string })[] = [];
    const issued: IWishlistInvite[] = [];
    let notInvited = 0;
    let rateLimited = false;

    for (const userId of memberIds) {
      const user = userById.get(userId);
      if (!user) continue; // deleted since the group was read
      const person: GroupInvitePerson = {
        id: userId,
        username: user.username ?? null,
        displayName: publicDisplayName(user),
      };
      const skip = (reason: string) => skipped.push({ ...person, reason });

      // Free skips, from what the owner already sees (their group, the People
      // tab), before any token is spent. Invites go by username only, so someone
      // without one is never invited, as no single invite could reach them.
      const upFront =
        usernameRefusal(user) ??
        listStandingRefusal(current.wishlist, userId, { isMember: memberSet.has(userId), role });
      if (upFront) {
        skip(upFront.error);
        continue;
      }
      if (pendingSet.has(userId)) {
        skip(INVITE_REFUSAL.pending);
        continue;
      }

      // One `invite` token per person, as if each were invited by hand. Once the
      // limit runs dry the rest aren't tried at all, and are only counted.
      if (!rateLimited) {
        rateLimited = !(await checkRateLimit('invite', userKey(callerId), {
          newAccount: session.user.newAccount,
        }));
      }
      if (rateLimited) {
        notInvited++;
        continue;
      }

      const refusedByPolicy = await whoCanInviteRefusal(callerId, user);
      if (refusedByPolicy) {
        skip(refusedByPolicy.error);
        continue;
      }

      const result = await issueInvite({
        wishlistId: id,
        wishlistName: current.wishlist.name,
        role,
        invitedBy: callerId,
        inviterName: publicDisplayName(session.user),
        actorUsername: session.user.username ?? null,
        invitedUserId: user._id,
        invitedUserEmail: user.email,
      });
      // Already pending (a racing invite), or at the pending-invite cap.
      if ('refusal' in result) {
        skip(result.refusal.error);
        continue;
      }
      const { invite } = result;
      // As the single invite does: a removal's `cancelInvitesSentBy` may have read
      // the caller's pending invites before this one existed. If they've lost the
      // list, this one is taken back, and so is every other this request issued
      // (any of them may postdate that read), and the answer is a non-owner's.
      if (await withdrawUnlessInviterOwns(invite)) {
        await Promise.all(issued.map((earlier) => withdrawUnlessInviterOwns(earlier)));
        const after = await getOwnerAccess(id, callerId);
        if (!after.wishlist) return listNotFound();
        return notOwnerError();
      }
      issued.push(invite);
      invited.push(person);
    }

    const data: GroupInviteResult = { invited, skipped, notInvited };
    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error) {
    console.error('Error inviting a group:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to invite the group' },
      { status: 500 }
    );
  }
}
