import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// Slugs are unique across every list, so `PATCH /api/wishlists/[id]` answering
// 409 "That URL is already taken." confirms that some list holds a slug, even
// one the caller can't open. That's accepted (an owner-chosen slug is a public
// URL), but trying slugs is rate-limited (`wishlistSlug`), so probing many of
// them from a list of your own gets slow. These tests pin when the limit is
// spent: only on a request that changes the URL of a list the caller owns.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { PATCH } from '@/app/api/wishlists/[id]/route';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';

const session = vi.mocked(auth);
const limit = vi.fn<RateLimiter['limit']>();

const DENIED = { success: false, reset: Date.now() + 60_000, limit: 10, remaining: 0 };
const ALLOWED = { success: true, reset: 0, limit: 10, remaining: 9 };

let alice: string; // owner
let carol: string; // member
let erin: string; // signed in, nothing to do with the list

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  limit.mockReset();
  limit.mockResolvedValue(DENIED);
  __setRateLimiters({ wishlistSlug: { limit } });
  const user = async (username: string) =>
    (await User.create({ email: `${username}@x.com`, username }))._id.toString();
  alice = await user('alice');
  carol = await user('carol');
  erin = await user('erin');
});

afterEach(() => __setRateLimiters(null));

async function makeList({ archived = false, slug = 'birthday' } = {}) {
  const wl = await Wishlist.create({
    name: 'Birthday',
    slug,
    owners: [alice],
    visibility: 'everyone',
    isPublic: true,
    archived,
  });
  const id = wl._id.toString();
  await WishlistMember.create({ wishlist: id, user: carol });
  return id;
}

async function patch(id: string, userId: string | null, body: unknown) {
  session.mockResolvedValue((userId ? { user: { id: userId } } : null) as never);
  const res = await PATCH(
    new NextRequest(`http://localhost/api/wishlists/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) }
  );
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const slugOf = async (id: string) => (await Wishlist.findById(id))?.slug;

describe('PATCH /api/wishlists/[id]: changing the URL is rate-limited', () => {
  it('answers 429 once the owner is over the limit, and keeps the old URL', async () => {
    const id = await makeList();

    const res = await patch(id, alice, { slug: 'alice-birthday' });

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(limit).toHaveBeenCalledExactlyOnceWith(alice);
    expect(await slugOf(id)).toBe('birthday');
  });

  it('refuses the whole edit, not just the URL, when the URL change is over the limit', async () => {
    const id = await makeList();

    expect((await patch(id, alice, { slug: 'alice-birthday', name: 'Renamed' })).status).toBe(429);
    expect((await Wishlist.findById(id))?.name).toBe('Birthday');
  });

  it('spends a token on a URL another list holds before answering 409', async () => {
    limit.mockResolvedValue(ALLOWED);
    const id = await makeList();
    await Wishlist.create({ name: 'Other', slug: 'taken', owners: [erin], visibility: 'private' });

    const res = await patch(id, alice, { slug: 'taken' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('That URL is already taken.');
    expect(limit).toHaveBeenCalledExactlyOnceWith(alice);
  });

  it('changes the URL while under the limit', async () => {
    limit.mockResolvedValue(ALLOWED);
    const id = await makeList();

    expect((await patch(id, alice, { slug: 'alice-birthday' })).status).toBe(200);
    expect(limit).toHaveBeenCalledExactlyOnceWith(alice);
    expect(await slugOf(id)).toBe('alice-birthday');
  });
});

describe('PATCH /api/wishlists/[id]: an edit that leaves the URL alone', () => {
  it.each([
    ['a rename', { name: 'Renamed' }],
    ['a visibility change', { visibility: 'private' }],
    ['archiving', { archived: true }],
    ['pinning', { featured: true }],
    ['the URL the list already has', { slug: 'birthday' }],
    ['the URL the list already has, in other case', { slug: 'Birthday' }],
  ])('isn’t limited by it: %s', async (_, body) => {
    const id = await makeList();

    expect((await patch(id, alice, body)).status).toBe(200);
    expect(limit).not.toHaveBeenCalled();
    expect(await slugOf(id)).toBe('birthday');
  });
});

describe('PATCH /api/wishlists/[id]: a caller who may not change the URL', () => {
  const NOT_FOUND = { success: false, error: 'Wishlist not found' };
  const FORBIDDEN = { success: false, error: 'Unauthorized - Owner access required' };
  const SIGNED_OUT = { success: false, error: 'Unauthorized - Please sign in' };

  const callers = { stranger: () => erin, member: () => carol, signedOut: () => null };

  it.each([
    ['a stranger, on a visible list', 'stranger', false, 403, FORBIDDEN],
    ['a member, on a visible list', 'member', false, 403, FORBIDDEN],
    ['a stranger, on an archived list', 'stranger', true, 404, NOT_FOUND],
    ['a member, on an archived list', 'member', true, 404, NOT_FOUND],
    ['a signed-out caller', 'signedOut', false, 401, SIGNED_OUT],
    ['a signed-out caller, on an archived list', 'signedOut', true, 401, SIGNED_OUT],
  ] as const)(
    'gets its usual answer without spending the limit: %s',
    async (_, caller, archived, status, body) => {
      const id = await makeList({ archived });

      const res = await patch(id, callers[caller](), { slug: 'probe' });

      expect({ status: res.status, body: res.body }).toEqual({ status, body });
      expect(limit).not.toHaveBeenCalled();
      expect(await slugOf(id)).toBe('birthday');
    }
  );

  it('gets the 404 of a missing list without spending the limit', async () => {
    const missing = new mongoose.Types.ObjectId().toString();

    const res = await patch(missing, erin, { slug: 'probe' });

    expect({ status: res.status, body: res.body }).toEqual({ status: 404, body: NOT_FOUND });
    expect(limit).not.toHaveBeenCalled();
  });
});
