import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendWishlistInvitationEmail: vi.fn() }));

import { auth } from '@/lib/auth';
import { DELETE as kick } from '@/app/api/wishlists/[id]/members/[memberId]/route';
import { DELETE as leave } from '@/app/api/wishlists/[id]/members/me/route';
import {
  PATCH as demote,
  DELETE as removeOwner,
} from '@/app/api/wishlists/[id]/owners/[userId]/route';
import { PATCH as respondInvite } from '@/app/api/invites/[inviteId]/route';
import { cancelPendingInvites, issueWishlistInvite } from '@/lib/utils/wishlistInvites';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Notification from '@/models/Notification';

const session = vi.mocked(auth);

function as(userId: string) {
  session.mockResolvedValue({ user: { id: userId } } as never);
}

function req(url: string, method: string, body?: unknown) {
  return new NextRequest('http://localhost' + url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

let alice: string; // owner
let bob: string; // co-owner
let carol: string; // member
let erin: string; // not on the list yet, with an invite of her own
let wid: string; // the list people leave or are removed from
let otherId: string; // another list, which nothing here should touch

beforeAll(async () => {
  await connectTestDB();
  await WishlistInvite.init(); // the unique pending-invite index
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();

  alice = (await User.create({ email: 'a@x.com', username: 'alice' }))._id.toString();
  bob = (await User.create({ email: 'b@x.com', username: 'bob' }))._id.toString();
  carol = (await User.create({ email: 'c@x.com', username: 'carol' }))._id.toString();
  erin = (await User.create({ email: 'e@x.com', username: 'erin' }))._id.toString();

  const wl = await Wishlist.create({ name: 'Family list', owners: [alice, bob] });
  wid = wl._id.toString();
  await WishlistMember.create({ wishlist: wid, user: carol });

  const other = await Wishlist.create({ name: 'Other list', owners: [alice] });
  otherId = other._id.toString();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** An invite issued the only way the app issues one: invite row + notification. */
async function pendingInvite(
  wishlistId: string,
  invitedUserId: string,
  role: 'owner' | 'member' = 'owner'
) {
  const invite = await issueWishlistInvite({
    wishlistId,
    wishlistName: wishlistId === wid ? 'Family list' : 'Other list',
    role,
    invitedBy: alice,
    inviterName: 'alice',
    actorUsername: 'alice',
    invitedUserId,
  });
  expect(invite).not.toBeNull();
  return invite!._id.toString();
}

const invitesNotifications = (user: string, wishlist: string) =>
  Notification.countDocuments({ user, wishlist, type: 'wishlist_invite' });

function accept(inviteId: string, userId: string) {
  as(userId);
  return respondInvite(req(`/api/invites/${inviteId}`, 'PATCH', { action: 'accept' }), {
    params: Promise.resolve({ inviteId }),
  });
}

async function kickCarol() {
  const membership = await WishlistMember.findOne({ wishlist: wid, user: carol });
  const memberId = membership!._id.toString();
  as(bob);
  return kick(req(`/api/wishlists/${wid}/members/${memberId}`, 'DELETE'), {
    params: Promise.resolve({ id: wid, memberId }),
  });
}

function leaveAs(userId: string) {
  as(userId);
  return leave(req(`/api/wishlists/${wid}/members/me`, 'DELETE'), {
    params: Promise.resolve({ id: wid }),
  });
}

function removeBob() {
  as(alice);
  return removeOwner(req(`/api/wishlists/${wid}/owners/${bob}`, 'DELETE'), {
    params: Promise.resolve({ id: wid, userId: bob }),
  });
}

function demoteBob() {
  as(alice);
  return demote(req(`/api/wishlists/${wid}/owners/${bob}`, 'PATCH'), {
    params: Promise.resolve({ id: wid, userId: bob }),
  });
}

// regression: leave, kick, remove-owner and demote changed the membership but left
// the person's pending invites for the list in place, and accepting an invite never
// re-checks anything about membership. So an owner could promote a member, a
// co-owner could kick them, and they'd accept the still-pending promotion and come
// back as a co-owner, undoing a removal the owners had made.
describe('losing your place on a list cancels your pending invites for it', () => {
  const scenarios: [string, () => string, () => Promise<Response>, boolean][] = [
    ['an owner kicks a member', () => carol, kickCarol, false],
    ['a member leaves', () => carol, () => leaveAs(carol), false],
    ['an owner removes a co-owner', () => bob, removeBob, false],
    ['a co-owner leaves', () => bob, () => leaveAs(bob), false],
    ['an owner demotes a co-owner', () => bob, demoteBob, true],
  ];

  it.each(scenarios)(
    'regression: %s, and the leftover owner invite can no longer be accepted',
    async (_, targetOf, act, staysMember) => {
      const target = targetOf();
      // Accepting this one would make them an owner, whatever they are now.
      const inviteId = await pendingInvite(wid, target, 'owner');
      // What must survive: the invite they already answered, their other
      // notifications for this list, their invite to another list, and the
      // pending invite of someone else on this list.
      const answered = await WishlistInvite.create({
        wishlist: wid,
        invitedBy: alice,
        invitedUser: target,
        role: 'member',
        status: 'accepted',
      });
      await Notification.create({
        user: target,
        type: 'proposal_approved',
        wishlist: wid,
        itemName: 'Gift',
      });
      const otherListInvite = await pendingInvite(otherId, target, 'member');
      const erinsInvite = await pendingInvite(wid, erin, 'member');

      const res = await act();
      expect(res.status).toBe(200);

      expect(await WishlistInvite.findById(inviteId)).toBeNull();
      expect(await invitesNotifications(target, wid)).toBe(0);

      expect((await WishlistInvite.findById(answered._id))?.status).toBe('accepted');
      expect(
        await Notification.countDocuments({
          user: target,
          wishlist: wid,
          type: 'proposal_approved',
        })
      ).toBe(1);
      expect((await WishlistInvite.findById(otherListInvite))?.status).toBe('pending');
      expect(await invitesNotifications(target, otherId)).toBe(1);
      expect((await WishlistInvite.findById(erinsInvite))?.status).toBe('pending');
      expect(await invitesNotifications(erin, wid)).toBe(1);

      // The removal sticks: accepting the cancelled invite finds nothing.
      const accepted = await accept(inviteId, target);
      expect(accepted.status).toBe(404);
      expect((await Wishlist.findById(wid))!.owners.map(String)).not.toContain(target);
      const membership = await WishlistMember.findOne({ wishlist: wid, user: target });
      expect(membership !== null).toBe(staysMember);
    }
  );

  it('the other people’s invites can still be accepted', async () => {
    await pendingInvite(wid, carol, 'owner');
    const erinsInvite = await pendingInvite(wid, erin, 'member');

    expect((await kickCarol()).status).toBe(200);

    expect((await accept(erinsInvite, erin)).status).toBe(200);
    expect(await WishlistMember.findOne({ wishlist: wid, user: erin })).not.toBeNull();
  });

  // Cancelling must follow the write, never stand in for it: when the ownership
  // write is refused (a co-owner's concurrent removal got there first and left this
  // person the last owner), nothing changed, so nothing is cancelled either.
  it.each([
    ['a co-owner leaves', () => leaveAs(bob)],
    ['an owner removes a co-owner', removeBob],
    ['an owner demotes a co-owner', demoteBob],
  ])('keeps the pending invite when the owner write is refused: %s', async (_, act) => {
    const inviteId = await pendingInvite(wid, bob, 'member');
    // The owner write finds nothing to change, as it would after that race.
    vi.spyOn(Wishlist, 'updateOne').mockResolvedValueOnce({ modifiedCount: 0 } as never);

    const res = await act();
    expect(res.status).toBe(400);

    expect((await WishlistInvite.findById(inviteId))?.status).toBe('pending');
    expect(await invitesNotifications(bob, wid)).toBe(1);
  });

  it('a refused leave or kick cancels nothing', async () => {
    const carolsInvite = await pendingInvite(wid, carol, 'owner');
    const erinsInvite = await pendingInvite(wid, erin, 'member');

    // Erin isn't on the list, so she has nothing to leave.
    expect((await leaveAs(erin)).status).toBe(404);
    // A member can't kick anyone.
    const membership = await WishlistMember.findOne({ wishlist: wid, user: carol });
    as(carol);
    const kicked = await kick(req(`/api/wishlists/${wid}/members/${membership!._id}`, 'DELETE'), {
      params: Promise.resolve({ id: wid, memberId: membership!._id.toString() }),
    });
    expect(kicked.status).toBe(403);

    expect((await WishlistInvite.findById(erinsInvite))?.status).toBe('pending');
    expect((await WishlistInvite.findById(carolsInvite))?.status).toBe('pending');
  });
});

describe('cancelPendingInvites', () => {
  it('keeps answered invites, and with nothing pending leaves the notifications alone', async () => {
    const inviteId = await pendingInvite(wid, carol, 'member');
    await WishlistInvite.updateOne({ _id: inviteId }, { $set: { status: 'accepted' } });
    await WishlistInvite.create({
      wishlist: wid,
      invitedBy: bob,
      invitedUser: carol,
      role: 'owner',
      status: 'declined',
    });

    await cancelPendingInvites(wid, carol);

    expect(await WishlistInvite.countDocuments({ wishlist: wid, invitedUser: carol })).toBe(2);
    // That notification belongs to an invite they already accepted.
    expect(await invitesNotifications(carol, wid)).toBe(1);
  });

  it('is best-effort about the notifications: the invite is still cancelled', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const inviteId = await pendingInvite(wid, carol, 'owner');
    vi.spyOn(Notification, 'deleteMany').mockRejectedValueOnce(new Error('db down'));

    const res = await kickCarol();
    expect(res.status).toBe(200);
    expect(await WishlistInvite.findById(inviteId)).toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining(wid), expect.any(Error));
  });

  // The invite delete is the whole fix. Swallowing its failure would quietly bring
  // the bug back, so the request reports it instead.
  it('does not swallow a failed invite delete', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await pendingInvite(wid, carol, 'owner');
    vi.spyOn(WishlistInvite, 'deleteMany').mockRejectedValueOnce(new Error('db down'));

    const res = await kickCarol();
    expect(res.status).toBe(500);
  });
});
