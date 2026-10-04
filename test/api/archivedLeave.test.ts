import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendWishlistInvitationEmail: vi.fn() }));

import { auth } from '@/lib/auth';
import { DELETE as leave } from '@/app/api/wishlists/[id]/members/me/route';
import { GET as getWishlist } from '@/app/api/wishlists/[id]/route';
import { DELETE as kick } from '@/app/api/wishlists/[id]/members/[memberId]/route';
import {
  PATCH as demote,
  DELETE as removeOwner,
} from '@/app/api/wishlists/[id]/owners/[userId]/route';
import { promoteMemberToOwner } from '@/lib/utils/wishlistOwnership';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import Notification from '@/models/Notification';

const session = vi.mocked(auth);

let alice: string; // owner
let bob: string; // co-owner
let carol: string; // member, with a booking and a pending promotion
let erin: string; // signed in, nothing to do with the list
let frank: string; // has a pending invite to the list, so isn't on it yet
let itemId: string;

const SLUG = 'surprise-party';
/** What the leave route answers for a list that doesn't exist. */
const NOT_FOUND = { status: 404, body: { success: false, error: 'Wishlist not found' } };
const NOT_A_MEMBER = {
  status: 404,
  body: { success: false, error: 'You are not a member of this wishlist' },
};

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  const user = async (username: string) =>
    (await User.create({ email: `${username}@x.com`, username }))._id.toString();
  alice = await user('alice');
  bob = await user('bob');
  carol = await user('carol');
  erin = await user('erin');
  frank = await user('frank');
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The list every test acts on, archived or not, with carol on it as a gifter. */
async function makeList({ archived }: { archived: boolean }) {
  const wl = await Wishlist.create({
    name: 'Surprise party',
    slug: SLUG,
    owners: [alice, bob],
    featuredBy: [alice, bob],
    visibility: 'everyone',
    archived,
  });
  const id = wl._id.toString();
  await WishlistMember.create({ wishlist: id, user: carol });
  const item = await Item.create({ wishlist: id, name: 'Gift', status: 'booked', bookedBy: carol });
  itemId = item._id.toString();
  await Reservation.create({
    gifter: carol,
    wishlist: id,
    item: item._id,
    owner: alice,
    itemName: 'Gift',
    wishlistName: 'Surprise party',
  });
  // A promotion carol hasn't answered, and an invite frank hasn't.
  await WishlistInvite.create({
    wishlist: id,
    invitedBy: alice,
    invitedUser: carol,
    role: 'owner',
    promotion: true,
  });
  await WishlistInvite.create({ wishlist: id, invitedBy: alice, invitedUser: frank });
  await Notification.create([
    { user: carol, type: 'wishlist_invite', wishlist: id, wishlistName: 'Surprise party' },
    { user: frank, type: 'wishlist_invite', wishlist: id, wishlistName: 'Surprise party' },
  ]);
  return id;
}

function req(url: string, method = 'GET') {
  return new NextRequest('http://localhost' + url, { method });
}

type Answer = { status: number; body: unknown };

/**
 * Sends `send` for the list at `list` (an id or a slug) as `userId`, signed out
 * for `null`. `auth()` is the first thing every handler calls, so the one-shot
 * session is consumed by this request even when another runs alongside it.
 */
async function as(
  userId: string | null,
  send: (list: string) => Promise<Response>,
  list: string
): Promise<Answer> {
  session.mockResolvedValueOnce((userId ? { user: { id: userId } } : null) as never);
  const res = await send(list);
  return { status: res.status, body: await res.json() };
}

const leaveRoute = (list: string) =>
  leave(req(`/api/wishlists/${list}/members/me`, 'DELETE'), {
    params: Promise.resolve({ id: list }),
  });
const viewRoute = (list: string) =>
  getWishlist(req(`/api/wishlists/${list}`), { params: Promise.resolve({ id: list }) });

const leaveAs = (userId: string | null, list: string) => as(userId, leaveRoute, list);

const missingId = () => new mongoose.Types.ObjectId().toString();

/** Everything a leave could change. */
async function snapshot() {
  const wl = await Wishlist.findOne({ slug: SLUG }).lean();
  return {
    wishlist: wl && {
      archived: wl.archived,
      owners: wl.owners.map(String),
      featuredBy: wl.featuredBy.map(String),
    },
    members: (await WishlistMember.find().lean()).map((m) => m.user.toString()).sort(),
    invites: (await WishlistInvite.find().lean())
      .map((i) => `${i.invitedUser}:${i.role}:${i.status}`)
      .sort(),
    items: (await Item.find().lean()).map((i) => `${i.status}:${i.bookedBy ?? ''}`),
    reservations: (await Reservation.find().lean()).map((r) => r.gifter.toString()),
    notifications: (await Notification.find().lean()).map((n) => n.user.toString()).sort(),
  };
}

