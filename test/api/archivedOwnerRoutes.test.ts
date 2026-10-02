import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
const sendEmail = vi.fn();
vi.mock('@/lib/email', () => ({
  sendWishlistInvitationEmail: (...a: unknown[]) => sendEmail(...a),
}));

import { auth } from '@/lib/auth';
import {
  GET as getWishlist,
  PATCH as patchWishlist,
  DELETE as deleteWishlist,
} from '@/app/api/wishlists/[id]/route';
import { GET as getMembers, POST as invite } from '@/app/api/wishlists/[id]/members/route';
import { DELETE as kick } from '@/app/api/wishlists/[id]/members/[memberId]/route';
import { GET as getInvites } from '@/app/api/wishlists/[id]/invites/route';
import { DELETE as cancelInvite } from '@/app/api/wishlists/[id]/invites/[inviteId]/route';
import {
  POST as promote,
  PATCH as demote,
  DELETE as removeOwner,
} from '@/app/api/wishlists/[id]/owners/[userId]/route';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Notification from '@/models/Notification';

const session = vi.mocked(auth);

let alice: string; // owner
let bob: string; // co-owner
let carol: string; // member
let erin: string; // signed in, nothing to do with the list
let frank: string; // has a pending invite to the list
let carolMembership: string;
let frankInvite: string;

const SLUG = 'surprise-party';
/** What every route answers for a list that doesn't exist. */
const NOT_FOUND = { status: 404, body: { success: false, error: 'Wishlist not found' } };

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  sendEmail.mockReset();
  const user = async (username: string) =>
    (await User.create({ email: `${username}@x.com`, username }))._id.toString();
  alice = await user('alice');
  bob = await user('bob');
  carol = await user('carol');
  erin = await user('erin');
  frank = await user('frank');
  await user('dave'); // invited by POST /members
});

