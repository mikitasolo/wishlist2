import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import {
  enforce,
  checkRateLimit,
  clientIp,
  userKey,
  ipKey,
  emailKey,
  STORE_TIMEOUT_MS,
  __setRateLimiters,
  type KeyKind,
  type LimiterName,
  type RateLimitKey,
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

const deny = () => fake({ success: false, reset: Date.now() + 60_000, remaining: 0 });

const consoleMethods = ['log', 'info', 'warn', 'error'] as const;
let spies: Record<(typeof consoleMethods)[number], MockInstance>;

beforeEach(() => {
  spies = {
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    info: vi.spyOn(console, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
  };
});

afterEach(() => {
  __setRateLimiters(null); // reset to real (env-driven) registry
  vi.restoreAllMocks();
});

/**
 * Every argument of every console call, serialized — Errors included (plain
 * `JSON.stringify` renders an Error as `{}`, which would hide a key in its message).
 */
function everythingLogged(): string {
  const calls = consoleMethods.flatMap((m) => spies[m].mock.calls);
  return JSON.stringify(calls, (_k, v: unknown) =>
    v instanceof Error ? `${v.name}: ${v.message} ${String(v.cause)} ${v.stack}` : v
  );
}

/** The parsed payloads of every `console.warn` / `console.error` line. */
function lines(method: 'warn' | 'error'): unknown[] {
  return spies[method].mock.calls.map((args) => {
    expect(args).toHaveLength(1); // one structured line — nothing tacked on
    return JSON.parse(args[0] as string);
  });
}

// What each kind of key identifies — none of these may ever reach the logs.
const IDENTIFIERS: Record<KeyKind, string> = {
  user: '64b7f0c2a1b2c3d4e5f60718',
  ip: '203.0.113.5',
  email: 'victim@example.com',
};

function keyOf(kind: KeyKind): RateLimitKey {
  switch (kind) {
    case 'user':
      return userKey(IDENTIFIERS.user);
    case 'ip':
      return ipKey(new Headers({ 'x-forwarded-for': `${IDENTIFIERS.ip}, 10.0.0.1` }));
    case 'email':
      return emailKey(IDENTIFIERS.email);
  }
}

// The key kind each limiter reports. Callers are held to their limiter's kind by
// the type check (see "rejects a key of the wrong kind" below); this table pins
// what each surface is keyed on, so changing that is a deliberate edit here too.
// Typed as a full Record, so a limiter added to SPECS without an entry fails `tsc`.
const KEY_KINDS: Record<LimiterName, KeyKind> = {
  signinEmail: 'email',
  signinIp: 'ip',
  upload: 'user',
  invite: 'user',
  follow: 'user',
  content: 'user',
  booking: 'user',
  usernameCheck: 'user',
  search: 'ip',
};
const LIMITERS = Object.entries(KEY_KINDS) as [LimiterName, KeyKind][];

// `enforce` / `checkRateLimit` only type-check with a literal limiter name; the
// table-driven tests below iterate over every name, so they call them untyped.
type Untyped<R> = (name: LimiterName, key: RateLimitKey) => Promise<R>;
const enforceAny = enforce as Untyped<Awaited<ReturnType<typeof enforce>>>;
const checkAny = checkRateLimit as Untyped<boolean>;

describe('enforce', () => {
  it('allows when no limiter is configured (disabled)', async () => {
    __setRateLimiters({}); // configured-but-empty stands in for "not configured"
    expect(await enforce('upload', userKey('user-1'))).toBeNull();
  });

  it('allows when under the limit', async () => {
    __setRateLimiters({ upload: fake({ success: true }) });
    expect(await enforce('upload', userKey('user-1'))).toBeNull();
  });

  it('returns a 429 with a Retry-After header when over the limit', async () => {
    const reset = Date.now() + 30_000;
    __setRateLimiters({ upload: fake({ success: false, reset }) });

    const res = await enforce('upload', userKey('user-1'));
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
    const res = await enforce('upload', userKey('user-1'));
    expect(Number(res!.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
  });
});

describe('the rate_limited log line', () => {
  it.each(LIMITERS)(
    '%s: logs one line with name + keyKind "%s" per block, and never the key',
    async (name, kind) => {
      __setRateLimiters({ [name]: deny() });
      const key = keyOf(kind);

      expect((await enforceAny(name, key))?.status).toBe(429);
      expect(await checkAny(name, key)).toBe(false);

      // Exactly one line per blocked call, whichever entry point blocked it.
      const expected = { event: 'rate_limited', name, keyKind: kind };
      expect(lines('warn')).toEqual([expected, expected]);
      expect(spies.error).not.toHaveBeenCalled();

      const logged = everythingLogged();
      expect(logged).not.toContain(key);
      expect(logged).not.toContain(IDENTIFIERS[kind]);
    }
  );

  it('covers every key kind', () => {
    expect(new Set(Object.values(KEY_KINDS))).toEqual(new Set(['user', 'ip', 'email']));
  });

  it('logs nothing for an allowed request', async () => {
    __setRateLimiters({ upload: fake({ success: true }), signinEmail: fake({ success: true }) });

    expect(await enforce('upload', userKey('user-1'))).toBeNull();
    expect(await checkRateLimit('signinEmail', emailKey('a@b.com'))).toBe(true);
    expect(everythingLogged()).toBe('[]');
  });

  it('logs nothing when limiting is disabled', async () => {
    __setRateLimiters({});

    expect(await enforce('search', ipKey(new Headers()))).toBeNull();
    expect(await checkRateLimit('signinIp', ipKey(new Headers()))).toBe(true);
    expect(everythingLogged()).toBe('[]');
  });

  it('rejects a key of the wrong kind at compile time', async () => {
    // The assertions that matter here are the `@ts-expect-error`s: `tsc` fails if
    // a limiter ever accepts a key other than the kind its SPECS entry declares,
    // since that key would be logged under the wrong keyKind.
    __setRateLimiters({});
    // @ts-expect-error a raw string is not a RateLimitKey
    expect(await enforce('upload', 'user-1')).toBeNull();
    // @ts-expect-error an IP key on a user-keyed limiter
    expect(await enforce('upload', ipKey(new Headers()))).toBeNull();
    // @ts-expect-error a user key on an IP-keyed limiter
    expect(await checkRateLimit('signinIp', userKey('user-1'))).toBe(true);
    // @ts-expect-error an IP key on the email-keyed limiter
    expect(await checkRateLimit('signinEmail', ipKey(new Headers()))).toBe(true);

    const someLimiter = 'upload' as LimiterName;
    // @ts-expect-error a non-literal name would accept a key of any kind
    expect(await enforce(someLimiter, userKey('user-1'))).toBeNull();
  });
});

describe('failure policy when the store throws', () => {
  const boom = (): never => {
    throw new Error('redis down');
  };

  it('fails OPEN for user-facing limiters (search)', async () => {
    __setRateLimiters({ search: fake(boom) });
    const key = ipKey(new Headers({ 'x-forwarded-for': '1.2.3.4' }));
    expect(await checkRateLimit('search', key)).toBe(true);
    expect(await enforce('search', key)).toBeNull();
  });

  it('fails CLOSED for the sign-in email limiter', async () => {
    __setRateLimiters({ signinEmail: fake(boom) });
    expect(await checkRateLimit('signinEmail', emailKey('a@b.com'))).toBe(false);
  });

  // regression: the store-error log passed the raw UpstashError, whose message
  // embeds the whole Redis command — including the key (an email, IP or user id).
  it('logs a store error as one structured line, without the key', async () => {
    const key = emailKey(IDENTIFIERS.email);
    __setRateLimiters({
      signinEmail: fake(() => {
        const err = new Error(
          `ERR max requests limit exceeded, command was: ` +
            JSON.stringify(['evalsha', 'abc123', '3', `rl:signinEmail:${key}:1`, '', '3'])
        );
        err.name = 'UpstashError';
        throw err;
      }),
    });

    expect(await checkRateLimit('signinEmail', key)).toBe(false);

    expect(lines('error')).toEqual([
      {
        event: 'rate_limit_store_error',
        name: 'signinEmail',
        keyKind: 'email',
        policy: 'fail-closed',
        error: 'UpstashError: ERR max requests limit exceeded',
      },
    ]);
    // A store failure isn't the limit being hit — it must not count as one.
    expect(spies.warn).not.toHaveBeenCalled();
    expect(everythingLogged()).not.toContain(IDENTIFIERS.email);
  });

  it('masks the key anywhere else in the error, and keeps the network cause', async () => {
    const key = userKey(IDENTIFIERS.user);
    __setRateLimiters({
      upload: fake(() => {
        throw new TypeError(`fetch failed for ${key}`, {
          cause: new Error(`getaddrinfo ENOTFOUND for ${key}`),
        });
      }),
    });

    expect(await enforce('upload', key)).toBeNull(); // fail-open

    expect(lines('error')).toEqual([
      expect.objectContaining({
        event: 'rate_limit_store_error',
        name: 'upload',
        policy: 'fail-open',
        error: 'TypeError: fetch failed for <key> (cause: getaddrinfo ENOTFOUND for <key>)',
      }),
    ]);
    expect(everythingLogged()).not.toContain(IDENTIFIERS.user);
  });

  it('describes a non-Error throw', async () => {
    __setRateLimiters({
      search: {
        async limit() {
          throw 'socket hang up';
        },
      },
    });

    expect(await enforce('search', ipKey(new Headers()))).toBeNull();
    expect(lines('error')).toEqual([expect.objectContaining({ error: 'socket hang up' })]);
  });
});

describe('failure policy when the store times out', () => {
  // What `@upstash/ratelimit` resolves when Redis doesn't answer within `timeout`.
  const timedOut = () =>
    fake({ success: true, limit: 0, remaining: 0, reset: 0, reason: 'timeout' });

  // regression: a Redis timeout doesn't throw — the SDK resolves `{ success: true,
  // reason: 'timeout' }` — and only a throw applied the failure policy, so on a
  // slow Redis the fail-closed sign-in limiters quietly failed open, unlogged.
  it.each([
    ['signinEmail', 'email', 'fail-closed'],
    ['signinIp', 'ip', 'fail-closed'],
    ['search', 'ip', 'fail-open'],
    ['upload', 'user', 'fail-open'],
  ] as const)(
    '%s (%s key): applies its %s policy and logs one store-error line, without the key',
    async (name, kind, policy) => {
      __setRateLimiters({ [name]: timedOut() });
      const key = keyOf(kind);
      const allowed = policy === 'fail-open';

      expect(await checkAny(name, key)).toBe(allowed);
      const res = await enforceAny(name, key);
      if (allowed) {
        expect(res).toBeNull();
      } else {
        expect(res?.status).toBe(429);
        expect(Number(res!.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
      }

      const expected = {
        event: 'rate_limit_store_error',
        name,
        keyKind: kind,
        policy,
        error: `Timeout: no answer from the store within ${STORE_TIMEOUT_MS} ms`,
      };
      expect(lines('error')).toEqual([expected, expected]); // one per call
      // A timeout isn't the limit being hit — it must not count as a block.
      expect(spies.warn).not.toHaveBeenCalled();

      const logged = everythingLogged();
      expect(logged).not.toContain(key);
      expect(logged).not.toContain(IDENTIFIERS[kind]);
    }
  );

  it('still trusts the SDK when it answers for another reason', async () => {
    // `cacheBlock`: the SDK's in-memory cache already knows the key is over its limit.
    __setRateLimiters({ signinEmail: fake({ success: false, reason: 'cacheBlock' }) });

    expect(await checkRateLimit('signinEmail', emailKey(IDENTIFIERS.email))).toBe(false);
    expect(lines('warn')).toEqual([
      { event: 'rate_limited', name: 'signinEmail', keyKind: 'email' },
    ]);
    expect(spies.error).not.toHaveBeenCalled();
  });

  describe('against the real SDK, with a Redis that never answers', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://test-store.upstash.io');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
      vi.stubGlobal(
        'fetch',
        vi.fn(() => new Promise<never>(() => {}))
      );
      __setRateLimiters(null); // build the real registry from the env above
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('gives up after STORE_TIMEOUT_MS and fails the sign-in limiter closed', async () => {
      // Not awaited: it only settles once the clock reaches the SDK's timeout.
      let allowed: boolean | undefined;
      void checkRateLimit('signinEmail', emailKey(IDENTIFIERS.email)).then((ok) => (allowed = ok));

      await vi.advanceTimersByTimeAsync(STORE_TIMEOUT_MS - 1);
      expect(fetch).toHaveBeenCalled(); // it really is waiting on the store
      expect(allowed).toBeUndefined();

      await vi.advanceTimersByTimeAsync(1);
      expect(allowed).toBe(false);
      expect(lines('error')).toEqual([
        expect.objectContaining({
          event: 'rate_limit_store_error',
          name: 'signinEmail',
          policy: 'fail-closed',
        }),
      ]);
      expect(everythingLogged()).not.toContain(IDENTIFIERS.email);
    });
  });
});

describe('key builders', () => {
  it('userKey is the user id itself', () => {
    expect(userKey('64b7f0c2a1b2c3d4e5f60718')).toBe('64b7f0c2a1b2c3d4e5f60718');
  });

  it('ipKey prefixes the client IP', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.5, 70.41.3.18' });
    expect(ipKey(h)).toBe('ip:203.0.113.5');
    expect(ipKey(new Headers())).toBe('ip:unknown');
  });

  it('emailKey is case-insensitive, so changing case does not buy a fresh budget', () => {
    expect(emailKey('Victim@Example.COM')).toBe('victim@example.com');
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