const NON_MEMBERS = [
  ['a signed-in stranger', () => erin],
  ['someone with a pending invite', () => frank],
] as const;

// regression: the leave route answered a signed-in caller who isn't on an archived
// list with 404 `You are not a member of this wishlist`, and a list that doesn't
// exist with 404 `Wishlist not found`. So anyone holding, or guessing, an archived
// list's id or slug could tell that it exists by trying to leave it.
describe('DELETE /api/wishlists/[id]/members/me on an archived list', () => {
  it.each(NON_MEMBERS)(
    'regression: answers %s exactly as for a list that does not exist, and changes nothing',
    async (_, caller) => {
      const id = await makeList({ archived: true });
      const before = await snapshot();

      const missing = await leaveAs(caller(), missingId());
      expect(missing).toEqual(NOT_FOUND);
      // By id and by slug alike.
      expect(await leaveAs(caller(), id)).toEqual(missing);
      expect(await leaveAs(caller(), SLUG)).toEqual(await leaveAs(caller(), 'no-such-list'));
      // As viewing it does.
      expect(await as(caller(), viewRoute, id)).toEqual(missing);

      expect(await snapshot()).toEqual(before);
    }
  );

  // regression: the route looked the list up before checking the session, so a
  // signed-out caller got 404 for a list that doesn't exist and 401 for one that does.
  it('regression: answers a signed-out caller exactly as for a list that does not exist', async () => {
    const id = await makeList({ archived: true });
    const before = await snapshot();

    const missing = await leaveAs(null, missingId());
    expect(missing.status).toBe(401);
    expect(await leaveAs(null, id)).toEqual(missing);
    expect(await leaveAs(null, SLUG)).toEqual(missing);
    expect(await leaveAs(null, 'no-such-list')).toEqual(missing);

    expect(await snapshot()).toEqual(before);
  });
});

describe.each([true, false])('DELETE /api/wishlists/[id]/members/me, archived: %s', (archived) => {
  // Leaving only takes access away, and an archived list may be unarchived later
  // with its members still on it, so they may leave it as they may any other list.
  it('lets a member leave: frees their bookings, keeps their reservation, cancels their invites', async () => {
    const id = await makeList({ archived });

    const res = await leaveAs(carol, id);
    expect(res).toEqual({ status: 200, body: { success: true, data: { unbookedItemsCount: 1 } } });

    const after = await snapshot();
    expect(after.wishlist).toEqual({ archived, owners: [alice, bob], featuredBy: [alice, bob] });
    expect(after.members).toEqual([]);
    expect(after.items).toEqual(['available:']);
    // They may still have bought it, so they can still log the gift.
    expect(after.reservations).toEqual([carol]);
    // Their pending promotion is gone, and its notification with it. Frank's stays.
    expect(after.invites).toEqual([`${frank}:member:pending`]);
    expect(after.notifications).toEqual([frank]);
  });

  it('lets a co-owner step down, and still refuses the sole owner', async () => {
    const id = await makeList({ archived });

    const stepDown = await leaveAs(bob, id);
    expect(stepDown.status).toBe(200);
    expect(stepDown.body).toMatchObject({ success: true, data: { wasOwner: true } });
    expect((await snapshot()).wishlist).toEqual({ archived, owners: [alice], featuredBy: [alice] });

    expect(await leaveAs(alice, id)).toEqual({
      status: 400,
      body: { success: false, error: 'You are the only owner. Delete the wishlist instead.' },
    });
    expect((await snapshot()).wishlist).toEqual({ archived, owners: [alice], featuredBy: [alice] });
  });
});

describe('DELETE /api/wishlists/[id]/members/me on a list that is not archived', () => {
  // Its existence is no secret: viewing it says as much.
  it.each(NON_MEMBERS)('still tells %s they are not a member', async (_, caller) => {
    const id = await makeList({ archived: false });
    const before = await snapshot();

    expect(await leaveAs(caller(), id)).toEqual(NOT_A_MEMBER);
    expect(await leaveAs(caller(), SLUG)).toEqual(NOT_A_MEMBER);
    expect(await snapshot()).toEqual(before);
  });

  it('answers a signed-out caller with 401 whether or not the list exists', async () => {
    const id = await makeList({ archived: false });

    const missing = await leaveAs(null, missingId());
    expect(missing).toEqual({
      status: 401,
      body: { success: false, error: 'Unauthorized - Please sign in' },
    });
    expect(await leaveAs(null, id)).toEqual(missing);
  });
});

