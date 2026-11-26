import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));

import { fallbackAllows, fallbackKey } from '@/lib/rateLimitFallback';
import RateLimitFallbackHit from '@/models/RateLimitFallbackHit';

const WINDOW = 15 * 60_000;
const limit = (key: string, id = 'signinEmail') => ({
  id,
  key,
  tokens: 3,
  windowMs: WINDOW,
  deadline: Date.now() + 3_000,
});

beforeAll(connectTestDB);
afterAll(disconnectTestDB);
beforeEach(async () => {
  await clearTestDB();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-26T10:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('fallbackAllows (the sign-in limiters’ MongoDB stand-in, WIS-457)', () => {
  it('allows the limiter’s tokens per window and refuses the next', async () => {
    for (let i = 0; i < 3; i++) expect(await fallbackAllows(limit('a@b.com'))).toBe(true);
    expect(await fallbackAllows(limit('a@b.com'))).toBe(false);
  });

  it('takes a refused request’s hit back, so refusals don’t keep the key blocked', async () => {
    for (let i = 0; i < 3; i++) await fallbackAllows(limit('a@b.com'));
    for (let i = 0; i < 5; i++) expect(await fallbackAllows(limit('a@b.com'))).toBe(false);
    expect(await RateLimitFallbackHit.countDocuments()).toBe(3);

    // Once the first hits leave the window, the key has room again.
    vi.setSystemTime(new Date(Date.now() + WINDOW + 1));
    expect(await fallbackAllows(limit('a@b.com'))).toBe(true);
  });

  it('slides: only hits inside the window count', async () => {
    await fallbackAllows(limit('a@b.com'));
    vi.setSystemTime(new Date(Date.now() + WINDOW - 60_000));
    await fallbackAllows(limit('a@b.com'));
    await fallbackAllows(limit('a@b.com'));
    vi.setSystemTime(new Date(Date.now() + 60_001)); // the first hit is now out
    expect(await fallbackAllows(limit('a@b.com'))).toBe(true);
    expect(await fallbackAllows(limit('a@b.com'))).toBe(false);
  });

  it('counts each limiter and each key apart', async () => {
    for (let i = 0; i < 3; i++) await fallbackAllows(limit('a@b.com'));
    expect(await fallbackAllows(limit('c@d.com'))).toBe(true);
    expect(await fallbackAllows(limit('a@b.com', 'signinIp'))).toBe(true);
  });

  it('allows exactly the tokens left when requests race for them', async () => {
    await fallbackAllows(limit('a@b.com'));
    await fallbackAllows(limit('a@b.com'));
    const answers = await Promise.all(
      Array.from({ length: 5 }, () => fallbackAllows(limit('a@b.com')))
    );
    expect(answers.filter(Boolean)).toHaveLength(1);
    expect(await RateLimitFallbackHit.countDocuments()).toBe(3);
  });

  // regression: a MongoDB slower than the caller's timeout still wrote the hit
  // after the request had been refused, spending a token for nothing.
  it('spends nothing for a request whose caller gave up before it was counted', async () => {
    const late = { ...limit('a@b.com'), deadline: Date.now() - 1 };
    expect(await fallbackAllows(late)).toBe(false);
    expect(await RateLimitFallbackHit.countDocuments()).toBe(0);

    // Written in time, but the caller's deadline passed before the count came back.
    const passing = { ...limit('a@b.com'), deadline: Date.now() + 1_000 };
    const countDocuments = RateLimitFallbackHit.countDocuments.bind(RateLimitFallbackHit);
    const spy = vi.spyOn(RateLimitFallbackHit, 'countDocuments').mockImplementationOnce(((
      ...args: Parameters<typeof countDocuments>
    ) => {
      vi.setSystemTime(new Date(Date.now() + 2_000));
      return countDocuments(...args);
    }) as typeof countDocuments);
    expect(await fallbackAllows(passing)).toBe(false);
    spy.mockRestore();
    expect(await RateLimitFallbackHit.countDocuments()).toBe(0);
  });

  it('stores only an HMAC of the key, and rows that expire with their window', async () => {
    await fallbackAllows(limit('victim@example.com'));
    await fallbackAllows(limit('ip:203.0.113.7', 'signinIp'));

    const rows = await RateLimitFallbackHit.find().lean();
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain('victim');
    expect(stored).not.toContain('203.0.113');
    expect(rows.map((r) => r.key).sort()).toEqual(
      [
        fallbackKey('signinEmail', 'victim@example.com'),
        fallbackKey('signinIp', 'ip:203.0.113.7'),
      ].sort()
    );
    for (const row of rows) {
      expect(row.expiresAt.getTime() - row.at.getTime()).toBe(WINDOW);
    }

    const indexes = await RateLimitFallbackHit.collection.indexes();
    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 })
    );
  });

  it('keys the HMAC on the app secret, not on the key alone', () => {
    const a = fallbackKey('signinEmail', 'a@b.com');
    vi.stubEnv('NEXTAUTH_SECRET', 'another-secret');
    try {
      expect(fallbackKey('signinEmail', 'a@b.com')).not.toBe(a);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
