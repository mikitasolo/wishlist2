import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
const sendEmail = vi.fn();
vi.mock('@/lib/email', () => ({
  sendWishlistInvitationEmail: (...a: unknown[]) => sendEmail(...a),
}));

import { auth } from '@/lib/auth';
import { GET as listMyInvites } from '@/app/api/users/me/invites/route';
import { PATCH as answerInvite } from '@/app/api/invites/[inviteId]/route';
import { POST as issueInvite } from '@/app/api/wishlists/[id]/members/route';
import { DELETE as kick } from '@/app/api/wishlists/[id]/members/[memberId]/route';
import { GET as getNotifications, PATCH as markAllRead } from '@/app/api/notifications/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Notification from '@/models/Notification';

// While a list is archived, its pending member invites are paused (WIS-97): an
// archived list is its owners' alone, so a member who joined it couldn't open it.
// They stay pending but are left out of the invitee's invites and notifications,
// can't be accepted, and no new one can be issued. Unarchiving resumes them.
// Owner invites keep working: owners see an archived list.

const session = vi.mocked(auth);

let alice: string; // owner
let mia: string; // holds a pending member invite
let olly: string; // holds a pending owner invite
let wishlistId: string;
let memberInvite: string;
let ownerInvite: string;

beforeAll(async () => {
  await connectTestDB();
  await WishlistInvite.init();
});
afterAll(disconnectTestDB);
afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  sendEmail.mockReset();
  const user = async (username: string) =>
    (await User.create({ email: `${username}@x.com`, username }))._id.toString();
  alice = await user('alice');
  mia = await user('mia');
  olly = await user('olly');
  await user('nina'); // not invited yet
  const wl = await Wishlist.create({ name: 'Party', owners: [alice], visibility: 'everyone' });
  wishlistId = wl._id.toString();
  // What issuing the two invites left behind: the invite and its notification.
  const invite = async (invitedUser: string, role: 'member' | 'owner') => {
    const row = await WishlistInvite.create({
      wishlist: wishlistId,
      invitedBy: alice,
      invitedUser,
      role,
    });
    await Notification.create({
      user: invitedUser,
      type: 'wishlist_invite',
      actorUsername: 'alice',
      wishlist: wishlistId,
      wishlistName: 'Party',
    });
    return row._id.toString();
  };
  memberInvite = await invite(mia, 'member');
  ownerInvite = await invite(olly, 'owner');
});

const setArchived = (archived: boolean) =>
  Wishlist.updateOne({ _id: wishlistId }, { $set: { archived } });

function as(userId: string) {
  session.mockResolvedValue({ user: { id: userId, username: 'whoever' } } as never);
}

async function myInvites(userId: string): Promise<string[]> {
  as(userId);
  const res = await listMyInvites();
  expect(res.status).toBe(200);
  return (await res.json()).data.map((i: { _id: string }) => i._id);
}

async function answer(inviteId: string, action: 'accept' | 'decline', userId: string) {
  as(userId);
  const res = await answerInvite(
    new NextRequest(`http://localhost/api/invites/${inviteId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    }),
    { params: Promise.resolve({ inviteId }) }
  );
  return { status: res.status, body: await res.json() };
}

async function invite(username: string, role: 'member' | 'owner') {
  as(alice);
  const res = await issueInvite(
    new NextRequest(`http://localhost/api/wishlists/${wishlistId}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, role }),
    }),
    { params: Promise.resolve({ id: wishlistId }) }
  );
  return { status: res.status, body: await res.json() };
}

async function feed(userId: string) {
  as(userId);
  const json = await (
    await getNotifications(new NextRequest('http://localhost/api/notifications'))
  ).json();
  return {
    types: json.data.map((n: { type: string }) => n.type) as string[],
    unreadCount: json.unreadCount as number,
  };
}

const isMember = async (userId: string) =>
  !!(await WishlistMember.exists({ wishlist: wishlistId, user: userId }));
const inviteStatus = async (id: string) => (await WishlistInvite.findById(id))?.status;
const inviteNotification = (userId: string) =>
  Notification.findOne({ user: userId, type: 'wishlist_invite' }).lean();

const NOT_FOUND = { status: 404, body: { success: false, error: 'Invite not found' } };