/** The list every test acts on, archived or not, with a member and an invite on it. */
async function makeList({ archived }: { archived: boolean }) {
  const wl = await Wishlist.create({
    name: 'Surprise party',
    slug: SLUG,
    owners: [alice, bob],
    featuredBy: [alice],
    visibility: 'everyone',
    isPublic: true,
    archived,
  });
  const id = wl._id.toString();
  carolMembership = (await WishlistMember.create({ wishlist: id, user: carol }))._id.toString();
  frankInvite = (
    await WishlistInvite.create({ wishlist: id, invitedBy: alice, invitedUser: frank })
  )._id.toString();
  return id;
}

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest('http://localhost' + url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

interface OwnerRoute {
  name: string;
  /** Sends the request for the list at `list` (an id or a slug). */
  send: (list: string) => Promise<Response>;
  /** What an owner gets back. */
  ownerStatus: number;
}

/** Every owner-only route on a list. */
const ROUTES: OwnerRoute[] = [
  {
    name: 'PATCH /api/wishlists/[id]',
    send: (id) =>
      patchWishlist(req(`/api/wishlists/${id}`, 'PATCH', { name: 'Renamed' }), {
        params: Promise.resolve({ id }),
      }),
    ownerStatus: 200,
  },
  {
    name: 'DELETE /api/wishlists/[id]',
    send: (id) =>
      deleteWishlist(req(`/api/wishlists/${id}`, 'DELETE'), { params: Promise.resolve({ id }) }),
    ownerStatus: 200,
  },
  {
    name: 'GET /api/wishlists/[id]/members',
    send: (id) =>
      getMembers(req(`/api/wishlists/${id}/members`), { params: Promise.resolve({ id }) }),
    ownerStatus: 200,
  },
  {
    name: 'POST /api/wishlists/[id]/members',
    send: (id) =>
      invite(req(`/api/wishlists/${id}/members`, 'POST', { username: 'dave' }), {
        params: Promise.resolve({ id }),
      }),
    ownerStatus: 201,
  },
  {
    name: 'DELETE /api/wishlists/[id]/members/[memberId]',
    send: (id) =>
      kick(req(`/api/wishlists/${id}/members/${carolMembership}`, 'DELETE'), {
        params: Promise.resolve({ id, memberId: carolMembership }),
      }),
    ownerStatus: 200,
  },
  {
    name: 'GET /api/wishlists/[id]/invites',
    send: (id) =>
      getInvites(req(`/api/wishlists/${id}/invites`), { params: Promise.resolve({ id }) }),
    ownerStatus: 200,
  },
  {
    name: 'DELETE /api/wishlists/[id]/invites/[inviteId]',
    send: (id) =>
      cancelInvite(req(`/api/wishlists/${id}/invites/${frankInvite}`, 'DELETE'), {
        params: Promise.resolve({ id, inviteId: frankInvite }),
      }),
    ownerStatus: 200,
  },
  {
    name: 'POST /api/wishlists/[id]/owners/[userId]',
    send: (id) =>
      promote(req(`/api/wishlists/${id}/owners/${carol}`, 'POST'), {
        params: Promise.resolve({ id, userId: carol }),
      }),
    ownerStatus: 202,
  },
  {
    name: 'PATCH /api/wishlists/[id]/owners/[userId]',
    send: (id) =>
      demote(req(`/api/wishlists/${id}/owners/${bob}`, 'PATCH'), {
        params: Promise.resolve({ id, userId: bob }),
      }),
    ownerStatus: 200,
  },
  {
    name: 'DELETE /api/wishlists/[id]/owners/[userId]',
    send: (id) =>
      removeOwner(req(`/api/wishlists/${id}/owners/${bob}`, 'DELETE'), {
        params: Promise.resolve({ id, userId: bob }),
      }),
    ownerStatus: 200,
  },
];

const route = (name: string) => ROUTES.find((r) => r.name === name)!;

/** `GET /api/wishlists/[id]`, which any viewer may send. */
const VIEW: Pick<OwnerRoute, 'send'> = {
  send: (id) => getWishlist(req(`/api/wishlists/${id}`), { params: Promise.resolve({ id }) }),
};

/**
 * Sends `route` as `userId` (signed out for `null`), and resolves to its answer.
 * `auth()` is the first thing every handler calls, so the one-shot session is
 * consumed by this request even when another one is running alongside it.
 */
async function call(route: Pick<OwnerRoute, 'send'>, list: string, userId: string | null) {
  session.mockResolvedValueOnce((userId ? { user: { id: userId } } : null) as never);
  const res = await route.send(list);
  return { status: res.status, body: await res.json() };
}

const missingId = () => new mongoose.Types.ObjectId().toString();

/** Everything an owner-only request could change. */
async function snapshot() {
  const wl = await Wishlist.findOne({ slug: SLUG }).lean();
  return {
    wishlist: wl && {
      name: wl.name,
      archived: wl.archived,
      owners: wl.owners.map(String),
      featuredBy: wl.featuredBy.map(String),
    },
    members: (await WishlistMember.find().lean()).map((m) => m.user.toString()).sort(),
    invites: (await WishlistInvite.find().lean())
      .map((i) => `${i.invitedUser}:${i.role}:${i.status}`)
      .sort(),
    notifications: await Notification.countDocuments(),
    emails: sendEmail.mock.calls.length,
  };
}

const NON_OWNERS = [
  ['a member', () => carol],
  ['a signed-in stranger', () => erin],
] as const;

// regression: `GET /api/wishlists/[id]` answers anyone but an archived list's
// owners with the 404 of a list that doesn't exist, but the owner-only routes on
// it answered a signed-in non-owner with 403 (and a missing list with 404). So
// anyone holding, or guessing, an archived list's id or slug (slugs come from the
// list's name) could tell that it exists by sending one of them.
describe.each(ROUTES)('$name on an archived list', (route) => {
  it.each(NON_OWNERS)(
    'regression: answers %s exactly as for a list that does not exist, and changes nothing',
    async (_, caller) => {
      const id = await makeList({ archived: true });
      const before = await snapshot();

      const missing = await call(route, missingId(), caller());
      expect(missing).toEqual(NOT_FOUND);
      // By id and by slug alike.
      expect(await call(route, id, caller())).toEqual(missing);
      expect(await call(route, SLUG, caller())).toEqual(
        await call(route, 'no-such-list', caller())
      );
      // As viewing it does.
      expect(await call(VIEW, id, caller())).toEqual(missing);

      expect(await snapshot()).toEqual(before);
    }
  );

  // regression: five of these routes looked the list up before checking the
  // session, so a signed-out caller got 404 for a list that doesn't exist and 401
  // for one that does.
  it('regression: answers a signed-out caller exactly as for a list that does not exist', async () => {
    const id = await makeList({ archived: true });

    const missing = await call(route, missingId(), null);
    expect(missing.status).toBe(401);
    expect(await call(route, id, null)).toEqual(missing);
    expect(await call(route, SLUG, null)).toEqual(missing);
  });

  it('lets an owner through', async () => {
    const id = await makeList({ archived: true });

    expect((await call(route, id, alice)).status).toBe(route.ownerStatus);
  });
});

describe.each(ROUTES)('$name on a list that is not archived', (route) => {
  // Its existence is no secret: viewing it says as much.
  it.each(NON_OWNERS)('still refuses %s with 403', async (_, caller) => {
    const id = await makeList({ archived: false });
    const before = await snapshot();

    expect((await call(route, id, caller())).status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });

  it('lets an owner through', async () => {
    const id = await makeList({ archived: false });

    expect((await call(route, id, alice)).status).toBe(route.ownerStatus);
  });
});

/** Bob takes alice off the owners, as the owners route does. */
const bobRemovesAlice = (id: string) =>
  call(
    {
      send: (list) =>
        removeOwner(req(`/api/wishlists/${list}/owners/${alice}`, 'DELETE'), {
          params: Promise.resolve({ id: list, userId: alice }),
        }),
    },
    id,
    bob
  );

/**
 * The routes that check the caller's ownership again at their write, or re-read
 * it right before it, and the call to hold so that bob's removal of alice lands
 * after her first check and before that one.
 */
const RACES: [string, object, string][] = [
  ['PATCH /api/wishlists/[id]', Wishlist, 'findOneAndUpdate'],
  ['DELETE /api/wishlists/[id]', Wishlist, 'findOneAndDelete'],
  ['POST /api/wishlists/[id]/members', WishlistMember, 'findOne'],
  ['DELETE /api/wishlists/[id]/members/[memberId]', WishlistMember, 'findById'],
  ['POST /api/wishlists/[id]/owners/[userId]', WishlistMember, 'exists'],
  ['PATCH /api/wishlists/[id]/owners/[userId]', Wishlist, 'updateOne'],
  ['DELETE /api/wishlists/[id]/owners/[userId]', Wishlist, 'updateOne'],
];

// regression: an owner whom a co-owner removes mid-request gets the answer any
// non-owner gets, and on an archived list that's now the 404 of a missing list.
// The answer was picked by a read that only asked whether the list exists, so it
// still said 403, and that it exists.
describe.each(RACES)('%s, as an owner removed mid-request', (name, model, method) => {
  it.each([
    [true, NOT_FOUND.status],
    [false, 403],
  ])('archived: %s — answers %i and changes nothing', async (archived, status) => {
    const id = await makeList({ archived });

    const race = holdFirstCall(model, method, () => bobRemovesAlice(id));
    let raced: Awaited<ReturnType<typeof call>>;
    try {
      raced = await call(route(name), id, alice);
      // Her request got as far as the held call, so the race really ran.
      expect(race.held()).toBe(true);
    } finally {
      race.restore();
    }
    expect(race.outcome()?.status).toBe(200);

    expect(raced.status).toBe(status);
    if (archived) expect(raced).toEqual(NOT_FOUND);
    // Nothing but bob's removal of alice landed.
    const after = await snapshot();
    expect(after.wishlist).toEqual({
      name: 'Surprise party',
      archived,
      owners: [bob],
      featuredBy: [],
    });
    expect(after.members).toEqual([carol]);
    expect(after.invites).toEqual([`${frank}:member:pending`]);
    expect(after.emails).toBe(0);
  });
});

describe.each([
  'PATCH /api/wishlists/[id]/owners/[userId]',
  'DELETE /api/wishlists/[id]/owners/[userId]',
])('%s racing a co-owner deleting the list', (name) => {
  it('answers with the 404 of a missing list, not "not an owner"', async () => {
    const id = await makeList({ archived: false });

    // Held right at the ownership write, by when bob has deleted the list.
    const race = holdFirstCall(Wishlist, 'updateOne', () =>
      call(route('DELETE /api/wishlists/[id]'), id, bob)
    );
    let raced: Awaited<ReturnType<typeof call>>;
    try {
      raced = await call(route(name), id, alice);
      expect(race.held()).toBe(true);
    } finally {
      race.restore();
    }

    expect(race.outcome()?.status).toBe(200);
    // Alice was an owner all along: the list is gone, not her ownership.
    expect(raced).toEqual(NOT_FOUND);
    expect(await WishlistMember.countDocuments()).toBe(0);
  });
});

describe('POST /api/wishlists/[id]/members over the invite limit', () => {
  const limit = vi.fn<RateLimiter['limit']>();
  const invites = route('POST /api/wishlists/[id]/members');

  beforeEach(() => {
    limit.mockReset();
    limit.mockResolvedValue({
      success: false,
      reset: Date.now() + 60_000,
      limit: 30,
      remaining: 0,
    });
    __setRateLimiters({ invite: { limit } });
  });
  afterEach(() => __setRateLimiters(null));

  // regression: the invite route spent the caller's invite budget before checking
  // that they own the list, so once they were over the limit, an archived list
  // answered them 429 where a missing one answered 404.
  it.each(NON_OWNERS)(
    'regression: answers %s on an archived list as for a missing one, without spending it',
    async (_, caller) => {
      const id = await makeList({ archived: true });

      expect(await call(invites, id, caller())).toEqual(NOT_FOUND);
      expect(await call(invites, missingId(), caller())).toEqual(NOT_FOUND);
      expect(limit).not.toHaveBeenCalled();
    }
  );

  it('still limits an owner, before anything is sent', async () => {
    const id = await makeList({ archived: true });

    expect((await call(invites, id, alice)).status).toBe(429);
    expect(limit).toHaveBeenCalledWith(alice);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
