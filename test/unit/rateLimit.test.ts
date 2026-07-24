import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  enforce,
  checkRateLimit,
  clientIp,
  __setRateLimiters,
  type RateLimiter,
  type RateLimitResult,
} from '@/lib/rateLimit';

// A controllable fake limiter — no Redis, no network.
function fake(result: Partial<RateLimitResult> | (() => never)): RateLimiter {
  return {
    async limit() {
      if (typeof result === 'function') return result();
      return { success: true, reset: 0, limit: 10, remaining: 9, ...result };
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  __setRateLimiters(null); // reset to real (env-driven) registry
  vi.restoreAllMocks();
});

describe('enforce', () => {
  it('allows when no limiter is configured (disabled)', async () => {
    __setRateLimiters({}); // configured-but-empty stands in for "not configured"
    expect(await enforce('upload', 'user-1')).toBeNull();
  });

  it('allows when under the limit', async () => {
    __setRateLimiters({ upload: fake({ success: true }) });
    expect(await enforce('upload', 'user-1')).toBeNull();
  });

  it('returns a 429 with a Retry-After header when over the limit', async () => {
    const reset = Date.now() + 30_000;
    __setRateLimiters({ upload: fake({ success: false, reset }) });

    const res = await enforce('upload', 'user-1');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);

    const retryAfter = Number(res!.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(30);

    const body = await res!.json();
    expect(body.success).toBe(false);
  });

  it('never emits a Retry-After below 1 second', async () => {
    __setRateLimiters({ upload: fake({ success: false, reset: Date.now() - 5_000 }) });
    const res = await enforce('upload', 'user-1');
    expect(Number(res!.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
  });
});

describe('failure policy when the store throws', () => {
  const boom = (): never => {
    throw new Error('redis down');
  };

  it('fails OPEN for user-facing limiters (search)', async () => {
    __setRateLimiters({ search: fake(boom) });
    expect(await checkRateLimit('search', 'ip:1.2.3.4')).toBe(true);
    expect(await enforce('search', 'ip:1.2.3.4')).toBeNull();
  });

  it('fails CLOSED for the sign-in email limiter', async () => {
    __setRateLimiters({ signinEmail: fake(boom) });
    expect(await checkRateLimit('signinEmail', 'a@b.com')).toBe(false);
  });
});

describe('clientIp', () => {
  it('takes the first hop of x-forwarded-for', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.5, 70.41.3.18, 150.172.238.178' });
    expect(clientIp(h)).toBe('203.0.113.5');
  });

  it('falls back to x-real-ip', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.7' }))).toBe('198.51.100.7');
  });

  it('returns "unknown" when no IP header is present', () => {
    expect(clientIp(new Headers())).toBe('unknown');
  });
});
