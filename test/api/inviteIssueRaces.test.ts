import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendWishlistInvitationEmail: vi.fn() }));

import { auth } from '@/lib/auth';
import { sendWishlistInvitationEmail } from '@/lib/email';
import { POST as invite } from '@/app/api/wishlists/[id]/members/route';
import { DELETE as cancelInvite } from '@/app/api/wishlists/[id]/invites/[inviteId]/route';
import { DELETE as kick } from '@/app/api/wishlists/[id]/members/[memberId]/route';
import { PATCH as respondInvite } from '@/app/api/invites/[inviteId]/route';
import { issueWishlistInvite } from '@/lib/utils/wishlistInvites';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Notification from '@/models/Notification';

// `issueWishlistInvite` writes the invite, then its notification. An invite taken
// back in between (an owner's cancel, a kick's `cancelPendingInvites`) had its
// cleanup run before the notification existed, so the invitee was left an
// "invited you" row with no invite behind it (WIS-183).

const session = vi.mocked(auth);
const sendEmail = vi.mocked(sendWishlistInvitationEmail);

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
let carol: string; // member
let erin: string; // not on the list
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
  carol = (await User.create({ email: 'c@x.com', username: 'carol' }))._id.toString();
  erin = (await User.create({ email: 'e@x.com', username: 'erin' }))._id.toString();
  wid = (await Wishlist.create({ name: 'Family list', owners: [alice] }))._id.toString();
  await WishlistMember.create({ wishlist: wid, user: carol });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const inviteNotifications = (user: string) =>
  Notification.find({ user, wishlist: wid, type: 'wishlist_invite' });

function inviteErin() {
  as(alice);
  return invite(req(`/api/wishlists/${wid}/members`, 'POST', { username: 'erin' }), {
    params: Promise.resolve({ id: wid }),
  });
}

async function cancelPending(userId: string) {
  const pending = await WishlistInvite.findOne({ wishlist: wid, invitedUser: userId }).orFail();
  const inviteId = pending._id.toString();
  as(alice);
  return cancelInvite(req(`/api/wishlists/${wid}/invites/${inviteId}`, 'DELETE'), {
    params: Promise.resolve({ id: wid, inviteId }),
  });
}

async function kickCarol() {
  const membership = await WishlistMember.findOne({ wishlist: wid, user: carol }).orFail();
  const memberId = membership._id.toString();
  as(alice);
  return kick(req(`/api/wishlists/${wid}/members/${memberId}`, 'DELETE'), {
    params: Promise.resolve({ id: wid, memberId }),
  });
}

function issueTo(invitedUserId: string, role: 'owner' | 'member') {
  return issueWishlistInvite({
    wishlistId: wid,
    wishlistName: 'Family list',
    role,
    invitedBy: alice,
    inviterName: 'alice',
    actorUsername: 'alice',
    invitedUserId,
    invitedUserEmail: 'invitee@x.com',
  });
}

