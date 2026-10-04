import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendWishlistInvitationEmail: vi.fn() }));

import { auth } from '@/lib/auth';
import { POST as inviteMember } from '@/app/api/wishlists/[id]/members/route';
import { POST as follow } from '@/app/api/users/[id]/follow/route';
import { __setRateLimiters, tierLimits, type RateLimiter } from '@/lib/rateLimit';
import { sessionPayload } from '@/lib/utils/sessionPayload';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistInvite from '@/models/WishlistInvite';
import Follow from '@/models/Follow';

/**
 * WIS-42: an account whose first verified sign-in is under 24h old gets the
 * stricter tier on the surfaces that reach other people. The session is built
 * by the real `sessionPayload` from the account's `emailVerified`, as the
 * session callback builds it, so this runs from the row to the 429.
 */

const session = vi.mocked(auth);
const HOUR = 60 * 60 * 1000;

/** A sliding window stand-in: allows `tokens` calls per key, then blocks. */
function counting(tokens: number): RateLimiter {
  const used = new Map<string, number>();
  return {
    async limit(key) {
      const n = (used.get(key) ?? 0) + 1;
      used.set(key, n);
      return {
        success: n <= tokens,
        reset: Date.now() + HOUR,
        limit: tokens,
        remaining: Math.max(0, tokens - n),
      };
    },
  };
}

let ownerId: string;
let wishlistId: string;
let invitees: string[];

/** Sign in as the owner, whose first verified sign-in was `verifiedAgoMs` ago (or never). */
async function signInVerified(verifiedAgoMs: number | null) {
  const emailVerified = verifiedAgoMs === null ? null : new Date(Date.now() - verifiedAgoMs);
  await User.updateOne({ _id: ownerId }, { $set: { emailVerified } });
  const row = { id: ownerId, email: 'owner@x.com', username: 'owner', emailVerified };
  session.mockResolvedValue(sessionPayload(row, null, new Date(Date.now() + HOUR)));
}

function invite(username: string) {
  return inviteMember(
    new NextRequest(`http://localhost/api/wishlists/${wishlistId}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username }),
    }),
    { params: Promise.resolve({ id: wishlistId }) }
  );
}

/** Invite each of the invitees in turn, and give back each answer's status. */
async function inviteEveryone(): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < invitees.length; i++) statuses.push((await invite(`friend${i}`)).status);
  return statuses;
}

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  ownerId = (await User.create({ email: 'owner@x.com', username: 'owner' }))._id.toString();
  // One more than the new-account invite budget.
  const count = tierLimits('invite', true).tokens + 1;
  invitees = [];
  for (let i = 0; i < count; i++) {
    const u = await User.create({ email: `friend${i}@x.com`, username: `friend${i}` });
    invitees.push(u._id.toString());
  }
  wishlistId = (
    await Wishlist.create({ name: 'Birthday', owners: [ownerId], visibility: 'everyone' })
  )._id.toString();
  __setRateLimiters({
    invite: counting(tierLimits('invite', false).tokens),
    'invite:new': counting(tierLimits('invite', true).tokens),
    follow: counting(tierLimits('follow', false).tokens),
    'follow:new': counting(tierLimits('follow', true).tokens),
  });
});

afterEach(() => {
  __setRateLimiters(null);
  vi.restoreAllMocks();
});

describe('the new-account invite limit', () => {
  it('turns a fresh account away once it passes the lower threshold', async () => {
    await signInVerified(HOUR);
    const budget = tierLimits('invite', true).tokens;
    expect(budget).toBe(5);

    const statuses = await inviteEveryone();
    expect(statuses.slice(0, budget)).toEqual(Array(budget).fill(201));
    expect(statuses[budget]).toBe(429);
    // The refused invite was never issued.
    expect(await WishlistInvite.countDocuments({ wishlist: wishlistId })).toBe(budget);
  });

  it('treats an account with no emailVerified as new', async () => {
    await signInVerified(null);
    const statuses = await inviteEveryone();
    expect(statuses.at(-1)).toBe(429);
  });

  it('lets an account older than 24h go past it, on the standard limit', async () => {
    await signInVerified(25 * HOUR);
    const statuses = await inviteEveryone();
    expect(statuses).toEqual(Array(invitees.length).fill(201));
    expect(await WishlistInvite.countDocuments({ wishlist: wishlistId })).toBe(invitees.length);
  });

  it('starts an account that ages out on a fresh standard bucket', async () => {
    await signInVerified(HOUR);
    expect((await inviteEveryone()).at(-1)).toBe(429);

    // A day later the same account is on the standard tier, whose bucket the
    // new-account invites never touched.
    await WishlistInvite.deleteMany({});
    await signInVerified(25 * HOUR);
    expect(await inviteEveryone()).toEqual(Array(invitees.length).fill(201));
  });
});

describe('the new-account follow limit', () => {
  it('applies to a fresh account and not to an old one', async () => {
    const budget = tierLimits('follow', true).tokens;
    expect(budget).toBe(20);
    const targets: string[] = [];
    for (let i = 0; i <= budget; i++) {
      targets.push((await User.create({ email: `t${i}@x.com`, username: `t${i}` }))._id.toString());
    }
    const followAll = async () => {
      const statuses: number[] = [];
      for (const id of targets) {
        const req = new NextRequest(`http://localhost/api/users/${id}/follow`, { method: 'POST' });
        statuses.push((await follow(req, { params: Promise.resolve({ id }) })).status);
      }
      return statuses;
    };

    await signInVerified(HOUR);
    const fresh = await followAll();
    expect(fresh.slice(0, budget).every((s) => s < 300)).toBe(true);
    expect(fresh[budget]).toBe(429);
    expect(await Follow.countDocuments({ follower: ownerId })).toBe(budget);

    await Follow.deleteMany({});
    await signInVerified(25 * HOUR);
    expect((await followAll()).every((s) => s < 300)).toBe(true);
  });
});
