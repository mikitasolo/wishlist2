import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { POST as FOLLOW } from '@/app/api/users/[id]/follow/route';
import { GET as SEARCH } from '@/app/api/search/route';
import { __setRateLimiters, type RateLimiter } from '@/lib/rateLimit';
import User from '@/models/User';
import Follow from '@/models/Follow';

const session = vi.mocked(auth);

// Always-deny limiter: proves the route bails out before its side effect runs.
const denyAll: RateLimiter = {
  async limit() {
    return { success: false, reset: Date.now() + 60_000, limit: 60, remaining: 0 };
  },
};

let actorId: string;
let targetId: string;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  const actor = await User.create({ email: 'actor@x.com', username: 'actor' });
  const target = await User.create({ email: 'target@x.com', username: 'target' });
  actorId = actor._id.toString();
  targetId = target._id.toString();
  session.mockResolvedValue({ user: { id: actorId, username: 'actor' } } as never);
});

afterEach(() => {
  __setRateLimiters(null);
  vi.restoreAllMocks();
});

function follow() {
  const req = new NextRequest(`http://localhost/api/users/${targetId}/follow`, { method: 'POST' });
  return FOLLOW(req, { params: Promise.resolve({ id: targetId }) });
}

/** Spies on console.warn and returns the `rate_limited` payloads plus everything logged. */
function captureWarnings() {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  return {
    lines: () => warn.mock.calls.map((args) => JSON.parse(args[0] as string)),
    raw: () => JSON.stringify(warn.mock.calls),
  };
}

describe('rate limiting on a write route (follow)', () => {
  // regression: rate-limited requests must 429 AND not perform their side effect.
  it('returns 429 and does not create the follow when over the limit', async () => {
    __setRateLimiters({ follow: denyAll });

    const res = await follow();
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(await Follow.countDocuments({ follower: actorId, following: targetId })).toBe(0);
  });

  it('logs the block as a user-keyed "follow" limit, without the user id', async () => {
    __setRateLimiters({ follow: denyAll });
    const warnings = captureWarnings();

    expect((await follow()).status).toBe(429);
    expect(warnings.lines()).toEqual([{ event: 'rate_limited', name: 'follow', keyKind: 'user' }]);
    expect(warnings.raw()).not.toContain(actorId);
  });

  it('proceeds normally when limiting is disabled', async () => {
    __setRateLimiters({}); // disabled → allow

    const res = await follow();
    expect(res.status).toBe(200);
    expect(await Follow.countDocuments({ follower: actorId, following: targetId })).toBe(1);
  });
});

describe('rate limiting on a public route (search)', () => {
  it('logs the block as an IP-keyed "search" limit, without the IP', async () => {
    __setRateLimiters({ search: denyAll });
    const warnings = captureWarnings();

    const req = new NextRequest('http://localhost/api/search?q=ta', {
      headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
    });
    const res = await SEARCH(req);
    expect(res.status).toBe(429);
    expect(warnings.lines()).toEqual([{ event: 'rate_limited', name: 'search', keyKind: 'ip' }]);
    expect(warnings.raw()).not.toContain('203.0.113.5');
  });
});