/** Alice takes bob off the owners, or demotes him to a member. */
const aliceRemovesBob = (id: string) =>
  as(
    alice,
    (list) =>
      removeOwner(req(`/api/wishlists/${list}/owners/${bob}`, 'DELETE'), {
        params: Promise.resolve({ id: list, userId: bob }),
      }),
    id
  );
const aliceDemotesBob = (id: string) =>
  as(
    alice,
    (list) =>
      demote(req(`/api/wishlists/${list}/owners/${bob}`, 'PATCH'), {
        params: Promise.resolve({ id: list, userId: bob }),
      }),
    id
  );

/** Runs `request` with the first `model[method]` call held while `meanwhile` lands. */
async function racing<T>(
  model: object,
  method: string,
  meanwhile: () => Promise<T>,
  request: () => Promise<Answer>
) {
  const race = holdFirstCall(model, method, meanwhile);
  try {
    const answer = await request();
    // The request got as far as the held call, so the race really ran.
    expect(race.held()).toBe(true);
    return { answer, meanwhile: race.outcome() };
  } finally {
    race.restore();
  }
}

describe.each([
  [true, NOT_FOUND],
  [false, NOT_A_MEMBER],
])('leaving a list that someone changes mid-request, archived: %s', (archived, notOnList) => {
  // regression: a co-owner's leave that lost to their own removal answered 400 `You
  // are the only owner`. That's untrue, and an owner who lost ownership mid-request
  // must get what anyone else gets: on an archived list, the 404 of a missing one.
  it('regression: a co-owner removed before their leave lands is answered as anyone not on the list', async () => {
    const id = await makeList({ archived });

    // Held at bob's own ownership write, by when alice has removed him.
    const { answer, meanwhile } = await racing(
      Wishlist,
      'updateOne',
      () => aliceRemovesBob(id),
      () => leaveAs(bob, id)
    );

    expect(meanwhile?.status).toBe(200);
    expect(answer).toEqual(notOnList);
    // Only alice's removal of bob landed: carol's booking and invite are untouched.
    const after = await snapshot();
    expect(after.wishlist).toEqual({ archived, owners: [alice], featuredBy: [alice] });
    expect(after.members).toEqual([carol]);
    expect(after.items).toEqual([`booked:${carol}`]);
  });

  // regression: the same untrue 400, which also left them on the list they had
  // asked to leave.
  it('regression: a co-owner demoted before their leave lands leaves as the member it made them', async () => {
    const id = await makeList({ archived });

    const { answer, meanwhile } = await racing(
      Wishlist,
      'updateOne',
      () => aliceDemotesBob(id),
      () => leaveAs(bob, id)
    );

    expect(meanwhile?.status).toBe(200);
    expect(answer).toEqual({
      status: 200,
      body: { success: true, data: { unbookedItemsCount: 0 } },
    });
    // Off the list altogether, as they asked: neither an owner nor a member.
    const after = await snapshot();
    expect(after.wishlist).toEqual({ archived, owners: [alice], featuredBy: [alice] });
    expect(after.members).toEqual([carol]);
  });

  // regression: a member whose leave lost to a kick was told `You are not a member`
  // on an archived list too, which is no longer theirs to know about.
  it('regression: a member kicked before their leave lands is answered as anyone not on the list', async () => {
    const id = await makeList({ archived });
    const membership = (await WishlistMember.findOne({ user: carol }))!._id.toString();

    // Held at carol's membership delete, by when alice has kicked her.
    const { answer, meanwhile } = await racing(
      WishlistMember,
      'deleteOne',
      () =>
        as(
          alice,
          (list) =>
            kick(req(`/api/wishlists/${list}/members/${membership}`, 'DELETE'), {
              params: Promise.resolve({ id: list, memberId: membership }),
            }),
          id
        ),
      () => leaveAs(carol, id)
    );

    expect(meanwhile?.status).toBe(200);
    expect(answer).toEqual(notOnList);
    const after = await snapshot();
    expect(after.members).toEqual([]);
    expect(after.items).toEqual(['available:']);
    expect(after.reservations).toEqual([carol]);
    expect(after.invites).toEqual([`${frank}:member:pending`]);
  });

  it('a member promoted before their leave lands is still told they are not a member', async () => {
    const id = await makeList({ archived });
    const wishlist = (await Wishlist.findById(id))!;

    // Held at carol's membership delete, by when the promotion she'd accepted
    // has taken her membership row and made her an owner.
    const { answer, meanwhile } = await racing(
      WishlistMember,
      'deleteOne',
      () => promoteMemberToOwner(wishlist, carol),
      () => leaveAs(carol, id)
    );

    expect(meanwhile).not.toBeNull();
    // An owner, so not told the list doesn't exist, archived or not.
    expect(answer).toEqual(NOT_A_MEMBER);
    expect((await snapshot()).wishlist?.owners).toEqual([alice, bob, carol]);
  });
});
