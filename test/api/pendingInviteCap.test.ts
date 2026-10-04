import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendWishlistInvitationEmail: vi.fn() }));

import { auth } from '@/lib/auth';
import { sendWishlistInvitationEmail } from '@/lib/email';
import { POST as invite } from '@/app/api/wishlists/[id]/members/route';
import { POST as promote } from '@/app/api/wishlists/[id]/owners/[userId]/route';
import { PATCH as answerRequest } from '@/app/api/wishlists/[id]/requests/[requestId]/route';
import {
  issueWishlistInvite,
  PENDING_INVITE_CAP,
  PENDING_INVITE_CAP_ERROR,
  PENDING_INVITE_CAP_WINDOW_MS,
} from '@/lib/utils/wishlistInvites';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import WishlistJoinRequest from '@/models/WishlistJoinRequest';
import Notification from '@/models/Notification';

// WIS-40: at most PENDING_INVITE_CAP pending invites per invitee, across every
// inviter and list, counting only those created within the window. Over it the
// invite routes answer 429 and nothing is created or sent.

const session = vi.mocked(auth);
const sendEmail = vi.mocked(sendWishlistInvitationEmail);

function as(userId: string, username: string) {
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

let alice: string; // owner of the list under test
let erin: string; // the invitee
let wid: string;

beforeAll(async () => {
  await connectTestDB();
  await WishlistInvite.init(); // the unique pending-invite index
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  sendEmail.mockReset();
  alice = (await User.create({ email: 'a@x.com', username: 'alice' }))._id.toString();
  erin = (await User.create({ email: 'e@x.com', username: 'erin' }))._id.toString();
  wid = (
    await Wishlist.create({ name: 'Family list', owners: [alice], visibility: 'everyone' })
  )._id.toString();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * `n` invites to `to`, each from a different inviter on a list of their own,
 * written straight to the collection so they can carry any status and age.
 */
async function seedInvites(
  to: string,
  n: number,
  {
    status = 'pending',
    createdAt = new Date(),
    role = 'member',
    archived = false,
  }: { status?: string; createdAt?: Date; role?: 'member' | 'owner'; archived?: boolean } = {}
) {
  const docs = [];
  for (let i = 0; i < n; i++) {
    const inviter = new mongoose.Types.ObjectId();
    const list = await Wishlist.create({
      name: `List ${i}`,
      owners: [inviter],
      visibility: 'everyone',
      archived,
    });
    docs.push({
      wishlist: list._id,
      invitedBy: inviter,
      invitedUser: new mongoose.Types.ObjectId(to),
      role,
      status,
      createdAt,
      updatedAt: createdAt,
    });
  }
  await WishlistInvite.collection.insertMany(docs);
}

function inviteErin(role: 'member' | 'owner' = 'member') {
  as(alice, 'alice');
  return invite(req(`/api/wishlists/${wid}/members`, 'POST', { username: 'erin', role }), {
    params: Promise.resolve({ id: wid }),
  });
}

const erinsInvitesHere = () => WishlistInvite.countDocuments({ wishlist: wid, invitedUser: erin });
const erinsNotificationsHere = () =>
  Notification.countDocuments({ user: erin, wishlist: wid, type: 'wishlist_invite' });

async function expectRefusedAndNothingSent(res: Response) {
  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({ success: false, error: PENDING_INVITE_CAP_ERROR });
  expect(await erinsInvitesHere()).toBe(0);
  expect(await erinsNotificationsHere()).toBe(0);
  expect(sendEmail).not.toHaveBeenCalled();
}

describe('pending-invite cap per invitee (POST /members)', () => {
  it('lets the 20th through and refuses the 21st, sending nothing', async () => {
    await seedInvites(erin, PENDING_INVITE_CAP - 1);
    const twentieth = await inviteErin();
    expect(twentieth.status).toBe(201);
    expect(sendEmail).toHaveBeenCalledTimes(1);

    // The 21st, from a different inviter on a different list.
    const bob = (await User.create({ email: 'b@x.com', username: 'bob' }))._id.toString();
    const bobsList = (
      await Wishlist.create({ name: 'Bob list', owners: [bob], visibility: 'everyone' })
    )._id.toString();
    sendEmail.mockReset();
    as(bob, 'bob');
    const res = await invite(
      req(`/api/wishlists/${bobsList}/members`, 'POST', { username: 'erin' }),
      { params: Promise.resolve({ id: bobsList }) }
    );
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ success: false, error: PENDING_INVITE_CAP_ERROR });
    expect(await WishlistInvite.countDocuments({ wishlist: bobsList })).toBe(0);
    expect(await Notification.countDocuments({ user: erin, wishlist: bobsList })).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(await WishlistInvite.countDocuments({ invitedUser: erin, status: 'pending' })).toBe(
      PENDING_INVITE_CAP
    );
  });

  it('refuses an owner invite at the cap too', async () => {
    await seedInvites(erin, PENDING_INVITE_CAP);
    await expectRefusedAndNothingSent(await inviteErin('owner'));
  });

  it('does not count accepted or declined invites', async () => {
    await seedInvites(erin, PENDING_INVITE_CAP, { status: 'accepted' });
    await seedInvites(erin, PENDING_INVITE_CAP, { status: 'declined' });
    await seedInvites(erin, PENDING_INVITE_CAP - 1);
    expect((await inviteErin()).status).toBe(201);
  });

  it('does not count pending invites created before the window', async () => {
    const old = new Date(Date.now() - PENDING_INVITE_CAP_WINDOW_MS - 60_000);
    await seedInvites(erin, PENDING_INVITE_CAP, { createdAt: old });
    expect((await inviteErin()).status).toBe(201);
    // They stay pending: the cap only stops counting them.
    expect(await WishlistInvite.countDocuments({ invitedUser: erin, status: 'pending' })).toBe(
      PENDING_INVITE_CAP + 1
    );
  });

  // regression: paused invites (a member invite to an archived list) are hidden
  // from the invitee and can't be declined, so counting them let anyone fill the
  // cap behind their back: invite them from 20 lists, then archive the lists.
  it('does not count paused invites the invitee cannot see or decline', async () => {
    await seedInvites(erin, PENDING_INVITE_CAP, { archived: true });
    expect((await inviteErin()).status).toBe(201);
  });

  it('still counts owner invites to an archived list, which the invitee can answer', async () => {
    await seedInvites(erin, PENDING_INVITE_CAP, { role: 'owner', archived: true });
    await expectRefusedAndNothingSent(await inviteErin());
  });

  it('does not count invites to a list that no longer exists', async () => {
    await seedInvites(erin, PENDING_INVITE_CAP);
    await Wishlist.deleteMany({ _id: { $ne: wid } });
    expect((await inviteErin()).status).toBe(201);
  });

  it('counts only that invitee', async () => {
    const frank = (await User.create({ email: 'f@x.com', username: 'frank' }))._id.toString();
    await seedInvites(frank, PENDING_INVITE_CAP);
    expect((await inviteErin()).status).toBe(201);
  });

  // The cap's answer is checked after everything else the route refuses on, so it
  // only ever reaches someone who could otherwise invite them, and tells nobody
  // anything about an invitee who has shut them out.
  it("answers whoCanInvite's refusal, not the cap, to an inviter they don't accept", async () => {
    await User.updateOne({ _id: erin }, { $set: { 'privacy.whoCanInvite': 'nobody' } });
    await seedInvites(erin, PENDING_INVITE_CAP);
    const res = await inviteErin();
    expect(res.status).toBe(403);
    expect((await res.json()).error).not.toBe(PENDING_INVITE_CAP_ERROR);
  });

  it('answers "already pending", not the cap, to an inviter who already has one out', async () => {
    await seedInvites(erin, PENDING_INVITE_CAP - 1);
    expect((await inviteErin()).status).toBe(201);
    sendEmail.mockReset();
    const res = await inviteErin();
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('This person already has a pending invite');
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('pending-invite cap on a promotion (POST /owners/[userId])', () => {
  it('refuses to promote a member who is at the cap, sending nothing', async () => {
    await WishlistMember.create({ wishlist: wid, user: erin });
    await seedInvites(erin, PENDING_INVITE_CAP);
    as(alice, 'alice');
    const res = await promote(req(`/api/wishlists/${wid}/owners/${erin}`, 'POST'), {
      params: Promise.resolve({ id: wid, userId: erin }),
    });
    await expectRefusedAndNothingSent(res);
    // Still a member: a refused promotion changes nothing.
    expect(await WishlistMember.exists({ wishlist: wid, user: erin })).toBeTruthy();
  });
});

describe('pending-invite cap on a join request (PATCH /requests/[requestId])', () => {
  it('refuses Invite at the cap and puts the request back', async () => {
    const request = await WishlistJoinRequest.create({
      wishlist: wid,
      user: erin,
      status: 'pending',
    });
    await seedInvites(erin, PENDING_INVITE_CAP);
    const requestId = request._id.toString();
    as(alice, 'alice');
    const res = await answerRequest(
      req(`/api/wishlists/${wid}/requests/${requestId}`, 'PATCH', { action: 'invite' }),
      { params: Promise.resolve({ id: wid, requestId }) }
    );
    await expectRefusedAndNothingSent(res);
    const after = await WishlistJoinRequest.findById(requestId).lean();
    expect(after?.status).toBe('pending');
  });
});

describe('issueWishlistInvite and the cap under a race', () => {
  function issue(listId: string, invitedBy: string) {
    return issueWishlistInvite({
      wishlistId: listId,
      wishlistName: 'A list',
      role: 'member',
      invitedBy,
      inviterName: 'someone',
      actorUsername: null,
      invitedUserId: erin,
      invitedUserEmail: 'e@x.com',
    });
  }

  // regression: the count before the insert is check-then-create, so two
  // inviters landing the 20th at once both got through it. The re-count once
  // the invite exists withdraws the one that pushed the invitee over.
  it('withdraws an invite that a concurrent one pushed over the cap', async () => {
    await seedInvites(erin, PENDING_INVITE_CAP - 1);
    const bob = new mongoose.Types.ObjectId().toString();
    const bobsList = (
      await Wishlist.create({ name: 'Bob list', owners: [bob], visibility: 'everyone' })
    )._id.toString();

    // Alice's invite has passed the count and is about to insert when Bob's lands.
    let bobs: Awaited<ReturnType<typeof issue>> | undefined;
    const race = holdFirstCall(WishlistInvite, 'create', async () => {
      bobs = await issue(bobsList, bob);
    });
    const alices = await issue(wid, alice);
    expect(race.held()).toBe(true);

    expect(bobs).not.toBe('capped');
    expect(bobs).not.toBeNull();
    expect(alices).toBe('capped');
    expect(await erinsInvitesHere()).toBe(0);
    expect(await erinsNotificationsHere()).toBe(0);
    expect(await WishlistInvite.countDocuments({ invitedUser: erin, status: 'pending' })).toBe(
      PENDING_INVITE_CAP
    );
    // Only Bob's email went out.
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
