import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({
  sendNotificationEmail: vi.fn().mockResolvedValue(undefined),
  sendWishlistInvitationEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/utils/currencyRates', () => ({
  ensureCurrencyRatesUpToDate: vi.fn().mockResolvedValue({ rates: new Map([['USD', 1]]) }),
  convertToUsdCents: vi.fn(),
}));

import { auth } from '@/lib/auth';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import { GET as GET_WISHLIST } from '@/app/api/wishlists/[id]/route';
import { GET as LIST_ITEMS } from '@/app/api/wishlists/[id]/items/route';
import { POST as ASK } from '@/app/api/wishlists/[id]/requests/route';
import {
  GET as MY_REQUEST,
  DELETE as CANCEL_MINE,
} from '@/app/api/wishlists/[id]/requests/me/route';
import User from '@/models/User';
import Follow from '@/models/Follow';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistJoinRequest from '@/models/WishlistJoinRequest';
import Item from '@/models/Item';
import ShareLink from '@/models/ShareLink';
import { generateShareToken } from '@/lib/utils/shareLinks';
import { getWishlistViewAccess } from '@/lib/utils/wishlistAccess';
import { SHARE_TOKEN_HEADER } from '@/lib/utils/shareLinkFields';

/**
 * Opening a list through its share link (WIS-335): the list `GET`, the items
 * `GET` and the join-request routes, with the token in `X-Share-Token`. Only a
 * live link to *this* list admits more people, every dead link answers the
 * same 404 whoever asks and whatever the list's visibility, and no answer
 * carries a token.
 */

const session = vi.mocked(auth);

type Visibility = 'everyone' | 'friends' | 'private';
const VISIBILITIES: Visibility[] = ['everyone', 'friends', 'private'];
const VIEWERS = ['signedOut', 'stranger', 'friend', 'member', 'owner'] as const;
type Viewer = (typeof VIEWERS)[number];

/** Every way a link can be dead, each made by `deadLink`. */
const DEAD = [
  'revoked',
  'expired',
  'archivedList',
  'otherListsToken',
  'unknown',
  'malformed',
] as const;
type Dead = (typeof DEAD)[number];

const ids = {} as Record<Exclude<Viewer, 'signedOut'>, string>;
let listId: string;
let otherListId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

const counted: string[] = [];
/** Counts each limiter call by name, and lets every one through. */
const countingLimiters = (): Partial<Record<string, RateLimiter>> =>
  Object.fromEntries(
    ['shareLinkInvalid', 'joinRequest', 'joinRequest:new'].map((name) => [
      name,
      {
        async limit() {
          counted.push(name);
          return { success: true, reset: Date.now() + 60_000, limit: 30, remaining: 29 };
        },
      },
    ])
  );

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  counted.length = 0;
  __setRateLimiters(countingLimiters());
  for (const name of ['owner', 'member', 'friend', 'stranger'] as const) {
    const u = await User.create({ email: `${name}@x.com`, username: name });
    ids[name] = u._id.toString();
  }
  await Follow.create([
    { follower: ids.owner, following: ids.friend },
    { follower: ids.friend, following: ids.owner },
  ]);
  const other = await Wishlist.create({
    name: 'Other',
    owners: [ids.owner],
    visibility: 'private',
  });
  otherListId = other._id.toString();
});

afterEach(() => {
  __setRateLimiters(null);
  vi.restoreAllMocks();
});

async function makeList(visibility: Visibility) {
  const wl = await Wishlist.create({ name: 'Wedding', owners: [ids.owner], visibility });
  listId = wl._id.toString();
  await WishlistMember.create({ wishlist: wl._id, user: ids.member });
  await Item.create({ wishlist: listId, name: 'Kettle', status: 'available' });
  await Item.create({
    wishlist: listId,
    name: 'Toaster',
    status: 'booked',
    bookedBy: ids.member,
  });
  await Item.create({ wishlist: listId, name: 'Secret', status: 'draft' });
  return listId;
}

async function link(
  wishlist: string,
  fields: { level?: 'view' | 'join'; expiresAt?: Date | null } = {}
) {
  const doc = await ShareLink.create({
    wishlist,
    token: generateShareToken(),
    level: fields.level ?? 'view',
    expiresAt: fields.expiresAt ?? null,
    createdBy: ids.owner,
  });
  return doc.token;
}

/** A token for a link that's dead for `reason`, on the list `makeList` made last. */
async function deadLink(reason: Dead): Promise<string> {
  switch (reason) {
    case 'revoked': {
      const token = await link(listId);
      await ShareLink.deleteOne({ token });
      return token;
    }
    case 'expired':
      return link(listId, { expiresAt: new Date(Date.now() - 1000) });
    case 'archivedList': {
      const token = await link(listId);
      await Wishlist.updateOne({ _id: listId }, { $set: { archived: true } });
      return token;
    }
    case 'otherListsToken':
      return link(otherListId);
    case 'unknown':
      return generateShareToken();
    case 'malformed':
      return '{"$ne":null}';
  }
}

