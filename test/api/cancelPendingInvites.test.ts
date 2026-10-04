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
  POST as promote,
  PATCH as demote,
  DELETE as removeOwner,
} from '@/app/api/wishlists/[id]/owners/[userId]/route';
import { PATCH as respondInvite } from '@/app/api/invites/[inviteId]/route';
import { cancelPendingInvites, issueWishlistInvite } from '@/lib/utils/wishlistInvites';
import { sendWishlistInvitationEmail } from '@/lib/email';
import { holdFirstCall } from '../interleave';
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

  const wl = await Wishlist.create({
    name: 'Family list',
    owners: [alice, bob],
    visibility: 'everyone',
  });
  wid = wl._id.toString();
  await WishlistMember.create({ wishlist: wid, user: carol });

  const other = await Wishlist.create({
    name: 'Other list',
    owners: [alice],
    visibility: 'everyone',
  });
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
  if (!invite || invite === 'capped') throw new Error('invite not issued');
  return invite._id.toString();
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

function promoteCarol() {
  as(alice);
  return promote(req(`/api/wishlists/${wid}/owners/${carol}`, 'POST'), {
    params: Promise.resolve({ id: wid, userId: carol }),
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

  it('once it cancels one, clears all their invite notifications for that list only', async () => {
    const answered = await pendingInvite(wid, carol, 'member');
    await WishlistInvite.updateOne({ _id: answered }, { $set: { status: 'accepted' } });
    await pendingInvite(wid, carol, 'owner');
    await pendingInvite(otherId, carol, 'member');
    expect(await invitesNotifications(carol, wid)).toBe(2);

    await cancelPendingInvites(wid, carol);

    // Notifications carry no invite id, and neither of these is actionable now.
    expect(await invitesNotifications(carol, wid)).toBe(0);
    expect(await invitesNotifications(carol, otherId)).toBe(1);
    expect((await WishlistInvite.findById(answered))?.status).toBe('accepted');
  });

  it('is best-effort about the notifications: the invite is still cancelled', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const inviteId = await pendingInvite(wid, carol, 'owner');
    vi.spyOn(Notification, 'deleteMany').mockRejectedValueOnce(new Error('db down'));

    const res = await kickCarol();
    expect(res.status).toBe(200);
    expect(await WishlistInvite.findById(inviteId)).toBeNull();
    expect(error).toHaveBeenCalledWith('Invite notification cleanup failed:', expect.any(Error));
    // regression: the line named the list (`…failed for wishlist <id>`), which put
    // which list carol was removed from into the server log.
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain(wid);
    expect(logged).not.toContain(carol);
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

/**
 * Where carol stands once her removal has won a race: neither an owner nor a
 * member, nothing pending that she could accept, and no notification pointing at
 * an invite.
 */
async function expectCarolOffTheList() {
  expect((await Wishlist.findById(wid))!.owners.map(String)).not.toContain(carol);
  expect(await WishlistMember.exists({ wishlist: wid, user: carol })).toBeNull();
  expect(
    await WishlistInvite.countDocuments({ wishlist: wid, invitedUser: carol, status: 'pending' })
  ).toBe(0);
  expect(await invitesNotifications(carol, wid)).toBe(0);
}

/** Carol accepts the invite she's just been sent while its email is still sending. */
function acceptWhileTheEmailSends() {
  const acceptance: { res?: Response } = {};
  vi.mocked(sendWishlistInvitationEmail).mockImplementationOnce(async () => {
    const invite = await WishlistInvite.findOne({
      wishlist: wid,
      invitedUser: carol,
      status: 'pending',
    });
    acceptance.res = await accept(invite!._id.toString(), carol);
  });
  return acceptance;
}

// Each removal, with what it answers when there was no one left for it to remove.
const carolsRemovals: [string, () => Promise<Response>, RegExp][] = [
  ['an owner kicks her', kickCarol, /membership not found/i],
  ['she leaves', () => leaveAs(carol), /not a member/i],
];

// Carol is a member, and alice has asked her to co-own the list. Each race is run
// in one fixed order (`holdFirstCall`), with both requests past their checks.
describe('a removal racing her accept of a promotion', () => {
  // regression: accept read the invite as pending, granted the role, and only then
  // recorded `accepted`. A kick landing in between cancelled the invite and removed
  // the membership, and the accept then made the member the owners had just
  // removed a co-owner (and failed to save the invite it no longer had, so she saw
  // a 500 while holding the list).
  it.each(carolsRemovals)(
    'regression: %s once her accept has read the invite: the removal wins',
    async (_, remove) => {
      const inviteId = await pendingInvite(wid, carol, 'owner');
      const race = holdFirstCall(WishlistInvite, 'findById', remove, { after: true });

      const accepted = await accept(inviteId, carol);

      expect(race.outcome()?.status).toBe(200);
      expect(accepted.status).toBe(404);
      await expectCarolOffTheList();
      expect(await WishlistInvite.findById(inviteId)).toBeNull();
    }
  );

  // By now the removal's cancel finds nothing pending, so it's the membership row
  // that decides: the removal deletes it first, and the promotion can't take it.
  it.each(carolsRemovals)(
    '%s once her accept has claimed the invite, before it grants anything: the removal wins',
    async (_, remove) => {
      const inviteId = await pendingInvite(wid, carol, 'owner');
      const race = holdFirstCall(WishlistInvite, 'updateOne', remove, { after: true });

      const accepted = await accept(inviteId, carol);

      expect(race.outcome()?.status).toBe(200);
      expect(accepted.status).toBe(404);
      await expectCarolOffTheList();
      // The claimed invite goes too, as the removal's cancel would have taken it,
      // and nobody is told she accepted.
      expect(await WishlistInvite.findById(inviteId)).toBeNull();
      expect(await Notification.countDocuments({ type: 'invite_accepted' })).toBe(0);
    }
  );

  // regression: kick and leave ignored the result of their membership delete, so a
  // kick whose member had just become a co-owner still answered "Member removed".
  it.each(carolsRemovals)(
    'regression: her accept lands first when %s: she co-owns the list, and the removal reports it removed nobody',
    async (_, remove, nobodyRemoved) => {
      const inviteId = await pendingInvite(wid, carol, 'owner');
      // The removal waits at its first invite write, the cancel, while she accepts.
      const race = holdFirstCall(WishlistInvite, 'deleteMany', () => accept(inviteId, carol));

      const removed = await remove();

      expect(race.outcome()?.status).toBe(200);
      expect(removed.status).toBe(404);
      expect((await removed.json()).error).toMatch(nobodyRemoved);
      expect((await Wishlist.findById(wid))!.owners.map(String)).toContain(carol);
      expect(await WishlistMember.exists({ wishlist: wid, user: carol })).toBeNull();
      expect((await WishlistInvite.findById(inviteId))?.status).toBe('accepted');
    }
  );
});

// Carol is a member, and alice asks her to co-own the list while she's removed.
describe('a promotion racing her removal', () => {
  // regression: promotion checked the membership, and issued the owner invite only
  // later. A kick landing in between ran its cancel before the invite existed, so
  // someone who was no longer on the list was left holding a live owner invite.
  it.each(carolsRemovals)(
    'regression: %s between the promotion’s member check and its invite: nothing is left',
    async (_, remove) => {
      const race = holdFirstCall(WishlistInvite, 'create', remove);

      const promoted = await promoteCarol();

      expect(race.outcome()?.status).toBe(200);
      expect(promoted.status).toBe(404);
      await expectCarolOffTheList();
    }
  );

  // The removal's cancel takes the new invite, but the invite's notification is
  // written only after that, so the promotion has to clear it.
  it.each(carolsRemovals)(
    '%s right after the invite is written: neither it nor its notification is left',
    async (_, remove) => {
      const race = holdFirstCall(WishlistInvite, 'create', remove, { after: true });

      const promoted = await promoteCarol();

      expect(race.outcome()?.status).toBe(200);
      expect(promoted.status).toBe(404);
      await expectCarolOffTheList();
    }
  );

  // regression: with the removal already finished, the promotion still issued its
  // invite, and she could accept it before the promotion noticed she'd gone, e.g.
  // while its email was sending. Accept found no membership, took her for a
  // newcomer, and made someone the owners had just removed a co-owner.
  it.each(carolsRemovals)(
    'regression: %s before the promotion’s invite exists, and she accepts it while its email sends: nothing is left',
    async (_, remove) => {
      const race = holdFirstCall(WishlistInvite, 'create', remove);
      const acceptance = acceptWhileTheEmailSends();

      const promoted = await promoteCarol();

      expect(race.outcome()?.status).toBe(200);
      expect(acceptance.res?.status).toBe(404);
      expect(promoted.status).toBe(404);
      await expectCarolOffTheList();
      expect(await WishlistInvite.countDocuments({ wishlist: wid, invitedUser: carol })).toBe(0);
    }
  );

  // Accepting takes her membership row, so the promotion's re-check finds none,
  // and mustn't read that as her having left.
  it('a promotion she accepts while its email is still sending stands', async () => {
    const acceptance = acceptWhileTheEmailSends();

    const promoted = await promoteCarol();

    expect(acceptance.res?.status).toBe(200);
    expect(promoted.status).toBe(202);
    expect((await Wishlist.findById(wid))!.owners.map(String)).toContain(carol);
    expect((await WishlistInvite.findOne({ wishlist: wid, invitedUser: carol }))?.status).toBe(
      'accepted'
    );
    // Her invite notification is history now, like any answered invite's.
    expect(await invitesNotifications(carol, wid)).toBe(1);
  });

  // The promotion's own re-check passes when it lands between the removal's cancel
  // and its delete, so the removal cancels again after its delete.
  it.each(carolsRemovals)(
    '%s and the promotion lands between the removal’s cancel and its delete: nothing is left',
    async (_, remove) => {
      const race = holdFirstCall(WishlistMember, 'deleteOne', promoteCarol);

      const removed = await remove();

      expect(race.outcome()?.status).toBe(202);
      expect(removed.status).toBe(200);
      await expectCarolOffTheList();
    }
  );
});