/** The paused accept granted nothing and left the invite to wait for the unarchive. */
async function expectPaused(result: { status: number; body: unknown }) {
  expect(result).toEqual(NOT_FOUND);
  expect(await isMember(mia)).toBe(false);
  expect(await inviteStatus(memberInvite)).toBe('pending');
  // Nobody was told it was accepted, and the invitee's own notification still waits.
  expect(await Notification.exists({ type: 'invite_accepted' })).toBeNull();
  expect(await inviteNotification(mia)).toMatchObject({ read: false });
  expect((await inviteNotification(mia))?.inviteAnswer).toBeUndefined();
}

describe('GET /api/users/me/invites on an archived list', () => {
  it('leaves a member invite out while the list is archived, and keeps it pending', async () => {
    await setArchived(true);

    expect(await myInvites(mia)).toEqual([]);
    expect(await inviteStatus(memberInvite)).toBe('pending');
  });

  it('still lists an owner invite', async () => {
    await setArchived(true);

    expect(await myInvites(olly)).toEqual([ownerInvite]);
  });

  it('lists the member invite again once the list is unarchived', async () => {
    await setArchived(true);
    expect(await myInvites(mia)).toEqual([]);

    await setArchived(false);
    expect(await myInvites(mia)).toEqual([memberInvite]);
  });
});

describe('PATCH /api/invites/[inviteId] on an archived list', () => {
  // regression: a member invite to an archived list was accepted. The invitee was
  // made a member, told "Joined", and sent to the list, which answers a member
  // with 404.
  it('regression: answers 404 to accepting a member invite, and grants nothing', async () => {
    await setArchived(true);

    await expectPaused(await answer(memberInvite, 'accept', mia));
  });

  it('still accepts an owner invite', async () => {
    await setArchived(true);

    const res = await answer(ownerInvite, 'accept', olly);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'accepted', role: 'owner' });
    expect((await Wishlist.findById(wishlistId))?.owners.map(String)).toContain(olly);
    expect(await inviteStatus(ownerInvite)).toBe('accepted');
  });

  // Declining succeeded where a missing invite answers 404, which told the invitee
  // that the list still exists, archived.
  it('answers 404 to declining a paused member invite too, and leaves it pending', async () => {
    await setArchived(true);

    await expectPaused(await answer(memberInvite, 'decline', mia));

    // Back on unarchive, when it can be declined.
    await setArchived(false);
    expect((await answer(memberInvite, 'decline', mia)).status).toBe(200);
    expect(await inviteStatus(memberInvite)).toBe('declined');
  });

  it('still lets the invitee decline an owner invite', async () => {
    await setArchived(true);

    expect((await answer(ownerInvite, 'decline', olly)).status).toBe(200);
    expect(await inviteStatus(ownerInvite)).toBe('declined');
  });

  it('accepts the member invite once the list is unarchived', async () => {
    await setArchived(true);
    expect((await answer(memberInvite, 'accept', mia)).status).toBe(404);

    await setArchived(false);
    const res = await answer(memberInvite, 'accept', mia);

    expect(res.status).toBe(200);
    expect(await isMember(mia)).toBe(true);
    expect(await inviteStatus(memberInvite)).toBe('accepted');
  });
});