describe('issueWishlistInvite and a cancel landing before its notification', () => {
  // regression: the cancel's cleanup ran before the notification was written and
  // only clears rows from before the cancel, so this one stayed behind.
  it('regression: an owner cancel leaves the invitee no invite notification', async () => {
    const race = holdFirstCall(Notification, 'create', () => cancelPending(erin));
    const res = await inviteErin();

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(res.status).toBe(201);
    expect(await WishlistInvite.exists({ wishlist: wid, invitedUser: erin })).toBeNull();
    expect(await inviteNotifications(erin)).toHaveLength(0);
    // Nor an email about an invite that's gone.
    expect(sendEmail).not.toHaveBeenCalled();
  });

  // regression: a kick's `cancelPendingInvites` cleared the invitee's invite
  // notifications right after its delete, before this one was written.
  it('regression: a kick leaves the kicked member no invite notification', async () => {
    const race = holdFirstCall(Notification, 'create', kickCarol);
    const issued = await issueTo(carol, 'owner');

    expect(race.held()).toBe(true);
    expect(race.outcome()?.status).toBe(200);
    expect(issued).not.toBeNull();
    expect(await WishlistInvite.exists({ wishlist: wid, invitedUser: carol })).toBeNull();
    expect(await WishlistMember.exists({ wishlist: wid, user: carol })).toBeNull();
    expect(await inviteNotifications(carol)).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  // The other order: the cancel began (and once took its time bound) before the
  // notification was written, but its delete landed only after the issuing
  // call's re-check found the invite still pending. The cancel's own cleanup has
  // to take it then, which a bound taken before the delete didn't.
  it('regression: a cancel whose delete lands after the re-check still clears the notification', async () => {
    const pending = await WishlistInvite.create({
      wishlist: wid,
      invitedBy: alice,
      invitedUser: erin,
      role: 'member',
    });
    const race = holdFirstCall(WishlistInvite, 'findOneAndDelete', async () => {
      await Notification.create({
        user: erin,
        type: 'wishlist_invite',
        wishlist: wid,
        wishlistName: 'Family list',
      });
      // The issuing call's re-check and the delete are round trips of their own,
      // so the cancel's check is never in the same millisecond as this write; an
      // in-memory database can be that fast, so step the clock past it.
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    const res = await cancelPending(erin);

    expect(race.held()).toBe(true);
    expect(res.status).toBe(200);
    expect(await WishlistInvite.findById(pending._id)).toBeNull();
    expect(await inviteNotifications(erin)).toHaveLength(0);
  });

  it("doesn't take the notification of a re-invite that landed after the cancel", async () => {
    let reinvited: Awaited<ReturnType<typeof issueTo>> = null;
    const race = holdFirstCall(Notification, 'create', async () => {
      await cancelPending(erin);
      reinvited = await issueTo(erin, 'member');
    });
    await issueTo(erin, 'member');

    expect(race.held()).toBe(true);
    expect(reinvited).not.toBeNull();
    const left = await WishlistInvite.find({ wishlist: wid, invitedUser: erin });
    expect(left.map((i) => i._id.toString())).toEqual([reinvited!._id.toString()]);
    expect(left[0].status).toBe('pending');
    expect(await inviteNotifications(erin)).toHaveLength(1);
    // Only the live invite's email went out.
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  // The invitee sees the invite on Activity as soon as it exists, so they can
  // answer it before its notification is written. `recordInviteAnswer` only
  // reaches rows written before the answer, so this one was left reading as an
  // unread invite, and the email went out for an invite already answered.
  it.each(['decline', 'accept'] as const)(
    'regression: an invite %sd in the gap leaves its notification answered, and sends no email',
    async (action) => {
      const race = holdFirstCall(Notification, 'create', async () => {
        const pending = await WishlistInvite.findOne({ wishlist: wid, invitedUser: erin }).orFail();
        const inviteId = pending._id.toString();
        as(erin);
        return respondInvite(req(`/api/invites/${inviteId}`, 'PATCH', { action }), {
          params: Promise.resolve({ inviteId }),
        });
      });
      const issued = await issueTo(erin, 'member');

      const answer = action === 'accept' ? 'accepted' : 'declined';
      expect(race.held()).toBe(true);
      expect(race.outcome()?.status).toBe(200);
      expect((await WishlistInvite.findById(issued!._id))?.status).toBe(answer);
      const left = await inviteNotifications(erin);
      expect(left).toHaveLength(1);
      expect(left[0]).toMatchObject({ read: true, inviteAnswer: answer });
      expect(sendEmail).not.toHaveBeenCalled();
    }
  );

  it('keeps the notification and sends the email when nothing takes the invite back', async () => {
    const issued = await issueTo(erin, 'member');

    expect((await WishlistInvite.findById(issued!._id))?.status).toBe('pending');
    expect(await inviteNotifications(erin)).toHaveLength(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
