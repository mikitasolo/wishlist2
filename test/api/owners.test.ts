import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
const sendEmail = vi.fn();
vi.mock('@/lib/email', () => ({
  sendWishlistInvitationEmail: (...a: unknown[]) => sendEmail(...a),
}));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
  convertToUsdCents: vi.fn().mockReturnValue(null),
}));

import { auth } from '@/lib/auth';
import {
  GET as getWishlist,
  PATCH as patchWishlist,
  DELETE as deleteWishlist,
} from '@/app/api/wishlists/[id]/route';
import { GET as getItems } from '@/app/api/wishlists/[id]/items/route';
import { POST as postItem } from '@/app/api/wishlists/[id]/items/route';
import { GET as getMembers, POST as invite } from '@/app/api/wishlists/[id]/members/route';
import { DELETE as deleteMember } from '@/app/api/wishlists/[id]/members/[memberId]/route';
import { PATCH as patchItem } from '@/app/api/items/[id]/route';
import {
  POST as postOwner,
  PATCH as patchOwner,
  DELETE as deleteOwner,
} from '@/app/api/wishlists/[id]/owners/[userId]/route';
import { DELETE as leave } from '@/app/api/wishlists/[id]/members/me/route';
import { PATCH as respondInvite } from '@/app/api/invites/[inviteId]/route';
import { GET as getProfileWishlists } from '@/app/api/users/[id]/wishlists/route';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import { isLastOwner, removeWishlistOwner } from '@/lib/utils/wishlistOwnership';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import Notification from '@/models/Notification';

const session = vi.mocked(auth);

function as(userId: string | null) {
  session.mockResolvedValue(userId ? ({ user: { id: userId } } as never) : (null as never));
}

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest('http://localhost' + url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

let alice: string; // primary owner
let bob: string; // co-owner
let carol: string; // member
let dave: string; // second member
let wid: string;

beforeAll(async () => {
  await connectTestDB();
  // Concurrent-promotion tests rely on the unique pending-invite index.
  await WishlistInvite.init();
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  sendEmail.mockReset();

  alice = (await User.create({ email: 'a@x.com', username: 'alice' }))._id.toString();
  bob = (await User.create({ email: 'b@x.com', username: 'bob' }))._id.toString();
  carol = (await User.create({ email: 'c@x.com', username: 'carol' }))._id.toString();
  dave = (await User.create({ email: 'd@x.com', username: 'dave' }))._id.toString();

  const wl = await Wishlist.create({
    name: 'Family list',
    slug: 'family-list',
    owners: [alice, bob],
    visibility: 'everyone',
  });
  wid = wl._id.toString();

  await WishlistMember.create({ wishlist: wid, user: carol });
  await WishlistMember.create({ wishlist: wid, user: dave });
});

async function makeItem(status = 'available', bookedBy?: string) {
  const item = await Item.create({ wishlist: wid, name: 'Gift', status, bookedBy });
  return item._id.toString();
}

describe('co-ownership — reading the list', () => {
  it('every owner is resolved as owner, not as a member', async () => {
    for (const uid of [alice, bob]) {
      as(uid);
      const res = await getWishlist(req(`/api/wishlists/${wid}`), {
        params: Promise.resolve({ id: wid }),
      });
      const body = await res.json();
      expect(body.data.userRole).toBe('owner');
      expect(body.data.owners).toEqual([alice, bob]);
      expect(body.data.ownerUsernames).toEqual(['alice', 'bob']);
    }
  });

  // regression: booking privacy is the whole point of the app — promoting someone
  // to co-owner must not turn them into a viewer who can see what's reserved.
  it('regression: no owner sees booking status, not even a promoted co-owner', async () => {
    const id = await makeItem('booked', carol);

    for (const uid of [alice, bob]) {
      as(uid);
      const res = await getItems(req(`/api/wishlists/${wid}/items`), {
        params: Promise.resolve({ id: wid }),
      });
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]._id).toBe(id);
      expect(body.data[0].status).toBe('available'); // booked folds into available
      expect(body.data[0].bookedBy).toBeUndefined();
    }

    // The member who booked it still sees the truth.
    as(carol);
    const res = await getItems(req(`/api/wishlists/${wid}/items`), {
      params: Promise.resolve({ id: wid }),
    });
    const body = await res.json();
    expect(body.data[0].status).toBe('booked');
  });

  it('lists both owners in the members view, keyed by user id', async () => {
    as(bob);
    const res = await getMembers(req(`/api/wishlists/${wid}/members`), {
      params: Promise.resolve({ id: wid }),
    });
    const body = await res.json();
    const owners = body.data.filter((m: { role: string }) => m.role === 'owner');
    expect(owners.map((o: { _id: string }) => o._id)).toEqual([alice, bob]);
    // Owners have no membership row, so the row id must be their user id.
    expect(owners.map((o: { user: { username: string } }) => o.user.username)).toEqual([
      'alice',
      'bob',
    ]);
  });

  it('shows a co-owned list on every owner’s profile', async () => {
    for (const uid of [alice, bob]) {
      as(null);
      const res = await getProfileWishlists(req(`/api/users/${uid}/wishlists`), {
        params: Promise.resolve({ id: uid }),
      });
      const body = await res.json();
      expect(body.data.map((w: { _id: string }) => w._id)).toContain(wid);
    }
  });

  async function profileOf(profileUserId: string, viewerId: string | null) {
    as(viewerId);
    const res = await getProfileWishlists(req(`/api/users/${profileUserId}/wishlists`), {
      params: Promise.resolve({ id: profileUserId }),
    });
    return res.json();
  }

  // regression: the "see it regardless of visibility tier" escape hatch keyed on
  // a `WishlistMember` row, and co-owners don't have one — so a list you co-owned
  // vanished from your co-owner's profile the moment it wasn't public.
  it('regression: a co-owner sees a private shared list on the other owner’s profile', async () => {
    await Wishlist.updateOne({ _id: wid }, { $set: { visibility: 'private', isPublic: false } });

    const body = await profileOf(bob, alice);
    const row = body.data.find((w: { _id: string }) => w._id === wid);
    expect(row).toBeDefined();
    // And it's labelled as theirs, which is what explains the visibility.
    expect(row.userRole).toBe('owner');
  });

  // The friends tier is gated on friendship with the profile's owner, which a
  // co-owner needn't have.
  it('regression: a co-owner sees a friends-only shared list without being friends', async () => {
    await Wishlist.updateOne({ _id: wid }, { $set: { visibility: 'friends', isPublic: false } });

    const body = await profileOf(bob, alice);
    expect(body.data.map((w: { _id: string }) => w._id)).toContain(wid);
  });

  // The fix must widen access for owners only — not for everyone else.
  it('still hides a private list from a stranger and from a plain member’s view of it', async () => {
    await Wishlist.updateOne({ _id: wid }, { $set: { visibility: 'private', isPublic: false } });
    const stranger = (await User.create({ email: 'z@x.com', username: 'zoe' }))._id.toString();

    expect((await profileOf(bob, stranger)).data).toHaveLength(0);
    expect((await profileOf(bob, null)).data).toHaveLength(0);

    // A member still reaches it, as before — via the membership clause.
    const memberView = await profileOf(bob, carol);
    const row = memberView.data.find((w: { _id: string }) => w._id === wid);
    expect(row.userRole).toBe('member');
  });

  it('does not badge every list as owned on your own profile', async () => {
    const body = await profileOf(alice, alice);
    const row = body.data.find((w: { _id: string }) => w._id === wid);
    expect(row).toBeDefined();
    expect(row.userRole).toBeNull();
  });
});

