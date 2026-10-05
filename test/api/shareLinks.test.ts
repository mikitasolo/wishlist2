import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';
import { holdFirstCall } from '../interleave';

// WIS-334: a list's share links, the owners' API for them, `resolveShareLink`,
// and the cascades that take them with a list or an account.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendWishlistInvitationEmail: vi.fn() }));
vi.mock('@/lib/og/purge', () => ({ purgeShareCards: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/utils/currencyRates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/utils/currencyRates')>()),
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['usd', 1]]) }),
}));

import { auth } from '@/lib/auth';
import { GET as listLinks, POST as createLink } from '@/app/api/wishlists/[id]/links/route';
import {
  PATCH as editLink,
  DELETE as revokeLink,
} from '@/app/api/wishlists/[id]/links/[linkId]/route';
import { GET as getWishlist, DELETE as deleteWishlist } from '@/app/api/wishlists/[id]/route';
import { GET as getItems } from '@/app/api/wishlists/[id]/items/route';
import { DELETE as removeOwner } from '@/app/api/wishlists/[id]/owners/[userId]/route';
import { __setRateLimiters, tierLimits, type RateLimiter } from '@/lib/rateLimit';
import { insertShareLink, resolveShareLink, SHARE_LINK_CAP } from '@/lib/utils/shareLinks';
import { deleteAccount } from '@/lib/utils/accountDeletion';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Item from '@/models/Item';
import ShareLink from '@/models/ShareLink';

const session = vi.mocked(auth);

let alice: string; // owner
let bob: string; // co-owner
let carol: string; // member
let erin: string; // signed in, nothing to do with the list
let listId: string;

const NOT_FOUND = { status: 404, body: { success: false, error: 'Wishlist not found' } };
const TOKEN = 'Tok3nTok3nTok3nTok3nAB'; // 22 base62 characters
const DAY = 24 * 60 * 60 * 1000;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  __setRateLimiters(null);
  const user = async (username: string) =>
    (await User.create({ email: `${username}@x.com`, username }))._id.toString();
  alice = await user('alice');
  bob = await user('bob');
  carol = await user('carol');
  erin = await user('erin');
  listId = (
    await Wishlist.create({
      name: 'Birthday',
      slug: 'birthday',
      owners: [alice, bob],
      visibility: 'everyone',
    })
  )._id.toString();
  await WishlistMember.create({ wishlist: listId, user: carol });
});

afterEach(() => {
  vi.restoreAllMocks();
  __setRateLimiters(null);
});

