import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/lib/auth';
import { POST as FOLLOW } from '@/app/api/users/[id]/follow/route';
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

afterEach(() => __setRateLimiters(null));

function follow() {
  const req = new NextRequest(`http://localhost/api/users/${targetId}/follow`, { method: 'POST' });
  return FOLLOW(req, { params: Promise.resolve({ id: targetId }) });
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

  it('proceeds normally when limiting is disabled', async () => {
    __setRateLimiters({}); // disabled → allow

    const res = await follow();
    expect(res.status).toBe(200);
    expect(await Follow.countDocuments({ follower: actorId, following: targetId })).toBe(1);
  });
});