function as(viewer: Viewer) {
  session.mockResolvedValue(
    viewer === 'signedOut' ? (null as never) : ({ user: { id: ids[viewer] } } as never)
  );
}

function headers(token: string | null): HeadersInit {
  return token === null ? {} : { [SHARE_TOKEN_HEADER]: token };
}

function getList(id: string, viewer: Viewer, token: string | null) {
  as(viewer);
  const req = new NextRequest(`http://localhost/api/wishlists/${id}`, { headers: headers(token) });
  return GET_WISHLIST(req, { params: Promise.resolve({ id }) });
}

function getItems(id: string, viewer: Viewer, token: string | null) {
  as(viewer);
  const req = new NextRequest(`http://localhost/api/wishlists/${id}/items`, {
    headers: headers(token),
  });
  return LIST_ITEMS(req, { params: Promise.resolve({ id }) });
}

function ask(id: string, viewer: Viewer, token: string | null) {
  as(viewer);
  const req = new NextRequest(`http://localhost/api/wishlists/${id}/requests`, {
    method: 'POST',
    headers: headers(token),
  });
  return ASK(req, { params: Promise.resolve({ id }) });
}

function myRequest(id: string, viewer: Viewer, token: string | null) {
  as(viewer);
  const req = new NextRequest(`http://localhost/api/wishlists/${id}/requests/me`, {
    headers: headers(token),
  });
  return MY_REQUEST(req, { params: Promise.resolve({ id }) });
}

function cancelMine(id: string, viewer: Viewer, token: string | null) {
  as(viewer);
  const req = new NextRequest(`http://localhost/api/wishlists/${id}/requests/me`, {
    method: 'DELETE',
    headers: headers(token),
  });
  return CANCEL_MINE(req, { params: Promise.resolve({ id }) });
}

const ROLE: Record<Viewer, 'owner' | 'member' | null> = {
  signedOut: null,
  stranger: null,
  friend: null,
  member: 'member',
  owner: 'owner',
};

describe('a live link opens its list for anyone, whatever its visibility', () => {
  for (const level of ['view', 'join'] as const) {
    for (const visibility of VISIBILITIES) {
      it(`live ${level} link on a ${visibility} list`, async () => {
        await makeList(visibility);
        const token = await link(listId, { level });
        for (const viewer of VIEWERS) {
          const listRes = await getList(listId, viewer, token);
          expect(listRes.status, `${viewer} list`).toBe(200);
          expect(listRes.headers.get('Cache-Control')).toBe('private, no-store');
          const list = await listRes.json();
          expect(list.data.userRole, viewer).toBe(ROLE[viewer]);
          expect(JSON.stringify(list)).not.toContain(token);

          const itemsRes = await getItems(listId, viewer, token);
          expect(itemsRes.status, `${viewer} items`).toBe(200);
          expect(itemsRes.headers.get('Cache-Control')).toBe('private, no-store');
          const items = await itemsRes.json();
          expect(JSON.stringify(items)).not.toContain(token);
          const names = items.data.map((i: { name: string }) => i.name).sort();
          expect(names).toEqual(
            viewer === 'owner' ? ['Kettle', 'Secret', 'Toaster'] : ['Kettle', 'Toaster']
          );
          // Someone let in by the link is a visitor: booking-blind, no drafts.
          if (ROLE[viewer] === null) {
            for (const item of items.data) {
              expect(item.status).toBe('available');
              expect(item.bookedBy ?? null).toBeNull();
            }
          }
        }
        // Live links never spend the failed-lookup budget.
        expect(counted).not.toContain('shareLinkInvalid');
      });
    }
  }
});