// The acceptance criterion: a member invite to an archived list can't end in a
// membership the invitee can't open, however the archive and the accept interleave.
describe('PATCH /api/invites/[inviteId] racing an archive', () => {
  it('regression: an archive that lands just before the claim answers 404 and leaves the invite pending', async () => {
    const race = holdFirstCall(WishlistInvite, 'updateOne', () => setArchived(true));

    const res = await answer(memberInvite, 'accept', mia);

    expect(race.held()).toBe(true);
    await expectPaused(res);
  });

  it('regression: an archive that lands just before they join takes nothing in, and reopens the invite', async () => {
    const race = holdFirstCall(WishlistMember, 'findOneAndUpdate', () => setArchived(true));

    const res = await answer(memberInvite, 'accept', mia);

    expect(race.held()).toBe(true);
    await expectPaused(res);
  });

  it('an archive that lands just after they join takes the new membership back', async () => {
    const race = holdFirstCall(WishlistMember, 'findOneAndUpdate', () => setArchived(true), {
      after: true,
    });

    const res = await answer(memberInvite, 'accept', mia);

    expect(race.held()).toBe(true);
    await expectPaused(res);
    // And once the list is unarchived, accepting again lets them in.
    await setArchived(false);
    expect((await answer(memberInvite, 'accept', mia)).status).toBe(200);
    expect(await isMember(mia)).toBe(true);
  });

  // Kicking cancels the person's pending invites, but this one was claimed then,
  // so the kick's cleanup missed it. Reopening it would let the kicked member
  // back in once the list is unarchived.
  it('withdraws the invite instead of reopening it when the new member is kicked under the archive', async () => {
    const race = holdFirstCall(
      WishlistMember,
      'findOneAndUpdate',
      async () => {
        await setArchived(true);
        const row = await WishlistMember.findOne({ wishlist: wishlistId, user: mia });
        session.mockResolvedValueOnce({ user: { id: alice } } as never);
        const memberId = row!._id.toString();
        return kick(
          new NextRequest(`http://localhost/api/wishlists/${wishlistId}/members/${memberId}`, {
            method: 'DELETE',
          }),
          { params: Promise.resolve({ id: wishlistId, memberId }) }
        );
      },
      { after: true }
    );

    expect(await answer(memberInvite, 'accept', mia)).toEqual(NOT_FOUND);

    expect(race.outcome()?.status).toBe(200);
    expect(await isMember(mia)).toBe(false);
    expect(await WishlistInvite.exists({ _id: memberInvite })).toBeNull();
    expect(await inviteNotification(mia)).toBeNull();
  });

  it("keeps a membership the invitee already held: it isn't the accept's to take", async () => {
    await WishlistMember.create({ wishlist: wishlistId, user: mia });
    holdFirstCall(WishlistMember, 'findOneAndUpdate', () => setArchived(true));

    expect(await answer(memberInvite, 'accept', mia)).toEqual(NOT_FOUND);

    expect(await isMember(mia)).toBe(true);
    expect(await inviteStatus(memberInvite)).toBe('pending');
  });
});

describe('POST /api/wishlists/[id]/members on an archived list', () => {
  it('refuses a member invite, and sends nothing', async () => {
    await setArchived(true);

    expect(await invite('nina', 'member')).toEqual({
      status: 409,
      body: { success: false, error: 'Unarchive this list to invite members' },
    });
    expect(await WishlistInvite.countDocuments()).toBe(2);
    expect(await Notification.countDocuments()).toBe(2);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses a member invite when the list is archived while the invite is being issued', async () => {
    holdFirstCall(WishlistMember, 'findOne', () => setArchived(true));

    expect((await invite('nina', 'member')).status).toBe(409);
    expect(await WishlistInvite.countDocuments()).toBe(2);
  });

  it('gives the answer of an invite that could never be issued first', async () => {
    await WishlistMember.create({ wishlist: wishlistId, user: mia });
    await setArchived(true);

    expect(await invite('mia', 'member')).toMatchObject({
      status: 400,
      body: { error: 'This person is already a member' },
    });
    expect((await invite('nobody', 'member')).status).toBe(404);
  });

  it('still issues an owner invite', async () => {
    await setArchived(true);

    expect((await invite('nina', 'owner')).status).toBe(201);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('issues a member invite again once the list is unarchived', async () => {
    await setArchived(true);
    await setArchived(false);

    expect((await invite('nina', 'member')).status).toBe(201);
  });
});

describe('GET / PATCH /api/notifications with a paused invite', () => {
  it("leaves the paused invite's notification out of the feed and the unread count", async () => {
    await setArchived(true);

    expect(await feed(mia)).toEqual({ types: [], unreadCount: 0 });
    // Kept, not deleted, for when the list is unarchived.
    expect(await inviteNotification(mia)).not.toBeNull();
  });

  it('still shows an owner invite’s notification', async () => {
    await setArchived(true);

    expect(await feed(olly)).toEqual({ types: ['wishlist_invite'], unreadCount: 1 });
  });

  it('marking everything read leaves it unread, so it comes back unread on unarchive', async () => {
    await Notification.create({ user: mia, type: 'follow', actorUsername: 'olly' });
    await setArchived(true);

    as(mia);
    await markAllRead();
    expect(await feed(mia)).toEqual({ types: ['follow'], unreadCount: 0 });

    await setArchived(false);
    const after = await feed(mia);
    expect(after.types.sort()).toEqual(['follow', 'wishlist_invite']);
    expect(after.unreadCount).toBe(1);
  });

  it('keeps showing an earlier invite to the list that was already answered', async () => {
    await Notification.create({
      user: mia,
      type: 'wishlist_invite',
      wishlist: wishlistId,
      wishlistName: 'Party',
      read: true,
      inviteAnswer: 'declined',
    });
    await setArchived(true);

    expect(await feed(mia)).toEqual({ types: ['wishlist_invite'], unreadCount: 0 });
  });
});