describe('co-ownership — notifications', () => {
  it('a proposal notifies every owner, still anonymously', async () => {
    as(carol);
    const res = await postItem(
      req(`/api/wishlists/${wid}/items`, 'POST', { name: 'Idea', status: 'proposed' }),
      { params: Promise.resolve({ id: wid }) }
    );
    expect(res.status).toBe(201);

    const notes = await Notification.find({ type: 'proposal' });
    expect(notes.map((n) => n.user.toString()).sort()).toEqual([alice, bob].sort());
    // Owners must never learn who proposed an item.
    for (const n of notes) expect(n.actorUsername).toBeNull();
  });
});

describe('promotion to owner is consent-gated', () => {
  it('promoting a member creates a pending owner invite instead of applying it', async () => {
    as(alice);
    const res = await postOwner(req(`/api/wishlists/${wid}/owners/${carol}`, 'POST'), {
      params: Promise.resolve({ id: wid, userId: carol }),
    });

    expect(res.status).toBe(202);
    expect((await res.json()).data.pending).toBe(true);

    // Not an owner yet, and still a plain member.
    const wl = await Wishlist.findById(wid);
    expect(wl!.owners.map(String)).toEqual([alice, bob]);
    expect(await WishlistMember.findOne({ wishlist: wid, user: carol })).not.toBeNull();

    const inv = await WishlistInvite.findOne({ wishlist: wid, invitedUser: carol });
    expect(inv?.role).toBe('owner');
    expect(inv?.status).toBe('pending');
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it('accepting the invite grants ownership, drops the membership row, and resets their bookings', async () => {
    // Carol books an item first, creating a durable reservation.
    const itemId = await makeItem('booked', carol);
    await Reservation.create({
      gifter: carol,
      wishlist: wid,
      item: itemId,
      owner: alice,
      itemName: 'Gift',
      wishlistName: 'Family list',
    });

    const inv = await WishlistInvite.create({
      wishlist: wid,
      invitedBy: alice,
      invitedUser: carol,
      role: 'owner',
    });

    as(carol);
    const res = await respondInvite(req(`/api/invites/${inv._id}`, 'PATCH', { action: 'accept' }), {
      params: Promise.resolve({ inviteId: inv._id.toString() }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.role).toBe('owner');
    expect(body.data.releasedBookings).toBe(1);
    expect(body.data.cancelledReservations).toBe(1);

    const wl = await Wishlist.findById(wid);
    expect(wl!.owners.map(String)).toEqual([alice, bob, carol]);
    // Owners live only in `owners` — never as a membership row.
    expect(await WishlistMember.findOne({ wishlist: wid, user: carol })).toBeNull();

    // An owner can't hold a booking they'd never be able to see or cancel.
    const item = await Item.findById(itemId);
    expect(item?.status).toBe('available');
    expect(item?.bookedBy).toBeNull();
    expect(await Reservation.findOne({ gifter: carol, wishlist: wid })).toBeNull();
  });

  // Members have no authority over the list at all — that's the point of dropping
  // the admin tier: the only people who can manage a list are its owners.
  it('a member cannot promote anyone to owner', async () => {
    as(dave);
    const res = await postOwner(req(`/api/wishlists/${wid}/owners/${carol}`, 'POST'), {
      params: Promise.resolve({ id: wid, userId: carol }),
    });
    expect(res.status).toBe(403);
    expect(await WishlistInvite.findOne({ wishlist: wid })).toBeNull();
  });

  it('an owner can invite a stranger straight to co-ownership', async () => {
    const stranger = await User.create({ email: 'e@x.com', username: 'erin' });
    as(alice);
    const res = await invite(
      req(`/api/wishlists/${wid}/members`, 'POST', {
        username: 'erin',
        role: 'owner',
      }),
      { params: Promise.resolve({ id: wid }) }
    );
    expect(res.status).toBe(201);
    expect((await WishlistInvite.findOne({ invitedUser: stranger._id }))?.role).toBe('owner');
  });

  it('a member cannot invite anyone', async () => {
    await User.create({ email: 'e@x.com', username: 'erin' });
    as(dave);
    const res = await invite(
      req(`/api/wishlists/${wid}/members`, 'POST', {
        username: 'erin',
        role: 'owner',
      }),
      { params: Promise.resolve({ id: wid }) }
    );
    expect(res.status).toBe(403);
  });

  // Existing members go through the promotion endpoint, which the members UI drives.
  it('points an owner at the promotion path when inviting an existing member', async () => {
    as(alice);
    const res = await invite(
      req(`/api/wishlists/${wid}/members`, 'POST', { username: 'carol', role: 'owner' }),
      { params: Promise.resolve({ id: wid }) }
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already a member/i);
  });
});

describe('promotion reaches existing members only, and keeps its other guards', () => {
  afterEach(() => {
    __setRateLimiters(null);
    vi.restoreAllMocks();
  });

  function promote(userId: string) {
    return postOwner(req(`/api/wishlists/${wid}/owners/${userId}`, 'POST'), {
      params: Promise.resolve({ id: wid, userId }),
    });
  }

  async function expectNothingSent(userId: string) {
    expect(await WishlistInvite.countDocuments({ wishlist: wid })).toBe(0);
    expect(await Notification.countDocuments({ user: userId })).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  }

  // regression: the promotion route skips the target's `whoCanInvite` on the grounds
  // that they're "already on this list", but never checked that they were — so any
  // owner could send an owner invite (email + notification) to any user id.
  it('regression: promoting a non-member is a 404 and sends nothing', async () => {
    const erin = (await User.create({ email: 'e@x.com', username: 'erin' }))._id.toString();

    as(alice);
    const res = await promote(erin);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("This person isn't a member of this wishlist");
    await expectNothingSent(erin);
  });

  // regression: the missing membership check let an owner reach someone who opted
  // out of invites entirely — `POST /members` refuses them, this route didn't.
  it('regression: a non-member who accepts no invites cannot be reached through either door', async () => {
    const erin = await User.create({
      email: 'e@x.com',
      username: 'erin',
      privacy: { whoCanInvite: 'nobody' },
    });
    const erinId = erin._id.toString();

    as(alice);
    const promoted = await promote(erinId);
    expect(promoted.status).toBe(404);

    const invited = await invite(
      req(`/api/wishlists/${wid}/members`, 'POST', { username: 'erin', role: 'owner' }),
      { params: Promise.resolve({ id: wid }) }
    );
    expect(invited.status).toBe(403);

    await expectNothingSent(erinId);
  });

  // regression: with the membership check missing, a made-up id reached the user
  // lookup and came back "User not found" — a different answer from a real user's.
  it('regression: answers a non-member, a nonexistent user and a malformed id identically', async () => {
    const erin = (await User.create({ email: 'e@x.com', username: 'erin' }))._id.toString();
    const ghost = new mongoose.Types.ObjectId().toString();

    as(alice);
    const responses = [await promote(erin), await promote(ghost), await promote('not-an-id')];
    const bodies = await Promise.all(responses.map((r) => r.json()));

    expect(responses.map((r) => r.status)).toEqual([404, 404, 404]);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    await expectNothingSent(ghost);
  });

  it('treats a membership whose account is gone as no membership', async () => {
    const ghost = new mongoose.Types.ObjectId().toString();
    await WishlistMember.create({ wishlist: wid, user: ghost });

    as(alice);
    const res = await promote(ghost);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("This person isn't a member of this wishlist");
    await expectNothingSent(ghost);
  });

  it('a former member can no longer be promoted', async () => {
    await WishlistMember.deleteOne({ wishlist: wid, user: carol });

    as(alice);
    const res = await promote(carol);
    expect(res.status).toBe(404);
    await expectNothingSent(carol);
  });

  it('a request that cannot send anything does not spend the invite budget', async () => {
    const limit = vi.fn<RateLimiter['limit']>(async () => ({
      success: true,
      reset: 0,
      limit: 30,
      remaining: 29,
    }));
    __setRateLimiters({ invite: { limit } });
    const erin = (await User.create({ email: 'e@x.com', username: 'erin' }))._id.toString();

    as(alice);
    expect((await promote(erin)).status).toBe(404);
    expect(limit).not.toHaveBeenCalled();

    expect((await promote(carol)).status).toBe(202);
    expect(limit).toHaveBeenCalledWith(alice);
  });

  it('still rate-limits promoting a member, before anything is sent', async () => {
    __setRateLimiters({
      invite: {
        async limit() {
          return { success: false, reset: Date.now() + 60_000, limit: 30, remaining: 0 };
        },
      },
    });

    as(alice);
    const res = await promote(carol);
    expect(res.status).toBe(429);
    await expectNothingSent(carol);
  });

  // Membership is what makes skipping `whoCanInvite` sound: they're already on the
  // list by their own choice, so this changes a relationship they opted into.
  it('promotes a member even if they accept no new invites', async () => {
    await User.updateOne({ _id: carol }, { $set: { 'privacy.whoCanInvite': 'nobody' } });

    as(alice);
    const res = await promote(carol);
    expect(res.status).toBe(202);
    expect((await res.json()).data).toMatchObject({ pending: true, role: 'owner' });

    const inv = await WishlistInvite.findOne({ wishlist: wid, invitedUser: carol });
    expect(inv?.role).toBe('owner');
    expect(inv?.status).toBe('pending');
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(await Notification.countDocuments({ user: carol, type: 'wishlist_invite' })).toBe(1);
  });

  it('does not issue a second invite while one is pending', async () => {
    as(alice);
    expect((await promote(carol)).status).toBe(202);

    const again = await promote(carol);
    expect(again.status).toBe(400);
    expect((await again.json()).error).toMatch(/pending invite/i);
    expect(await WishlistInvite.countDocuments({ wishlist: wid, invitedUser: carol })).toBe(1);
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it('two owners promoting the same member at once issue one invite', async () => {
    // Each concurrent request reads its own session.
    session
      .mockResolvedValueOnce({ user: { id: alice } } as never)
      .mockResolvedValueOnce({ user: { id: bob } } as never);

    const results = await Promise.all([promote(carol), promote(carol)]);
    expect(results.map((r) => r.status).sort()).toEqual([202, 400]);
    expect(
      await WishlistInvite.countDocuments({ wishlist: wid, invitedUser: carol, status: 'pending' })
    ).toBe(1);
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(await Notification.countDocuments({ user: carol, type: 'wishlist_invite' })).toBe(1);
  });

  // regression: a failed invite email used to be rethrown after the invite was
  // written, so the promotion answered 500 with no notification behind it.
  it('regression: a promotion whose email fails still stands, with its notification', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    sendEmail.mockRejectedValueOnce(new Error('SMTP unavailable'));

    as(alice);
    const res = await promote(carol);
    expect(res.status).toBe(202);
    expect((await res.json()).data).toMatchObject({ pending: true, role: 'owner' });
    expect(
      await WishlistInvite.countDocuments({ wishlist: wid, invitedUser: carol, status: 'pending' })
    ).toBe(1);
    expect(await Notification.countDocuments({ user: carol, type: 'wishlist_invite' })).toBe(1);
  });

  it('refuses to promote someone who already owns the list', async () => {
    as(alice);
    const res = await promote(bob);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already owns/i);
    await expectNothingSent(bob);
  });
});

describe('self-role changes are refused', () => {
  // From the backlog: role changes are something others with authority do to you.
  it('an owner cannot demote themselves', async () => {
    as(alice);
    const res = await patchOwner(req(`/api/wishlists/${wid}/owners/${alice}`, 'PATCH'), {
      params: Promise.resolve({ id: wid, userId: alice }),
    });
    expect(res.status).toBe(403);
    expect((await Wishlist.findById(wid))!.owners.map(String)).toContain(alice);
  });

  it('a member cannot promote themselves to owner', async () => {
    as(carol);
    const res = await postOwner(req(`/api/wishlists/${wid}/owners/${carol}`, 'POST'), {
      params: Promise.resolve({ id: wid, userId: carol }),
    });
    expect(res.status).toBe(403);
    expect((await Wishlist.findById(wid))!.owners.map(String)).not.toContain(carol);
  });
});

describe('losing ownership', () => {
  it('demoting an owner pulls them from owners, clears their pin, and gives them a membership', async () => {
    await Wishlist.updateOne({ _id: wid }, { $set: { featuredBy: [alice, bob] } });

    as(alice);
    const res = await patchOwner(req(`/api/wishlists/${wid}/owners/${bob}`, 'PATCH'), {
      params: Promise.resolve({ id: wid, userId: bob }),
    });
    expect(res.status).toBe(200);

    const wl = await Wishlist.findById(wid);
    expect(wl!.owners.map(String)).toEqual([alice]);
    // A non-owner must not keep the list pinned as their dashboard hero.
    expect(wl!.featuredBy.map(String)).toEqual([alice]);
    expect(await WishlistMember.findOne({ wishlist: wid, user: bob })).not.toBeNull();
  });

  it('removing an owner clears their pin and leaves them with no access', async () => {
    await Wishlist.updateOne({ _id: wid }, { $set: { featuredBy: [bob] } });

    as(alice);
    const res = await deleteOwner(req(`/api/wishlists/${wid}/owners/${bob}`, 'DELETE'), {
      params: Promise.resolve({ id: wid, userId: bob }),
    });
    expect(res.status).toBe(200);

    const wl = await Wishlist.findById(wid);
    expect(wl!.owners.map(String)).toEqual([alice]);
    expect(wl!.featuredBy.map(String)).toEqual([]);
    expect(await WishlistMember.findOne({ wishlist: wid, user: bob })).toBeNull();
  });

  it('a co-owner can step down, and it clears their pin', async () => {
    await Wishlist.updateOne({ _id: wid }, { $set: { featuredBy: [bob] } });

    as(bob);
    const res = await leave(req(`/api/wishlists/${wid}/members/me`, 'DELETE'), {
      params: Promise.resolve({ id: wid }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.wasOwner).toBe(true);

    const wl = await Wishlist.findById(wid);
    expect(wl!.owners.map(String)).toEqual([alice]);
    expect(wl!.featuredBy.map(String)).toEqual([]);
    expect(await WishlistMember.findOne({ wishlist: wid, user: bob })).toBeNull();
  });

  it('a member cannot touch an owner', async () => {
    as(dave);
    const res = await deleteOwner(req(`/api/wishlists/${wid}/owners/${bob}`, 'DELETE'), {
      params: Promise.resolve({ id: wid, userId: bob }),
    });
    expect(res.status).toBe(403);
    expect((await Wishlist.findById(wid))!.owners).toHaveLength(2);
  });
});

describe('a wishlist always keeps an owner', () => {
  it('the sole owner cannot leave — they must delete the wishlist', async () => {
    await Wishlist.updateOne({ _id: wid }, { $set: { owners: [alice], featuredBy: [] } });

    as(alice);
    const res = await leave(req(`/api/wishlists/${wid}/members/me`, 'DELETE'), {
      params: Promise.resolve({ id: wid }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/only owner/i);
    expect((await Wishlist.findById(wid))!.owners.map(String)).toEqual([alice]);
  });

  // One request at a time, the owners endpoints can't reach the last-owner case (you
  // must be a *different* owner to act, so at least two exist) — they send you to
  // "leave" instead, which is where the pre-check bites. `isLastOwner` is
  // unit-tested; concurrent requests *can* reach it — see the race tests below.
  it('an owner removing themselves is redirected to leaving', async () => {
    as(bob);
    const res = await deleteOwner(req(`/api/wishlists/${wid}/owners/${bob}`, 'DELETE'), {
      params: Promise.resolve({ id: wid, userId: bob }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/leave the wishlist/i);
    expect((await Wishlist.findById(wid))!.owners).toHaveLength(2);
  });
});

// regression: leave, demote and remove checked `isLastOwner` against a wishlist
// read earlier, then `$pull`ed the owner in a separate write (check-then-act). Two
// co-owners stepping down at the same moment both passed the check and left the
// list with `owners: []` — unreachable, and nobody could manage it. The schema's
// non-empty validator doesn't run on `updateOne`, so nothing caught it.
describe('racing removals still leave the wishlist an owner', () => {
  it('regression: two removals checked against the same stale read — only one lands', async () => {
    await Wishlist.updateOne({ _id: wid }, { $set: { featuredBy: [alice, bob] } });
    const stale = (await Wishlist.findById(wid))!;
    // Each sees the other still there, so both pass the pre-check.
    expect(isLastOwner(stale, alice)).toBe(false);
    expect(isLastOwner(stale, bob)).toBe(false);

    expect(await removeWishlistOwner(stale, alice, { actorId: alice, keepAsMember: false })).toBe(
      'removed'
    );
    expect(await removeWishlistOwner(stale, bob, { actorId: bob, keepAsMember: true })).toBe(
      'last-owner'
    );

    const wl = await Wishlist.findById(wid);
    expect(wl!.owners.map(String)).toEqual([bob]);
    // The refused demotion changed nothing: bob keeps his pin and gets no member row.
    expect(wl!.featuredBy.map(String)).toEqual([bob]);
    expect(await WishlistMember.findOne({ wishlist: wid, user: bob })).toBeNull();
  });

  it('refuses to remove someone who is no longer an owner', async () => {
    const stale = (await Wishlist.findById(wid))!;
    await Wishlist.updateOne({ _id: wid }, { $pull: { owners: bob } });

    // The stale read still lists bob, but the write only acts on the list as it is.
    // Only the refusal is pinned here: this miss still reports the last-owner reason,
    // and telling "already removed" apart from it is a separate change.
    expect(await removeWishlistOwner(stale, bob, { actorId: alice, keepAsMember: true })).not.toBe(
      'removed'
    );
    expect(await WishlistMember.findOne({ wishlist: wid, user: bob })).toBeNull();
    expect((await Wishlist.findById(wid))!.owners.map(String)).toEqual([alice]);
  });

  // regression: the removal write re-checked only the target, so an owner who had
  // just been taken off the list could still remove another owner.
  it('regression: refuses a removal by someone who is no longer an owner', async () => {
    const erin = (await User.create({ email: 'e@x.com', username: 'erin' }))._id.toString();
    await Wishlist.updateOne(
      { _id: wid },
      { $set: { owners: [alice, bob, erin], featuredBy: [bob] } }
    );
    const stale = (await Wishlist.findById(wid))!;
    await Wishlist.updateOne({ _id: wid }, { $pull: { owners: alice } });

    // The stale read still lists alice as an owner; the write checks the list as it is.
    expect(await removeWishlistOwner(stale, bob, { actorId: alice, keepAsMember: true })).toBe(
      'actor-not-owner'
    );
    const wl = await Wishlist.findById(wid);
    expect(wl!.owners.map(String)).toEqual([bob, erin]);
    expect(wl!.featuredBy.map(String)).toEqual([bob]);
    expect(await WishlistMember.findOne({ wishlist: wid, user: bob })).toBeNull();
  });

  /**
   * Holds every `Wishlist.updateOne` until `n` are waiting, then lets them all
   * through at once. So every racing request has finished its reads and its
   * `isLastOwner` pre-check before any of them writes — the interleaving the
   * race needs, which a bare `Promise.all` would only hit by luck. If fewer than
   * `n` ever arrive, a fallback lets them through so the test fails on `writes()`
   * instead of hanging until the timeout.
   *
   * With `deleteLast`, `Wishlist.findOneAndDelete` (which `findByIdAndDelete`
   * goes through) is held and counted too, and only let through once the held
   * `updateOne`s have landed. So a delete racing a removal always runs second,
   * after the removal has taken effect.
   */
  function holdWishlistWritesUntil(n: number, { deleteLast = false } = {}) {
    const updateOne = Wishlist.updateOne.bind(Wishlist) as (...args: unknown[]) => unknown;
    const findOneAndDelete = Wishlist.findOneAndDelete.bind(Wishlist) as (
      ...args: unknown[]
    ) => unknown;
    let writes = 0;
    let release!: () => void;
    const allWaiting = new Promise<void>((resolve) => (release = resolve));
    const fallback = setTimeout(release, 1000);
    const arrive = () => {
      if (++writes === n) release();
    };
    const updates: Promise<unknown>[] = [];
    const spies: { mockRestore(): void }[] = [
      vi.spyOn(Wishlist, 'updateOne').mockImplementation(((...args: unknown[]) => {
        arrive();
        const update = allWaiting.then(() => updateOne(...args));
        updates.push(update);
        return update;
      }) as never),
    ];
    if (deleteLast) {
      spies.push(
        vi.spyOn(Wishlist, 'findOneAndDelete').mockImplementation(((...args: unknown[]) => {
          arrive();
          return allWaiting
            .then(() => Promise.allSettled(updates))
            .then(() => findOneAndDelete(...args));
        }) as never)
      );
    }
    return {
      writes: () => writes,
      restore() {
        clearTimeout(fallback);
        spies.forEach((spy) => spy.mockRestore());
      },
    };
  }

  // `auth()` is the first thing each handler calls, synchronously on invocation,
  // so a one-shot session per call is consumed by that call even when they race.
  // Each resolves to who acted and what they got back, so a test can tell whose
  // request was refused, and check it was refused for the right reason.
  type Raced = { actor: string; res: Response };
  const leaveAs = async (user: string): Promise<Raced> => {
    session.mockResolvedValueOnce({ user: { id: user } } as never);
    const res = await leave(req(`/api/wishlists/${wid}/members/me`, 'DELETE'), {
      params: Promise.resolve({ id: wid }),
    });
    return { actor: user, res };
  };
  const demoteAs = async (user: string, target: string): Promise<Raced> => {
    session.mockResolvedValueOnce({ user: { id: user } } as never);
    const res = await patchOwner(req(`/api/wishlists/${wid}/owners/${target}`, 'PATCH'), {
      params: Promise.resolve({ id: wid, userId: target }),
    });
    return { actor: user, res };
  };
  const removeAs = async (user: string, target: string): Promise<Raced> => {
    session.mockResolvedValueOnce({ user: { id: user } } as never);
    const res = await deleteOwner(req(`/api/wishlists/${wid}/owners/${target}`, 'DELETE'), {
      params: Promise.resolve({ id: wid, userId: target }),
    });
    return { actor: user, res };
  };

  /** The one request that got through, and the one that was refused. */
  async function race(requests: () => Promise<Raced>[]) {
    const held = holdWishlistWritesUntil(2);
    let results: Raced[];
    try {
      results = await Promise.all(requests());
    } finally {
      held.restore();
    }
    // Both got past every pre-check to the owner write, so the race really ran.
    expect(held.writes()).toBe(2);
    const [won, refused] = [...results].sort((a, b) => a.res.status - b.res.status);
    expect(won.res.status).toBe(200);
    return { won, refused };
  }

  it.each([
    ['both co-owners leave', () => [leaveAs(alice), leaveAs(bob)]],
    ['one leaves while demoting the other', () => [leaveAs(alice), demoteAs(alice, bob)]],
    ['one leaves while removing the other', () => [leaveAs(alice), removeAs(alice, bob)]],
    ['they demote each other', () => [demoteAs(alice, bob), demoteAs(bob, alice)]],
    ['they remove each other', () => [removeAs(alice, bob), removeAs(bob, alice)]],
  ])('regression: %s at once — exactly one succeeds', async (_, requests) => {
    await Wishlist.updateOne({ _id: wid }, { $set: { featuredBy: [alice, bob] } });
    // Stale bookings held by each owner: the refused request must not free its own.
    const items = {
      [alice]: await makeItem('booked', alice),
      [bob]: await makeItem('booked', bob),
    };

    const { refused } = await race(requests);

    const wl = await Wishlist.findById(wid);
    expect(wl!.owners).toHaveLength(1);
    const [remaining] = wl!.owners.map(String);
    // An owner still standing was refused as the last one; one the winner already
    // took off the list isn't an owner any more, and is answered like any non-owner.
    const stillOwner = refused.actor === remaining;
    expect(refused.res.status).toBe(stillOwner ? 400 : 403);
    expect((await refused.res.json()).error).toMatch(
      stillOwner ? /only owner|at least one owner/i : /only an owner can change/i
    );
    // The one left standing is untouched: still pinned, no member row, booking held.
    expect(wl!.featuredBy.map(String)).toEqual([remaining]);
    expect(await WishlistMember.findOne({ wishlist: wid, user: remaining })).toBeNull();
    expect((await Item.findById(items[remaining]))?.bookedBy?.toString()).toBe(remaining);
  });

  // regression: demote and remove checked that the *caller* is an owner against the
  // wishlist read at the start of the request, and the removal write re-checked only
  // the *target*. With three or more owners the last-owner guard never trips, so two
  // owners removing each other at the same moment both landed: each made an
  // owner-only change after the other had already taken their ownership away.
  type Op = 'demote' | 'remove';
  it.each<[string, Op, Op]>([
    ['two owners remove each other', 'remove', 'remove'],
    ['two owners demote each other', 'demote', 'demote'],
    ['one owner demotes another who is removing them', 'demote', 'remove'],
  ])('regression: on a three-owner list, %s at once — only one lands', async (_, first, second) => {
    const erin = (await User.create({ email: 'e@x.com', username: 'erin' }))._id.toString();
    await Wishlist.updateOne(
      { _id: wid },
      { $set: { owners: [alice, bob, erin], featuredBy: [alice, bob, erin] } }
    );
    const items = {
      [alice]: await makeItem('booked', alice),
      [bob]: await makeItem('booked', bob),
    };
    const act = { demote: demoteAs, remove: removeAs };

    const { won, refused } = await race(() => [act[first](alice, bob), act[second](bob, alice)]);

    // The winner took the loser's ownership first, so the loser was no longer an
    // owner when their own write ran: answered like any non-owner.
    expect(refused.res.status).toBe(403);
    expect((await refused.res.json()).error).toMatch(/only an owner can change/i);

    const winner = won.actor;
    const loser = refused.actor;
    const wl = await Wishlist.findById(wid);
    expect(wl!.owners.map(String).sort()).toEqual([winner, erin].sort());
    expect(wl!.featuredBy.map(String).sort()).toEqual([winner, erin].sort());
    // The refused request did nothing to the winner: no member row, booking held.
    expect(await WishlistMember.findOne({ wishlist: wid, user: winner })).toBeNull();
    expect((await Item.findById(items[winner]))?.bookedBy?.toString()).toBe(winner);
    // The winning request did its own job: a demoted loser stays on as a member.
    const winningOp = winner === alice ? first : second;
    expect(!!(await WishlistMember.exists({ wishlist: wid, user: loser }))).toBe(
      winningOp === 'demote'
    );
  });

  describe('an owner-only write re-checks the caller at the write', () => {
    const deleteListAs = async (user: string): Promise<Raced> => {
      session.mockResolvedValueOnce({ user: { id: user } } as never);
      const res = await deleteWishlist(req(`/api/wishlists/${wid}`, 'DELETE'), {
        params: Promise.resolve({ id: wid }),
      });
      return { actor: user, res };
    };

    // regression: deleting a list checked that the caller owns it against the list
    // read at the start of the request, then deleted its items, memberships and the
    // list itself in separate writes. A co-owner who removed the caller in between
    // didn't stop it: the whole list was gone on the say-so of someone who no longer
    // owned it.
    it.each([
      ['removes', removeAs],
      ['demotes', demoteAs],
    ])(
      'regression: a co-owner %s an owner while they delete the list — the list survives',
      async (_, takeOwnership) => {
        const itemId = await makeItem();
        await WishlistInvite.create({ wishlist: wid, invitedBy: bob, invitedUser: carol });

        const held = holdWishlistWritesUntil(2, { deleteLast: true });
        let lost: Raced, deleted: Raced;
        try {
          [lost, deleted] = await Promise.all([takeOwnership(bob, alice), deleteListAs(alice)]);
        } finally {
          held.restore();
        }

        // Both got past every pre-check to their write, so the race really ran,
        // and the removal landed first.
        expect(held.writes()).toBe(2);
        expect(lost.res.status).toBe(200);
        // By the time her delete ran, alice was no longer an owner: answered like
        // any non-owner, with nothing deleted.
        expect(deleted.res.status).toBe(403);
        expect((await deleted.res.json()).error).toMatch(/only an owner can delete/i);
        expect((await Wishlist.findById(wid))!.owners.map(String)).toEqual([bob]);
        expect(await Item.findById(itemId)).not.toBeNull();
        expect(await WishlistMember.exists({ wishlist: wid, user: carol })).toBeTruthy();
        expect(await WishlistMember.exists({ wishlist: wid, user: dave })).toBeTruthy();
        expect(await WishlistInvite.countDocuments({ wishlist: wid, invitedUser: carol })).toBe(1);
      }
    );

    it('two owners deleting the list at once: one deletes it, the other gets a 404', async () => {
      const held = holdWishlistWritesUntil(2, { deleteLast: true });
      let results: Raced[];
      try {
        results = await Promise.all([deleteListAs(alice), deleteListAs(bob)]);
      } finally {
        held.restore();
      }

      // Both found the list and reached the delete before either landed.
      expect(held.writes()).toBe(2);
      expect(results.map((r) => r.res.status).sort()).toEqual([200, 404]);
      expect(await Wishlist.findById(wid)).toBeNull();
    });

    /**
     * Alice kicks carol, and `meanwhile` runs to completion while her kick looks
     * the membership up: after her access check passed, before the kick changes
     * anything. Resolves to the kick's response and whatever `meanwhile` returned.
     */
    async function kickCarolAsAliceWhile<T>(meanwhile: () => Promise<T>) {
      const memberId = (await WishlistMember.findOne({ wishlist: wid, user: carol }))!._id;
      const findMembership = WishlistMember.findById.bind(WishlistMember) as (
        ...args: unknown[]
      ) => PromiseLike<unknown>;
      let during: T | undefined;
      const spy = vi.spyOn(WishlistMember, 'findById').mockImplementationOnce(((
        ...args: unknown[]
      ) =>
        findMembership(...args).then(async (membership) => {
          during = await meanwhile();
          return membership;
        })) as never);
      try {
        session.mockResolvedValueOnce({ user: { id: alice } } as never);
        const kicked = await deleteMember(
          req(`/api/wishlists/${wid}/members/${memberId}`, 'DELETE'),
          { params: Promise.resolve({ id: wid, memberId: memberId.toString() }) }
        );
        return { kicked, during, memberId };
      } finally {
        spy.mockRestore();
      }
    }

    // regression: kicking a member checked that the caller owns the list against the
    // list read at the start of the request, then freed the member's bookings and
    // deleted their membership. An owner whom a co-owner removed in between could
    // still take a member off the list.
    it('regression: an owner removed after their access check cannot kick a member', async () => {
      const itemId = await makeItem('booked', carol);
      await WishlistInvite.create({
        wishlist: wid,
        invitedBy: bob,
        invitedUser: carol,
        role: 'owner',
      });

      const {
        kicked,
        during: removal,
        memberId,
      } = await kickCarolAsAliceWhile(() => removeAs(bob, alice));

      expect(removal?.res.status).toBe(200);
      expect(kicked.status).toBe(403);
      expect((await kicked.json()).error).toMatch(/owner access required/i);
      // Carol is still on the list, with her booking and her pending invite.
      expect(await WishlistMember.exists({ _id: memberId })).toBeTruthy();
      expect((await Item.findById(itemId))?.bookedBy?.toString()).toBe(carol);
      expect(await WishlistInvite.countDocuments({ wishlist: wid, invitedUser: carol })).toBe(1);
    });

    it('a kick racing a co-owner deleting the list answers 404, not "not an owner"', async () => {
      const { kicked, during: deleted } = await kickCarolAsAliceWhile(() => deleteListAs(bob));

      expect(deleted?.res.status).toBe(200);
      // Alice was an owner all along: the list is gone, not her ownership.
      expect(kicked.status).toBe(404);
    });
  });
});

describe('featuring is per-owner', () => {
  it('one owner pinning the list does not pin it for the other', async () => {
    as(alice);
    const res = await patchWishlist(req(`/api/wishlists/${wid}`, 'PATCH', { featured: true }), {
      params: Promise.resolve({ id: wid }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.featured).toBe(true);

    expect((await Wishlist.findById(wid))!.featuredBy.map(String)).toEqual([alice]);

    as(bob);
    const bobView = await getWishlist(req(`/api/wishlists/${wid}`), {
      params: Promise.resolve({ id: wid }),
    });
    expect((await bobView.json()).data.featured).toBe(false);
  });

  it('pinning a list unpins only the caller’s other list', async () => {
    const other = await Wishlist.create({
      name: 'Other',
      slug: 'other',
      owners: [alice, bob],
      featuredBy: [alice, bob],
      visibility: 'everyone',
    });

    as(alice);
    await patchWishlist(req(`/api/wishlists/${wid}`, 'PATCH', { featured: true }), {
      params: Promise.resolve({ id: wid }),
    });

    // Alice moved her pin; Bob's stays where it was.
    expect((await Wishlist.findById(other._id))!.featuredBy.map(String)).toEqual([bob]);
    expect((await Wishlist.findById(wid))!.featuredBy.map(String)).toEqual([alice]);
  });

  it('a member cannot feature the list', async () => {
    as(dave);
    const res = await patchWishlist(req(`/api/wishlists/${wid}`, 'PATCH', { featured: true }), {
      params: Promise.resolve({ id: wid }),
    });
    expect(res.status).toBe(403);
  });
});

/**
 * A booking can only ever be released by whoever holds it, and owners are
 * booking-blind. So any move into ownership has to free the items first,
 * otherwise they sit claimed forever: invisible to the person holding them,
 * hidden from the owners, and unbookable by anyone else.
 */
describe('bookings are never stranded by a role change', () => {
  async function bookedByCarol() {
    const itemId = await makeItem('booked', carol);
    await Reservation.create({
      gifter: carol,
      wishlist: wid,
      item: itemId,
      owner: alice,
      itemName: 'Gift',
      wishlistName: 'Family list',
    });
    return itemId;
  }

  const carolMembership = () => WishlistMember.findOne({ wishlist: wid, user: carol });

  it('accepting co-ownership frees the items and cancels the reservations', async () => {
    const itemId = await bookedByCarol();
    const inv = await WishlistInvite.create({
      wishlist: wid,
      invitedBy: alice,
      invitedUser: carol,
      role: 'owner',
    });

    as(carol);
    const res = await respondInvite(req(`/api/invites/${inv._id}`, 'PATCH', { action: 'accept' }), {
      params: Promise.resolve({ inviteId: inv._id.toString() }),
    });
    expect(res.status).toBe(200);
    // Their own data, so the counts are fine to hand back here.
    const body = await res.json();
    expect(body.data.releasedBookings).toBe(1);
    expect(body.data.cancelledReservations).toBe(1);

    const item = await Item.findById(itemId);
    expect(item?.status).toBe('available');
    expect(item?.bookedBy).toBeNull();
    // You can't be your own gifter, so the reservation goes too.
    expect(await Reservation.findOne({ gifter: carol, item: itemId })).toBeNull();
  });

  it('leaving frees the items but keeps the reservation', async () => {
    const itemId = await bookedByCarol();

    as(carol);
    const res = await leave(req(`/api/wishlists/${wid}/members/me`, 'DELETE'), {
      params: Promise.resolve({ id: wid }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data.unbookedItemsCount).toBe(1);

    expect((await Item.findById(itemId))?.status).toBe('available');
    // They may still have bought it, so they keep the ability to log the gift.
    expect(await Reservation.findOne({ gifter: carol, item: itemId })).not.toBeNull();
  });

  it('being removed frees the items but keeps the reservation', async () => {
    const itemId = await bookedByCarol();
    const membership = await carolMembership();

    as(alice);
    const res = await deleteMember(
      req(`/api/wishlists/${wid}/members/${membership!._id}`, 'DELETE'),
      { params: Promise.resolve({ id: wid, memberId: membership!._id.toString() }) }
    );
    expect(res.status).toBe(200);

    expect((await Item.findById(itemId))?.status).toBe('available');
    expect(await Reservation.findOne({ gifter: carol, item: itemId })).not.toBeNull();
  });

  it('demoting an owner still frees any booking they held', async () => {
    // A stale booking held by an owner: they couldn't see it, so don't leave it
    // stuck when they step down.
    const itemId = await makeItem('booked', bob);

    as(alice);
    const res = await patchOwner(req(`/api/wishlists/${wid}/owners/${bob}`, 'PATCH'), {
      params: Promise.resolve({ id: wid, userId: bob }),
    });
    expect(res.status).toBe(200);

    // Back to being a member, they can see and cancel it themselves.
    const item = await Item.findById(itemId);
    expect(item?.status).toBe('booked');
    expect(item?.bookedBy?.toString()).toBe(bob);
  });

  // Members keep access at every visibility tier, and only members can book, so
  // tightening visibility can't orphan a booking the way a role change can.
  it('tightening visibility leaves a member able to unbook', async () => {
    const itemId = await bookedByCarol();

    as(alice);
    await patchWishlist(req(`/api/wishlists/${wid}`, 'PATCH', { visibility: 'private' }), {
      params: Promise.resolve({ id: wid }),
    });

    as(carol);
    const res = await patchItem(req(`/api/items/${itemId}`, 'PATCH', { status: 'available' }), {
      params: Promise.resolve({ id: itemId }),
    });
    expect(res.status).toBe(200);
    expect((await Item.findById(itemId))?.bookedBy).toBeNull();
  });
});

describe('the admin role is gone', () => {
  it('membership carries no role at all', async () => {
    const membership = await WishlistMember.findOne({ wishlist: wid, user: carol }).lean();
    expect(membership).not.toBeNull();
    expect(membership).not.toHaveProperty('role');
  });

  it('rejects an admin invite', async () => {
    await User.create({ email: 'e@x.com', username: 'erin' });
    as(alice);
    const res = await invite(
      req(`/api/wishlists/${wid}/members`, 'POST', { username: 'erin', role: 'admin' }),
      { params: Promise.resolve({ id: wid }) }
    );
    expect(res.status).toBe(400);
    expect(await WishlistInvite.findOne({ wishlist: wid })).toBeNull();
  });

  // Without the admin tier, a member has no management powers whatsoever.
  it('a member cannot see the members list, add items, or edit the wishlist', async () => {
    as(carol);

    const members = await getMembers(req(`/api/wishlists/${wid}/members`), {
      params: Promise.resolve({ id: wid }),
    });
    expect(members.status).toBe(403);

    const settings = await patchWishlist(req(`/api/wishlists/${wid}`, 'PATCH', { name: 'Mine' }), {
      params: Promise.resolve({ id: wid }),
    });
    expect(settings.status).toBe(403);

    // They can still propose, just not publish.
    const item = await postItem(
      req(`/api/wishlists/${wid}/items`, 'POST', { name: 'Direct', status: 'available' }),
      { params: Promise.resolve({ id: wid }) }
    );
    expect(item.status).toBe(403);
  });

  it('a member never sees draft items', async () => {
    await makeItem('draft');
    as(carol);
    const res = await getItems(req(`/api/wishlists/${wid}/items`), {
      params: Promise.resolve({ id: wid }),
    });
    expect((await res.json()).data).toHaveLength(0);
  });
});

describe('owner responses stay privacy-safe', () => {
  // regression: an earlier version selected `email` when returning the affected
  // user, handing another person's account email to whoever changed their role.
  it('regression: demoting an owner never exposes their email', async () => {
    as(alice);
    const res = await patchOwner(req(`/api/wishlists/${wid}/owners/${bob}`, 'PATCH'), {
      params: Promise.resolve({ id: wid, userId: bob }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.user.username).toBe('bob');
    expect(JSON.stringify(body)).not.toContain('b@x.com');
  });
});