function req(url: string, method = 'GET', body?: unknown) {
  return new NextRequest('http://localhost' + url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

type Caller = string | null;
function as(userId: Caller, extra: Record<string, unknown> = {}) {
  session.mockResolvedValueOnce((userId ? { user: { id: userId, ...extra } } : null) as never);
}
async function answer(res: Response) {
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const list = (caller: Caller, id = listId) => {
  as(caller);
  return listLinks(req(`/api/wishlists/${id}/links`), { params: Promise.resolve({ id }) }).then(
    answer
  );
};
const create = (caller: Caller, body: unknown, id = listId, extra = {}) => {
  as(caller, extra);
  return createLink(req(`/api/wishlists/${id}/links`, 'POST', body), {
    params: Promise.resolve({ id }),
  }).then(answer);
};
const edit = (caller: Caller, linkId: string, body: unknown, id = listId) => {
  as(caller);
  return editLink(req(`/api/wishlists/${id}/links/${linkId}`, 'PATCH', body), {
    params: Promise.resolve({ id, linkId }),
  }).then(answer);
};
const revoke = (caller: Caller, linkId: string, id = listId) => {
  as(caller);
  return revokeLink(req(`/api/wishlists/${id}/links/${linkId}`, 'DELETE'), {
    params: Promise.resolve({ id, linkId }),
  }).then(answer);
};

/** A link written straight to the database. */
async function makeLink(fields: Record<string, unknown> = {}) {
  return ShareLink.create({
    wishlist: listId,
    token: TOKEN,
    level: 'view',
    createdBy: alice,
    ...fields,
  });
}

/** Everything the link routes could change. */
async function linkSnapshot() {
  return (await ShareLink.find().sort({ _id: 1 }).lean()).map((l) => ({
    ...l,
    _id: l._id.toString(),
  }));
}

describe('who may use the link routes', () => {
  it('lets an owner and a co-owner list, create, edit and revoke, whoever made the link', async () => {
    for (const owner of [alice, bob]) {
      const made = await create(owner, { level: 'view' });
      expect(made.status).toBe(201);
      expect((await list(owner)).status).toBe(200);
    }
    // Bob edits and revokes the link alice made: links are the list's.
    const alices = await ShareLink.findOne({ createdBy: alice });
    expect((await edit(bob, alices!._id.toString(), { label: 'Family' })).status).toBe(200);
    expect((await revoke(bob, alices!._id.toString())).status).toBe(200);
    expect(await ShareLink.countDocuments()).toBe(1);
  });

  it.each([
    ['a member', () => carol],
    ['a signed-in stranger', () => erin],
  ])(
    'answers %s exactly as for a list that does not exist, and changes nothing',
    async (_, who) => {
      const link = await makeLink();
      const id = link._id.toString();
      const before = await linkSnapshot();
      const missing = new mongoose.Types.ObjectId().toString();

      for (const target of [listId, 'birthday', missing]) {
        expect(await list(who(), target).then((r) => ({ status: r.status, body: r.body }))).toEqual(
          NOT_FOUND
        );
        const sends = [
          create(who(), { level: 'join' }, target),
          edit(who(), id, { label: 'Mine now' }, target),
          revoke(who(), id, target),
        ];
        for (const sent of await Promise.all(sends)) {
          expect({ status: sent.status, body: sent.body }).toEqual(NOT_FOUND);
        }
      }
      expect(await linkSnapshot()).toEqual(before);
    }
  );

  it('answers a signed-out caller 401, whether or not the list exists', async () => {
    const link = await makeLink();
    const id = link._id.toString();
    const missing = new mongoose.Types.ObjectId().toString();
    for (const target of [listId, missing]) {
      expect((await list(null, target)).status).toBe(401);
      expect((await create(null, { level: 'view' }, target)).status).toBe(401);
      expect((await edit(null, id, { label: 'x' }, target)).status).toBe(401);
      expect((await revoke(null, id, target)).status).toBe(401);
    }
    expect(await ShareLink.countDocuments()).toBe(1);
  });
});

describe('GET /api/wishlists/[id]/links', () => {
  it('lists the links newest first, each with its token, state and joined count', async () => {
    const now = Date.now();
    await makeLink({ token: 'A'.repeat(22), createdAt: new Date(now - 3000) });
    await makeLink({
      token: 'B'.repeat(22),
      level: 'join',
      label: 'Wedding QR',
      expiresAt: new Date(now - DAY),
      createdAt: new Date(now - 2000),
    });
    await makeLink({
      token: 'C'.repeat(22),
      expiresAt: new Date(now + DAY),
      createdAt: new Date(now - 1000),
    });
    // Another list's link isn't this list's.
    const other = await Wishlist.create({ name: 'Other', owners: [alice], visibility: 'everyone' });
    await ShareLink.create({ wishlist: other._id, token: 'D'.repeat(22), level: 'view' });

    const res = await list(alice);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(
      res.body.data.map((l: Record<string, unknown>) => [l.token, l.level, l.state, l.joinedCount])
    ).toEqual([
      ['C'.repeat(22), 'view', 'live', 0],
      ['B'.repeat(22), 'join', 'expired', 0],
      ['A'.repeat(22), 'view', 'live', 0],
    ]);
    expect(res.body.data[1].label).toBe('Wedding QR');
    // Links are the list's: who made one isn't part of it.
    expect(res.body.data[0]).not.toHaveProperty('createdBy');
  });
});

describe('POST /api/wishlists/[id]/links', () => {
  it('makes a link with a fresh token, and answers it once with the token', async () => {
    const expiresAt = new Date(Date.now() + 7 * DAY).toISOString();
    const res = await create(alice, { level: 'join', label: '  Family chat ', expiresAt });

    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.body.data).toMatchObject({
      level: 'join',
      label: 'Family chat',
      expiresAt,
      state: 'live',
      joinedCount: 0,
    });
    expect(res.body.data.token).toMatch(/^[0-9A-Za-z]{22}$/);
    const stored = await ShareLink.findById(res.body.data._id).lean();
    expect(stored).toMatchObject({ token: res.body.data.token, level: 'join' });
    expect(stored!.createdBy!.toString()).toBe(alice);
    // Never on the list itself.
    const wl = await Wishlist.findById(listId).lean();
    expect(JSON.stringify(wl)).not.toContain(res.body.data.token);
  });

  it('takes the expiry it is sent, a past one included (an expired link)', async () => {
    const res = await create(alice, {
      level: 'view',
      expiresAt: new Date(Date.now() - DAY).toISOString(),
    });
    expect(res.status).toBe(201);
    expect(res.body.data.state).toBe('expired');
    expect((await create(alice, { level: 'view' })).body.data.expiresAt).toBeNull();
  });

  it.each([
    ['no level', {}],
    ['an unknown level', { level: 'owner' }],
    ['a token of its own', { level: 'view', token: TOKEN }],
    ['an operator object as the level', { level: { $ne: null } }],
    ['an operator object as the label', { level: 'view', label: { $ne: null } }],
    ['an operator object as the expiry', { level: 'view', expiresAt: { $gt: '' } }],
    ['a label over 40 characters', { level: 'view', label: 'x'.repeat(41) }],
  ])('refuses a body with %s, and makes nothing', async (_, body) => {
    const res = await create(alice, body);
    expect(res.status).toBe(400);
    expect(await ShareLink.countDocuments()).toBe(0);
  });

  it(`refuses a link past ${SHARE_LINK_CAP}, expired ones included`, async () => {
    for (let i = 0; i < SHARE_LINK_CAP; i++) {
      await makeLink({
        token: `${'x'.repeat(20)}${String(i).padStart(2, '0')}`,
        // Half of them expired: they still count.
        ...(i % 2 ? { expiresAt: new Date(Date.now() - DAY) } : {}),
      });
    }
    const res = await create(alice, { level: 'view' });
    expect(res.status).toBe(409);
    expect(await ShareLink.countDocuments()).toBe(SHARE_LINK_CAP);

    // Revoking one makes room.
    const one = await ShareLink.findOne();
    await revoke(alice, one!._id.toString());
    expect((await create(alice, { level: 'view' })).status).toBe(201);
  });

  it('regression: two creates at once never take the list past the cap', async () => {
    for (let i = 0; i < SHARE_LINK_CAP - 1; i++) {
      await makeLink({ token: `${'y'.repeat(20)}${String(i).padStart(2, '0')}` });
    }
    // Both count 19 before either writes: the first is held at its insert
    // while the second goes all the way through.
    const race = holdFirstCall(ShareLink, 'create', () => create(bob, { level: 'view' }));
    let first: Awaited<ReturnType<typeof create>>;
    try {
      first = await create(alice, { level: 'join' });
      expect(race.held()).toBe(true);
    } finally {
      race.restore();
    }
    expect(race.outcome()?.status).toBe(201);
    expect(first.status).toBe(409);
    expect(await ShareLink.countDocuments()).toBe(SHARE_LINK_CAP);
    expect(await ShareLink.exists({ level: 'join' })).toBeNull();
  });

  it('refuses on an archived list, checked last, with its own message', async () => {
    await Wishlist.updateOne({ _id: listId }, { archived: true });
    const res = await create(alice, { level: 'view' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Unarchive this list to create links');
    expect(await ShareLink.countDocuments()).toBe(0);
    // A bad body is still told so first.
    expect((await create(alice, { level: 'nope' })).status).toBe(400);
  });

  it('regression: takes its link back when the list is deleted while it is made', async () => {
    // Held at the insert, by when bob has deleted the list (and its links).
    const race = holdFirstCall(ShareLink, 'create', () => {
      as(bob);
      return deleteWishlist(req(`/api/wishlists/${listId}`, 'DELETE'), {
        params: Promise.resolve({ id: listId }),
      });
    });
    let res: Awaited<ReturnType<typeof create>>;
    try {
      res = await create(alice, { level: 'view' });
      expect(race.held()).toBe(true);
    } finally {
      race.restore();
    }
    expect(race.outcome()?.status).toBe(200);
    expect({ status: res.status, body: res.body }).toEqual(NOT_FOUND);
    expect(await ShareLink.countDocuments()).toBe(0);
  });

  it('regression: takes its link back when the caller is taken off the owners meanwhile', async () => {
    const race = holdFirstCall(ShareLink, 'create', () => {
      as(bob);
      return removeOwner(req(`/api/wishlists/${listId}/owners/${alice}`, 'DELETE'), {
        params: Promise.resolve({ id: listId, userId: alice }),
      });
    });
    let res: Awaited<ReturnType<typeof create>>;
    try {
      res = await create(alice, { level: 'join' });
      expect(race.held()).toBe(true);
    } finally {
      race.restore();
    }
    expect(race.outcome()?.status).toBe(200);
    expect({ status: res.status, body: res.body }).toEqual(NOT_FOUND);
    expect(await ShareLink.countDocuments()).toBe(0);
  });

  it('retries a token that clashes, and never logs or answers the token', async () => {
    const clash = new Error(`E11000 duplicate key error dup key: { token: "${TOKEN}" }`);
    Object.assign(clash, { code: 11000, keyPattern: { token: 1 }, keyValue: { token: TOKEN } });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(ShareLink, 'create').mockRejectedValueOnce(clash);

    const res = await create(alice, { level: 'view' });
    expect(res.status).toBe(201);
    expect(res.body.data.token).not.toBe(TOKEN);
    expect(errors).not.toHaveBeenCalled();
  });

  it('gives up after repeated clashes with a 500 that carries no token, in the answer or the log', async () => {
    const clash = new Error(`E11000 duplicate key error dup key: { token: "${TOKEN}" }`);
    Object.assign(clash, { code: 11000, keyPattern: { token: 1 }, keyValue: { token: TOKEN } });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(ShareLink, 'create').mockRejectedValue(clash);

    const res = await create(alice, { level: 'view' });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
    expect(errors).toHaveBeenCalled();
    expect(JSON.stringify(errors.mock.calls)).not.toContain(TOKEN);
    expect(String(errors.mock.calls.flat())).not.toContain(TOKEN);
  });

  it('is limited on the new-account tier for a fresh account, once ownership is known', async () => {
    const limit = vi.fn<RateLimiter['limit']>().mockResolvedValue({
      success: false,
      reset: Date.now() + 60_000,
      limit: tierLimits('shareLink', true).tokens,
      remaining: 0,
    });
    const standard = vi.fn<RateLimiter['limit']>();
    __setRateLimiters({ 'shareLink:new': { limit }, shareLink: { limit: standard } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // A non-owner is answered as for a missing list, without spending it.
    expect((await create(erin, { level: 'view' }, listId, { newAccount: true })).status).toBe(404);
    expect(limit).not.toHaveBeenCalled();

    expect((await create(alice, { level: 'view' }, listId, { newAccount: true })).status).toBe(429);
    expect(limit).toHaveBeenCalledWith(alice);
    expect(standard).not.toHaveBeenCalled();
    expect(await ShareLink.countDocuments()).toBe(0);
  });
});

describe('POST /api/wishlists/[id]/links: the create limit', () => {
  // regression: the limit was spent before the body, the cap and the archived
  // check, so a fresh account's few creates went on requests that made nothing.
  it('is spent only by a request that makes a link', async () => {
    const limit = vi.fn<RateLimiter['limit']>().mockResolvedValue({
      success: true,
      reset: Date.now() + 60_000,
      limit: 30,
      remaining: 29,
    });
    __setRateLimiters({ shareLink: { limit } });

    expect((await create(alice, { level: 'nope' })).status).toBe(400);
    await Wishlist.updateOne({ _id: listId }, { archived: true });
    expect((await create(alice, { level: 'view' })).status).toBe(409);
    await Wishlist.updateOne({ _id: listId }, { archived: false });
    for (let i = 0; i < SHARE_LINK_CAP; i++) {
      await makeLink({ token: `${'z'.repeat(20)}${String(i).padStart(2, '0')}` });
    }
    expect((await create(alice, { level: 'view' })).status).toBe(409);
    expect(limit).not.toHaveBeenCalled();

    await ShareLink.deleteOne({});
    expect((await create(alice, { level: 'view' })).status).toBe(201);
    expect(limit).toHaveBeenCalledTimes(1);
  });
});

describe('insertShareLink', () => {
  it('retries a real duplicate token with a new one', async () => {
    await makeLink();
    const tokens = [TOKEN, 'Z'.repeat(22)];
    const link = await insertShareLink(
      { wishlistId: listId, level: 'view', label: null, expiresAt: null, createdBy: alice },
      { generateToken: () => tokens.shift()! }
    );
    expect(link.token).toBe('Z'.repeat(22));
    expect(await ShareLink.countDocuments()).toBe(2);
  });

  it('rethrows any other error as it is', async () => {
    vi.spyOn(ShareLink, 'create').mockRejectedValueOnce(new Error('down'));
    await expect(
      insertShareLink({
        wishlistId: listId,
        level: 'view',
        label: null,
        expiresAt: null,
        createdBy: alice,
      })
    ).rejects.toThrow('down');
  });
});

describe('PATCH /api/wishlists/[id]/links/[linkId]', () => {
  it('changes the label and expiry, and answers without the token', async () => {
    const link = await makeLink({ label: 'Old', expiresAt: new Date(Date.now() - DAY) });
    const later = new Date(Date.now() + DAY).toISOString();

    // A later expiry brings an expired link back.
    const res = await edit(alice, link._id.toString(), { label: ' New ', expiresAt: later });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ label: 'New', expiresAt: later, state: 'live' });
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);

    // Clearing both.
    const cleared = await edit(alice, link._id.toString(), { label: '', expiresAt: null });
    expect(cleared.body.data).toMatchObject({ label: null, expiresAt: null, state: 'live' });
    // Only what was sent changes.
    await edit(alice, link._id.toString(), { label: 'Kept' });
    const stored = await ShareLink.findById(link._id).lean();
    expect(stored).toMatchObject({ label: 'Kept', expiresAt: null, level: 'view', token: TOKEN });
  });

  it('works on an archived list', async () => {
    const link = await makeLink();
    await Wishlist.updateOne({ _id: listId }, { archived: true });
    expect((await edit(bob, link._id.toString(), { label: 'Still' })).status).toBe(200);
  });

  it.each([
    ['a level', { level: 'join' }],
    ['a level alongside a label', { label: 'x', level: 'join' }],
    ['a token', { token: 'Q'.repeat(22) }],
    ['nothing', {}],
    ['an operator object as the label', { label: { $ne: null } }],
    ['an operator object as the expiry', { expiresAt: { $ne: null } }],
  ])('refuses %s, and changes nothing', async (_, body) => {
    const link = await makeLink({ label: 'Same' });
    const before = await linkSnapshot();
    expect((await edit(alice, link._id.toString(), body)).status).toBe(400);
    expect(await linkSnapshot()).toEqual(before);
  });

  it("answers 'Link not found' for another list's link, a missing one, or a malformed id", async () => {
    const other = await Wishlist.create({ name: 'Other', owners: [erin], visibility: 'everyone' });
    const theirs = await ShareLink.create({
      wishlist: other._id,
      token: 'E'.repeat(22),
      level: 'view',
      label: 'Theirs',
    });
    for (const linkId of [
      theirs._id.toString(),
      new mongoose.Types.ObjectId().toString(),
      'not-an-id',
    ]) {
      const res = await edit(alice, linkId, { label: 'Mine' });
      expect({ status: res.status, body: res.body }).toEqual({
        status: 404,
        body: { success: false, error: 'Link not found' },
      });
    }
    expect((await ShareLink.findById(theirs._id).lean())!.label).toBe('Theirs');
  });
});

describe('DELETE /api/wishlists/[id]/links/[linkId]', () => {
  it('revokes the link, on an archived list too, and answers without the token', async () => {
    const link = await makeLink();
    await Wishlist.updateOne({ _id: listId }, { archived: true });
    const res = await revoke(alice, link._id.toString());
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
    expect(await ShareLink.countDocuments()).toBe(0);
    expect((await revoke(alice, link._id.toString())).status).toBe(404);
  });

  it("never revokes another list's link", async () => {
    const other = await Wishlist.create({ name: 'Other', owners: [erin], visibility: 'everyone' });
    const theirs = await ShareLink.create({
      wishlist: other._id,
      token: 'E'.repeat(22),
      level: 'view',
    });
    expect((await revoke(alice, theirs._id.toString())).status).toBe(404);
    expect(await ShareLink.exists({ _id: theirs._id })).toBeTruthy();
  });
});

describe('the token stays out of every other answer', () => {
  it.each([
    ['an owner', () => alice],
    ['a member', () => carol],
    ['a stranger', () => erin],
    ['a signed-out visitor', () => null],
  ])('the list and its items, as %s', async (_, who) => {
    await makeLink();
    await Item.create({ wishlist: listId, name: 'Lamp' });

    as(who());
    const wl = await getWishlist(req(`/api/wishlists/${listId}`), {
      params: Promise.resolve({ id: listId }),
    });
    expect(wl.status).toBe(200);
    expect(await wl.text()).not.toContain(TOKEN);

    as(who());
    const items = await getItems(req(`/api/wishlists/${listId}/items`), {
      params: Promise.resolve({ id: listId }),
    });
    expect(items.status).toBe(200);
    expect(await items.text()).not.toContain(TOKEN);
  });
});

describe('resolveShareLink', () => {
  it('gives back a live link and its list', async () => {
    await makeLink({ expiresAt: new Date(Date.now() + DAY) });
    const resolved = await resolveShareLink(TOKEN);
    expect(resolved?.link.token).toBe(TOKEN);
    expect(resolved?.wishlist._id.toString()).toBe(listId);
    // One without an expiry too.
    await ShareLink.updateOne({ token: TOKEN }, { $unset: { expiresAt: 1 } });
    expect((await resolveShareLink(TOKEN))?.link.token).toBe(TOKEN);
  });

  it('answers null alike for unknown, expired, archived, deleted and malformed', async () => {
    const queries = vi.spyOn(ShareLink, 'findOne');
    const cases: Record<string, () => Promise<unknown>> = {
      unknown: async () => {},
      revoked: async () => {
        await ShareLink.deleteOne({ token: TOKEN });
      },
      expired: async () => {
        await ShareLink.updateOne({ token: TOKEN }, { expiresAt: new Date(Date.now() - 1) });
      },
      archived: async () => {
        await Wishlist.updateOne({ _id: listId }, { archived: true });
      },
      'list deleted': async () => {
        await Wishlist.deleteOne({ _id: listId });
      },
    };
    for (const [name, setUp] of Object.entries(cases)) {
      await clearTestDB();
      listId = (
        await Wishlist.create({ name: 'Birthday', owners: [alice], visibility: 'everyone' })
      )._id.toString();
      if (name !== 'unknown') await makeLink();
      await setUp();
      expect([name, await resolveShareLink(TOKEN)]).toEqual([name, null]);
    }

    queries.mockClear();
    for (const bad of [{ $ne: null }, { $regex: '.*' }, 'short', `${TOKEN}x`, null]) {
      expect(await resolveShareLink(bad)).toBeNull();
    }
    // A malformed token never reaches a query.
    expect(queries).not.toHaveBeenCalled();
  });

  it('works again once the list is unarchived, or the expiry moved later', async () => {
    await makeLink({ expiresAt: new Date(Date.now() - DAY) });
    expect(await resolveShareLink(TOKEN)).toBeNull();
    await ShareLink.updateOne({ token: TOKEN }, { expiresAt: new Date(Date.now() + DAY) });
    await Wishlist.updateOne({ _id: listId }, { archived: true });
    expect(await resolveShareLink(TOKEN)).toBeNull();
    await Wishlist.updateOne({ _id: listId }, { archived: false });
    expect((await resolveShareLink(TOKEN))?.wishlist._id.toString()).toBe(listId);
  });
});

describe('cascades', () => {
  it('deleting a list deletes its links, and only its links', async () => {
    await makeLink();
    const other = await Wishlist.create({ name: 'Other', owners: [alice], visibility: 'everyone' });
    const kept = await ShareLink.create({
      wishlist: other._id,
      token: 'K'.repeat(22),
      level: 'view',
    });

    as(alice);
    const res = await deleteWishlist(req(`/api/wishlists/${listId}`, 'DELETE'), {
      params: Promise.resolve({ id: listId }),
    });
    expect(res.status).toBe(200);
    expect(await ShareLink.exists({ wishlist: listId })).toBeNull();
    expect(await ShareLink.exists({ _id: kept._id })).toBeTruthy();
  });

  it('deleting an account keeps the links it made on co-owned lists, without its name', async () => {
    const alicesLink = await makeLink();
    const bobsLink = await makeLink({ token: 'B'.repeat(22), createdBy: bob });

    expect(await deleteAccount(alice, { agreedListIds: [] })).toBe('deleted');

    const after = await ShareLink.findById(alicesLink._id).lean();
    expect(after).toMatchObject({ token: TOKEN, createdBy: null });
    expect((await ShareLink.findById(bobsLink._id).lean())!.createdBy!.toString()).toBe(bob);
  });

  it('regression: clears a link the account made while its deletion ran, on the second pass', async () => {
    const original = ShareLink.updateMany.bind(ShareLink);
    let first = true;
    // A create from another tab lands just after the first pass cleared hers.
    vi.spyOn(ShareLink, 'updateMany').mockImplementation(((
      ...args: Parameters<typeof ShareLink.updateMany>
    ) => {
      if (!first) return original(...args);
      first = false;
      return original(...args).then(async (r) => {
        await makeLink({ token: 'L'.repeat(22) });
        return r;
      });
    }) as never);

    await deleteAccount(alice, { agreedListIds: [] });

    expect(await ShareLink.countDocuments({ createdBy: alice })).toBe(0);
    expect(await ShareLink.countDocuments()).toBe(1);
  });
});
