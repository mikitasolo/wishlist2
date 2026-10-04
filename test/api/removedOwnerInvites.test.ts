import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendWishlistInvitationEmail: vi.fn() }));

import { auth } from '@/lib/auth';
import { POST as inviteMember } from '@/app/api/wishlists/[id]/members/route';
import { DELETE as leave } from '@/app/api/wishlists/[id]/members/me/route';
import {
  POST as promote,
  PATCH as demote,
  DELETE as removeOwner,
} from '@/app/api/wishlists/[id]/owners/[userId]/route';
import { PATCH as respondInvite } from '@/app/api/invites/[inviteId]/route';
import { issueWishlistInvite } from '@/lib/utils/wishlistInvites';
import { holdFirstCall } from '../interleave';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Notification from '@/models/Notification';

/**
 * What happens to the invites an owner *sent* once they stop being an owner
 * (WIS-91). Removed or demoted by a co-owner: their pending invites go. Leaving
 * of their own accord: they stay, as the list's. Either way, the
 * `invite_accepted` notification never reaches someone who no longer owns the
 * list: it goes to the owners there are.
 */

const session = vi.mocked(auth);

function as(userId: string, username?: string) {
  session.mockResolvedValue({ user: { id: userId, username } } as never);
}

function req(url: string, method: string, body?: unknown) {
  return new NextRequest('http://localhost' + url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

let alice: string; // owner, who removes or demotes bob
let bob: string; // co-owner, whose invites are in question
let hank: string; // a third owner, who never acts
let carol: string; // member
let erin: string; // invited by bob, as a member
let frank: string; // invited by bob, as an owner
let gina: string; // invited by alice
let wid: string;

beforeAll(async () => {
  await connectTestDB();
  await WishlistInvite.init(); // the unique pending-invite index
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();

  const user = async (username: string) =>
    (await User.create({ email: `${username}@x.com`, username }))._id.toString();
  alice = await user('alice');
  bob = await user('bob');
  hank = await user('hank');
  carol = await user('carol');
  erin = await user('erin');
  frank = await user('frank');
  gina = await user('gina');

  wid = (
    await Wishlist.create({
      name: 'Family list',
      owners: [alice, bob, hank],
      visibility: 'everyone',
    })
  )._id.toString();
  await WishlistMember.create({ wishlist: wid, user: carol });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** An invite issued the only way the app issues one: invite row + notification. */
async function sendInvite(from: string, to: string, role: 'owner' | 'member') {
  const invite = await issueWishlistInvite({
    wishlistId: wid,
    wishlistName: 'Family list',
    role,
    invitedBy: from,
    inviterName: 'someone',
    actorUsername: null,
    invitedUserId: to,
  });
  expect(invite).not.toBeNull();
  return invite!._id.toString();
}

const pendingFrom = (from: string) =>
  WishlistInvite.countDocuments({ wishlist: wid, invitedBy: from, status: 'pending' });
const inviteNotifications = (user: string) =>
  Notification.countDocuments({ user, wishlist: wid, type: 'wishlist_invite' });
const acceptedNotices = async () =>
  (await Notification.find({ wishlist: wid, type: 'invite_accepted' }).lean()).map((n) => ({
    user: n.user.toString(),
    actor: n.actorUsername,
  }));

function accept(inviteId: string, userId: string, username: string) {
  as(userId, username);
  return respondInvite(req(`/api/invites/${inviteId}`, 'PATCH', { action: 'accept' }), {
    params: Promise.resolve({ inviteId }),
  });
}

function removeBob() {
  as(alice, 'alice');
  return removeOwner(req(`/api/wishlists/${wid}/owners/${bob}`, 'DELETE'), {
    params: Promise.resolve({ id: wid, userId: bob }),
  });
}

function demoteBob() {
  as(alice, 'alice');
  return demote(req(`/api/wishlists/${wid}/owners/${bob}`, 'PATCH'), {
    params: Promise.resolve({ id: wid, userId: bob }),
  });
}

function bobLeaves() {
  as(bob, 'bob');
  return leave(req(`/api/wishlists/${wid}/members/me`, 'DELETE'), {
    params: Promise.resolve({ id: wid }),
  });
}

const takenOff: [string, () => Promise<Response>][] = [
  ['an owner removes him', removeBob],
  ['an owner demotes him', demoteBob],
];

describe('an owner taken off the owners by a co-owner', () => {
  // regression: removing or demoting an owner left the invites they had sent
  // pending, so the people they'd invited (as co-owners, even) could still join
  // on the say-so of someone the owners had just taken off the list.
  it.each(takenOff)('regression: %s, and the invites he sent are cancelled', async (_, takeOff) => {
    const erinsInvite = await sendInvite(bob, erin, 'member');
    const franksInvite = await sendInvite(bob, frank, 'owner');
    // What must survive: a co-owner's invite, and bob's invite that was
    // already answered.
    const ginasInvite = await sendInvite(alice, gina, 'member');
    const answered = await WishlistInvite.create({
      wishlist: wid,
      invitedBy: bob,
      invitedUser: carol,
      role: 'member',
      status: 'accepted',
    });

    expect((await takeOff()).status).toBe(200);

    expect(await pendingFrom(bob)).toBe(0);
    expect(await inviteNotifications(erin)).toBe(0);
    expect(await inviteNotifications(frank)).toBe(0);
    expect((await WishlistInvite.findById(ginasInvite))?.status).toBe('pending');
    expect(await inviteNotifications(gina)).toBe(1);
    expect((await WishlistInvite.findById(answered._id))?.status).toBe('accepted');

    // Nothing left to accept.
    expect((await accept(erinsInvite, erin, 'erin')).status).toBe(404);
    expect((await accept(franksInvite, frank, 'frank')).status).toBe(404);
    expect(await WishlistMember.exists({ wishlist: wid, user: erin })).toBeNull();
    expect((await Wishlist.findById(wid))!.owners.map(String)).not.toContain(frank);
  });

  it.each(takenOff)('%s on an archived list: his paused invites go too', async (_, takeOff) => {
    await sendInvite(bob, erin, 'member');
    await Wishlist.updateOne({ _id: wid }, { $set: { archived: true } });

    expect((await takeOff()).status).toBe(200);

    expect(await pendingFrom(bob)).toBe(0);
    expect(await inviteNotifications(erin)).toBe(0);
  });

  // Cancelling follows the write, never stands in for it.
  it.each(takenOff)(
    '%s, but the ownership write is refused: his invites stay',
    async (_, takeOff) => {
      await sendInvite(bob, erin, 'member');
      vi.spyOn(Wishlist, 'updateOne').mockResolvedValueOnce({ modifiedCount: 0 } as never);

      expect((await takeOff()).status).toBe(400);

      expect(await pendingFrom(bob)).toBe(1);
      expect(await inviteNotifications(erin)).toBe(1);
    }
  );

  it('is best-effort about the notifications: the invites are still cancelled', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const inviteId = await sendInvite(bob, erin, 'member');
    vi.spyOn(Notification, 'deleteMany').mockRejectedValueOnce(new Error('db down'));

    expect((await removeBob()).status).toBe(200);

    expect(await WishlistInvite.findById(inviteId)).toBeNull();
    expect(error).toHaveBeenCalledWith(
      `Notification cleanup failed for cancelled invite ${inviteId}:`,
      { name: 'Error', code: undefined }
    );
  });

  // The invite delete is the fix, so its failure isn't swallowed.
  it('does not swallow a failed invite delete', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await sendInvite(bob, erin, 'member');
    vi.spyOn(WishlistInvite, 'findOneAndDelete').mockRejectedValueOnce(new Error('db down'));

    expect((await removeBob()).status).toBe(500);
  });

  // regression: the race the cleanup can't see on its own. Bob's request checked
  // his ownership, the removal then landed and read his pending invites before
  // this one existed, and the invite was left behind.
  describe.each(takenOff)('%s while he is issuing an invite', (_, takeOff) => {
    const issuing: [string, () => Promise<Response>, string][] = [
      [
        'POST /members',
        () => {
          as(bob, 'bob');
          return inviteMember(
            req(`/api/wishlists/${wid}/members`, 'POST', { username: 'frank', role: 'owner' }),
            { params: Promise.resolve({ id: wid }) }
          );
        },
        'frank',
      ],
      [
        'POST /owners/[userId]',
        () => {
          as(bob, 'bob');
          return promote(req(`/api/wishlists/${wid}/owners/${carol}`, 'POST'), {
            params: Promise.resolve({ id: wid, userId: carol }),
          });
        },
        'carol',
      ],
    ];

    it.each(issuing)(
      'regression: %s: the invite is taken back, and he is answered as a non-owner',
      async (_route, issue, invitee) => {
        const inviteeId = invitee === 'frank' ? frank : carol;
        // The whole removal lands between his last ownership check and the invite.
        const race = holdFirstCall(WishlistInvite, 'create', takeOff);

        const res = await issue();

        expect(race.outcome()?.status).toBe(200);
        expect(res.status).toBe(403);
        expect(await WishlistInvite.countDocuments({ wishlist: wid, invitedUser: inviteeId })).toBe(
          0
        );
        expect(await inviteNotifications(inviteeId)).toBe(0);
      }
    );
  });

  // The other half of a removal racing an accept: the invitee claimed the invite
  // first, so it isn't pending any more when the removal's cleanup runs.
  it.each(takenOff)(
    '%s just after the invitee claims his invite: the accept completes, and the current owners are told',
    async (_, takeOff) => {
      const inviteId = await sendInvite(bob, erin, 'member');
      const race = holdFirstCall(WishlistInvite, 'updateOne', takeOff, { after: true });

      const accepted = await accept(inviteId, erin, 'erin');

      expect(race.outcome()?.status).toBe(200);
      expect(accepted.status).toBe(200);
      expect(await WishlistMember.exists({ wishlist: wid, user: erin })).not.toBeNull();
      expect((await WishlistInvite.findById(inviteId))?.status).toBe('accepted');
      expect(await acceptedNotices()).toEqual(
        expect.arrayContaining([
          { user: alice, actor: 'erin' },
          { user: hank, actor: 'erin' },
        ])
      );
      expect((await acceptedNotices()).map((n) => n.user)).not.toContain(bob);
    }
  );

  // regression: the removal's cleanup skipped the invite while the accept held
  // it, and the accept's failed grant then reopened it, so an invite of an owner
  // the owners had removed was pending again, for good.
  it('regression: an owner removes him while the invitee’s accept is failing: the invite isn’t reopened', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const inviteId = await sendInvite(bob, frank, 'owner');
    const race = holdFirstCall(WishlistInvite, 'updateOne', removeBob, { after: true });
    // The grant fails once bob's removal has landed.
    const realUpdateOne = Wishlist.updateOne.bind(Wishlist) as (...args: unknown[]) => unknown;
    vi.spyOn(Wishlist, 'updateOne').mockImplementation(((...args: unknown[]) => {
      if (race.outcome()) return Promise.reject(new Error('db down'));
      return realUpdateOne(...args);
    }) as never);

    const accepted = await accept(inviteId, frank, 'frank');

    expect(race.outcome()?.status).toBe(200);
    expect(accepted.status).toBe(500);
    expect(await WishlistInvite.findById(inviteId)).toBeNull();
    expect(await inviteNotifications(frank)).toBe(0);
    expect((await Wishlist.findById(wid))!.owners.map(String)).toEqual([alice, hank]);
  });
});

describe('an owner who leaves of his own accord', () => {
  it('keeps the invites he sent: they are the list’s', async () => {
    await sendInvite(bob, erin, 'member');
    await sendInvite(bob, frank, 'owner');

    expect((await bobLeaves()).status).toBe(200);

    expect(await pendingFrom(bob)).toBe(2);
    expect(await inviteNotifications(erin)).toBe(1);
    expect(await inviteNotifications(frank)).toBe(1);
  });

  // regression: `invite_accepted` went to whoever sent the invite, so a former
  // owner went on learning who joined a list he'd left.
  it('regression: an accept is told to the current owners, not to him', async () => {
    const inviteId = await sendInvite(bob, erin, 'member');
    expect((await bobLeaves()).status).toBe(200);

    expect((await accept(inviteId, erin, 'erin')).status).toBe(200);

    const notices = await acceptedNotices();
    expect(notices).toHaveLength(2);
    expect(notices).toEqual(
      expect.arrayContaining([
        { user: alice, actor: 'erin' },
        { user: hank, actor: 'erin' },
      ])
    );
  });

  it('an owner invite he sent makes a co-owner, who isn’t told of their own accept', async () => {
    const inviteId = await sendInvite(bob, frank, 'owner');
    expect((await bobLeaves()).status).toBe(200);

    expect((await accept(inviteId, frank, 'frank')).status).toBe(200);

    expect((await Wishlist.findById(wid))!.owners.map(String)).toContain(frank);
    const recipients = (await acceptedNotices()).map((n) => n.user).sort();
    expect(recipients).toEqual([alice, hank].sort());
  });

  // The cleanup can't tell a leave from a removal, so an invite issued while its
  // inviter leaves is taken back like any other issued by a non-owner.
  it('leaving while one of his invites is being issued takes that one back', async () => {
    const race = holdFirstCall(WishlistInvite, 'create', bobLeaves);

    as(bob, 'bob');
    const res = await inviteMember(
      req(`/api/wishlists/${wid}/members`, 'POST', { username: 'erin' }),
      { params: Promise.resolve({ id: wid }) }
    );

    expect(race.outcome()?.status).toBe(200);
    expect(res.status).toBe(403);
    expect(await WishlistInvite.countDocuments({ wishlist: wid, invitedUser: erin })).toBe(0);
    expect(await inviteNotifications(erin)).toBe(0);
  });
});

describe('invite_accepted while the inviter still owns the list', () => {
  it('goes to the inviter alone, naming who joined', async () => {
    const inviteId = await sendInvite(alice, gina, 'member');

    expect((await accept(inviteId, gina, 'gina')).status).toBe(200);

    expect(await acceptedNotices()).toEqual([{ user: alice, actor: 'gina' }]);
  });
});