describe('a dead link is the same 404 for everyone', () => {
  for (const reason of DEAD) {
    for (const visibility of VISIBILITIES) {
      it(`${reason} on a ${visibility} list`, async () => {
        await makeList(visibility);
        const token = await deadLink(reason);
        for (const viewer of VIEWERS) {
          for (const read of [getList, getItems]) {
            const res = await read(listId, viewer, token);
            expect(res.status, `${viewer} ${read.name}`).toBe(404);
            expect(res.headers.get('Cache-Control')).toBe('private, no-store');
            expect(await res.json()).toEqual({ success: false, error: 'Wishlist not found' });
          }
        }
        // Each failed lookup spends the IP's budget.
        expect(counted.filter((n) => n === 'shareLinkInvalid')).toHaveLength(VIEWERS.length * 2);
      });
    }
  }

  it('answers a list that is gone like any dead link', async () => {
    await makeList('everyone');
    const token = await link(listId);
    await Wishlist.deleteOne({ _id: listId });
    const res = await getList(listId, 'owner', token);
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('answers a failed lookup over the IP budget with a 429, and a live link still opens', async () => {
    await makeList('private');
    const live = await link(listId);
    __setRateLimiters({
      shareLinkInvalid: {
        async limit() {
          return { success: false, reset: Date.now() + 60_000, limit: 30, remaining: 0 };
        },
      },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await getList(listId, 'stranger', generateShareToken())).status).toBe(429);
    expect((await getList(listId, 'stranger', live)).status).toBe(200);
  });

  it('leaves a request without the header link-blind', async () => {
    await makeList('private');
    await link(listId);
    expect((await getList(listId, 'stranger', null)).status).toBe(403);
    expect((await getList(listId, 'signedOut', null)).status).toBe(401);
    expect((await getList(listId, 'member', null)).status).toBe(200);
    expect(counted).not.toContain('shareLinkInvalid');
  });
});

describe('getWishlistViewAccess with a link', () => {
  it('admits only through a link bound to the list, live, on a list not archived', async () => {
    await makeList('private');
    const wishlist = (await Wishlist.findById(listId))!;
    const own = (await ShareLink.findOne({ token: await link(listId) }).lean())!;
    const other = (await ShareLink.findOne({ token: await link(otherListId) }).lean())!;
    const expired = { ...own, expiresAt: new Date(Date.now() - 1) };

    expect((await getWishlistViewAccess(wishlist, ids.stranger, { link: own })).allowed).toBe(true);
    expect((await getWishlistViewAccess(wishlist, null, { link: own })).allowed).toBe(true);
    // regression: a link is bound to its list; list A's link never opens list B,
    // not even for B's owner.
    for (const viewer of [null, ids.stranger, ids.owner]) {
      expect(await getWishlistViewAccess(wishlist, viewer, { link: other })).toEqual({
        allowed: false,
        status: 404,
        error: 'Wishlist not found',
      });
      expect((await getWishlistViewAccess(wishlist, viewer, { link: expired })).allowed).toBe(
        false
      );
    }
    wishlist.archived = true;
    const archived = await getWishlistViewAccess(wishlist, ids.owner, { link: own });
    expect(archived).toEqual({ allowed: false, status: 404, error: 'Wishlist not found' });
  });

  it('gives the viewer their real role, so only non-members are visitors', async () => {
    await makeList('private');
    const wishlist = (await Wishlist.findById(listId))!;
    const own = (await ShareLink.findOne({ token: await link(listId) }).lean())!;
    expect(await getWishlistViewAccess(wishlist, ids.member, { link: own })).toEqual({
      allowed: true,
      isOwner: false,
      isMember: true,
    });
    expect(await getWishlistViewAccess(wishlist, ids.stranger, { link: own })).toEqual({
      allowed: true,
      isOwner: false,
      isMember: false,
    });
  });
});

describe('asking to join through a link', () => {
  it('lets a stranger ask on an Invite only list through a live link', async () => {
    await makeList('private');
    const token = await link(listId);
    expect((await ask(listId, 'stranger', null)).status).toBe(404);

    const res = await ask(listId, 'stranger', token);
    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await WishlistJoinRequest.countDocuments({ user: ids.stranger })).toBe(1);

    const mine = await myRequest(listId, 'stranger', token);
    expect((await mine.json()).data).toEqual({ requested: true });
    expect(mine.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('spends the new-account tier for a new account', async () => {
    await makeList('private');
    const token = await link(listId);
    session.mockResolvedValue({ user: { id: ids.stranger, newAccount: true } } as never);
    const req = new NextRequest(`http://localhost/api/wishlists/${listId}/requests`, {
      method: 'POST',
      headers: headers(token),
    });
    expect((await ASK(req, { params: Promise.resolve({ id: listId }) })).status).toBe(201);
    expect(counted).toContain('joinRequest:new');
  });

  for (const reason of DEAD) {
    it(`refuses an ask through a ${reason} link with the 404`, async () => {
      await makeList('everyone');
      const token = await deadLink(reason);
      const res = await ask(listId, 'stranger', token);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ success: false, error: 'Wishlist not found' });
      expect((await myRequest(listId, 'stranger', token)).status).toBe(404);
      expect(await WishlistJoinRequest.countDocuments({})).toBe(0);
    });
  }

  it('cancels their own request after the link died, behind the same 404', async () => {
    await makeList('private');
    const token = await link(listId);
    expect((await ask(listId, 'stranger', token)).status).toBe(201);
    await ShareLink.deleteOne({ token });

    const res = await cancelMine(listId, 'stranger', token);
    expect(res.status).toBe(404);
    expect(await WishlistJoinRequest.countDocuments({ status: 'pending' })).toBe(0);
  });
});

describe('the token stays out of everything but the owners’ link list', () => {
  it('is never on the Wishlist document', async () => {
    await makeList('everyone');
    const token = await link(listId);
    const raw = await Wishlist.findById(listId).lean();
    expect(JSON.stringify(raw)).not.toContain(token);
    const res = await getList(listId, 'owner', null);
    expect(JSON.stringify(await res.json())).not.toContain(token);
    expect(mongoose.isValidObjectId(listId)).toBe(true);
  });

  it('logs a failed lookup without the token', async () => {
    await makeList('private');
    const token = await link(listId);
    vi.spyOn(ShareLink, 'findOne').mockImplementation(() => {
      throw new Error(`lookup failed for ${token}`);
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await getList(listId, 'stranger', token);
    expect(res.status).toBe(500);
    expect(logged).toHaveBeenCalled();
    expect(JSON.stringify(logged.mock.calls.map((c) => c.map(String)))).not.toContain(token);
  });
});
