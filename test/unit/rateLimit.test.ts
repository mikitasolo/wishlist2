import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { after } from 'next/server';
import {
  enforce,
  checkRateLimit,
  clientIp,
  userKey,
  ipKey,
  emailKey,
  STORE_TIMEOUT_MS,
  BLOCK_STATS_TTL_SECONDS,
  __setRateLimiters,
  tierLimits,
  type BlockStatsPipeline,
  type BlockStatsStore,
  type KeyKind,
  type LimiterName,
  type NewAccountLimiterName,
  type RateLimitKey,
  type RateLimiter,
  type RateLimitResult,
} from '@/lib/rateLimit';

// The real `after()` throws outside a request scope, as every test here is, so
// the block counter takes its fire-and-forget path unless a test swaps in an
// implementation that stands in for a request scope.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: vi.fn(actual.after) };
});

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

/** `enforce`'s options for an account past its first 24h: the standard tier. */
const STANDARD = { newAccount: false };

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
  vi.mocked(after).mockReset(); // back to the real `after()`
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
  uploadRelease: 'user',
  invite: 'user',
  shareLink: 'user',
  follow: 'user',
  content: 'user',
  booking: 'user',
  linkJoin: 'user',
  joinRequest: 'user',
  usernameCheck: 'user',
  wishlistSlug: 'user',
  accountDelete: 'user',
  search: 'ip',
  unsubscribe: 'user',
  unsubscribeInvalid: 'ip',
  shareLinkInvalid: 'ip',
  emailJoinRequest: 'user',
  emailLinkJoin: 'user',
  emailProposal: 'user',
  emailAccessChanged: 'user',
  emailInviteAccepted: 'user',
  emailProposalApproved: 'user',
  emailOccasionReminder: 'user',
  emailBirthdayReminder: 'user',
};
const LIMITERS = Object.entries(KEY_KINDS) as [LimiterName, KeyKind][];

// `enforce` / `checkRateLimit` only type-check with a literal limiter name; the
// table-driven tests below iterate over every name, so they call them untyped.
type Untyped<R> = (name: LimiterName, key: RateLimitKey) => Promise<R>;
const enforceAny = enforce as Untyped<Awaited<ReturnType<typeof enforce>>>;
const checkAny = checkRateLimit as Untyped<boolean>;
// And the same for the limiters with a new-account tier, which take its option.
type UntypedTiered<R> = (
  name: NewAccountLimiterName,
  key: RateLimitKey,
  options: { newAccount: boolean | undefined }
) => Promise<R>;
const enforceTiered = enforce as UntypedTiered<Awaited<ReturnType<typeof enforce>>>;
const checkTiered = checkRateLimit as UntypedTiered<boolean>;

describe('enforce', () => {
  it('allows when no limiter is configured (disabled)', async () => {
    __setRateLimiters({}); // configured-but-empty stands in for "not configured"
    expect(await enforce('upload', userKey('user-1'), STANDARD)).toBeNull();
  });

  it('allows when under the limit', async () => {
    __setRateLimiters({ upload: fake({ success: true }) });
    expect(await enforce('upload', userKey('user-1'), STANDARD)).toBeNull();
  });

  it('returns a 429 with a Retry-After header when over the limit', async () => {
    const reset = Date.now() + 30_000;
    __setRateLimiters({ upload: fake({ success: false, reset }) });

    const res = await enforce('upload', userKey('user-1'), STANDARD);
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
    const res = await enforce('upload', userKey('user-1'), STANDARD);
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

    expect(await enforce('upload', userKey('user-1'), STANDARD)).toBeNull();
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
    expect(await enforce('upload', 'user-1', STANDARD)).toBeNull();
    // @ts-expect-error an IP key on a user-keyed limiter
    expect(await enforce('upload', ipKey(new Headers()), STANDARD)).toBeNull();
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

    expect(await enforce('upload', key, STANDARD)).toBeNull(); // fail-open

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

/** A fake Redis for the block counter: records every pipeline it hands out. */
function fakeStats(exec: () => Promise<unknown> = async () => [1, 1]) {
  const pipelines: { commands: unknown[][]; execs: number }[] = [];
  const store: BlockStatsStore = {
    pipeline() {
      const p = { commands: [] as unknown[][], execs: 0 };
      pipelines.push(p);
      const chain: BlockStatsPipeline = {
        incr(key) {
          p.commands.push(['incr', key]);
          return chain;
        },
        expire(key, seconds) {
          p.commands.push(['expire', key, seconds]);
          return chain;
        },
        exec() {
          p.execs++;
          return exec();
        },
      };
      return chain;
    },
  };
  return { store, pipelines };
}

/** One block's pipeline: INCR the day's counter, then EXPIRE it, sent once. */
const counted = (statsKey: string) => ({
  commands: [
    ['incr', statsKey],
    ['expire', statsKey, BLOCK_STATS_TTL_SECONDS],
  ],
  execs: 1,
});

/** Make `after()` behave as in a request scope: queue the task instead of running it. */
function inRequestScope(): (() => unknown)[] {
  const deferred: (() => unknown)[] = [];
  vi.mocked(after).mockImplementation((task) => {
    deferred.push(task as () => unknown);
  });
  return deferred;
}

describe('the block counter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    vi.stubEnv('VERCEL_ENV', 'production');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('keeps a day counter for about 60 days', () => {
    expect(BLOCK_STATS_TTL_SECONDS).toBe(60 * 24 * 60 * 60);
  });

  it.each(LIMITERS)(
    '%s: a block increments rl:stats:production:<name>:<today> and sets its expiry, never with the key',
    async (name, kind) => {
      const { store, pipelines } = fakeStats();
      __setRateLimiters({ [name]: deny() }, store);
      const key = keyOf(kind);

      expect((await enforceAny(name, key))?.status).toBe(429);
      expect(await checkAny(name, key)).toBe(false);

      // One pipeline per blocked call, whichever entry point blocked it.
      const statsKey = `rl:stats:production:${name}:2026-10-01`;
      expect(pipelines).toEqual([counted(statsKey), counted(statsKey)]);

      const written = JSON.stringify(pipelines);
      expect(written).not.toContain(key);
      expect(written).not.toContain(IDENTIFIERS[kind]);
      expect(spies.error).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['preview', 'preview'],
    ['development', 'development'],
    [undefined, 'local'],
  ] as const)('keeps VERCEL_ENV=%s apart from production, under "%s"', async (vercelEnv, env) => {
    vi.stubEnv('VERCEL_ENV', vercelEnv);
    const { store, pipelines } = fakeStats();
    __setRateLimiters({ search: deny() }, store);

    await enforce('search', ipKey(new Headers()));
    expect(pipelines).toEqual([counted(`rl:stats:${env}:search:2026-10-01`)]);
  });

  it('counts by the UTC day of the block', async () => {
    const { store, pipelines } = fakeStats();
    __setRateLimiters({ upload: deny() }, store);

    vi.setSystemTime(new Date('2026-10-01T23:59:59.999Z'));
    await enforce('upload', userKey(IDENTIFIERS.user), STANDARD);
    vi.setSystemTime(new Date('2026-10-02T00:00:00.000Z'));
    await enforce('upload', userKey(IDENTIFIERS.user), STANDARD);

    expect(pipelines).toEqual([
      counted('rl:stats:production:upload:2026-10-01'),
      counted('rl:stats:production:upload:2026-10-02'),
    ]);
  });

  it('writes nothing for an allowed request', async () => {
    const { store, pipelines } = fakeStats();
    __setRateLimiters(
      { upload: fake({ success: true }), signinEmail: fake({ success: true }) },
      store
    );

    expect(await enforce('upload', userKey('user-1'), STANDARD)).toBeNull();
    expect(await checkRateLimit('signinEmail', emailKey('a@b.com'))).toBe(true);
    expect(pipelines).toEqual([]);
    expect(after).not.toHaveBeenCalled();
  });

  it('writes nothing when no limiter is configured', async () => {
    const { store, pipelines } = fakeStats();
    __setRateLimiters({}, store);

    expect(await enforce('search', ipKey(new Headers()))).toBeNull();
    expect(await checkRateLimit('signinIp', ipKey(new Headers()))).toBe(true);
    expect(pipelines).toEqual([]);
  });

  it('sends nothing anywhere without Redis credentials (limiting disabled)', async () => {
    for (const name of [
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'KV_REST_API_URL',
      'KV_REST_API_TOKEN',
    ]) {
      vi.stubEnv(name, undefined);
    }
    vi.stubGlobal('fetch', vi.fn());
    __setRateLimiters(null); // the real, env-driven registry

    expect(await enforce('search', ipKey(new Headers()))).toBeNull();
    expect(await checkRateLimit('signinEmail', emailKey('a@b.com'))).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it('does not count a store failure, even one that turns the request away', async () => {
    const { store, pipelines } = fakeStats();
    __setRateLimiters(
      {
        signinEmail: fake(() => {
          throw new Error('redis down');
        }),
        signinIp: fake({ success: true, reason: 'timeout' }),
      },
      store
    );

    // Both fail closed — but neither is the limit being hit.
    expect(await checkRateLimit('signinEmail', emailKey('a@b.com'))).toBe(false);
    expect(await checkRateLimit('signinIp', ipKey(new Headers()))).toBe(false);
    expect(pipelines).toEqual([]);
  });

  it('does not count a repeat block the SDK answered from its in-memory cache', async () => {
    // `cacheBlock` costs no Redis command; counting it would let a flood from one
    // source spend the store's quota. The block is still logged.
    const { store, pipelines } = fakeStats();
    __setRateLimiters({ signinIp: fake({ success: false, reason: 'cacheBlock' }) }, store);

    expect(await checkRateLimit('signinIp', ipKey(new Headers()))).toBe(false);
    expect(pipelines).toEqual([]);
    expect(after).not.toHaveBeenCalled();
    expect(lines('warn')).toEqual([{ event: 'rate_limited', name: 'signinIp', keyKind: 'ip' }]);
  });

  it('counts after the response when there is a request scope', async () => {
    const deferred = inRequestScope();
    const { store, pipelines } = fakeStats();
    __setRateLimiters({ booking: deny() }, store);

    expect(
      (await enforce('booking', userKey(IDENTIFIERS.user), { newAccount: false }))?.status
    ).toBe(429);
    // Answered, and nothing written yet: the count waits for the response.
    expect(after).toHaveBeenCalledTimes(1);
    expect(pipelines).toEqual([]);

    await Promise.all(deferred.map((task) => task()));
    expect(pipelines).toEqual([counted('rl:stats:production:booking:2026-10-01')]);
  });

  it('counts the day the block happened, even if the task runs after midnight', async () => {
    const deferred = inRequestScope();
    const { store, pipelines } = fakeStats();
    __setRateLimiters({ content: deny() }, store);

    vi.setSystemTime(new Date('2026-10-01T23:59:59.999Z'));
    await enforce('content', userKey(IDENTIFIERS.user), STANDARD);
    vi.setSystemTime(new Date('2026-10-02T00:00:00.500Z'));
    await deferred[0]!();

    expect(pipelines).toEqual([counted('rl:stats:production:content:2026-10-01')]);
  });

  describe('when the increment fails', () => {
    // What Upstash throws on an HTTP error: the whole pipeline is in the message.
    const upstashError = (statsKey: string) => {
      const err = new Error(
        `ERR max requests limit exceeded, command was: ` +
          JSON.stringify([
            ['incr', statsKey],
            ['expire', statsKey, BLOCK_STATS_TTL_SECONDS],
          ])
      );
      err.name = 'UpstashError';
      return err;
    };

    it.each(LIMITERS)(
      '%s: neither throws into the request nor logs the key, and logs one store-error line',
      async (name, kind) => {
        const { store } = fakeStats(async () => {
          throw upstashError(`rl:stats:production:${name}:2026-10-01`);
        });
        __setRateLimiters({ [name]: deny() }, store);
        const key = keyOf(kind);

        // Still the limiter's answer: a 429 / `false`, not a throw.
        expect((await enforceAny(name, key))?.status).toBe(429);
        expect(await checkAny(name, key)).toBe(false);

        const expected = {
          event: 'rate_limit_store_error',
          name,
          keyKind: kind,
          op: 'count',
          error: 'UpstashError: ERR max requests limit exceeded',
        };
        await vi.waitFor(() => expect(lines('error')).toEqual([expected, expected]));
        // The blocks themselves are still logged, once each.
        const blocked = { event: 'rate_limited', name, keyKind: kind };
        expect(lines('warn')).toEqual([blocked, blocked]);

        const logged = everythingLogged();
        expect(logged).not.toContain(key);
        expect(logged).not.toContain(IDENTIFIERS[kind]);
      }
    );

    it('hands after() a task that never rejects', async () => {
      // Next logs a rejected `after()` task's error raw; the store-error line must
      // be the only thing a failed count logs.
      const deferred = inRequestScope();
      const { store } = fakeStats(async () => {
        throw upstashError('rl:stats:production:invite:2026-10-01');
      });
      __setRateLimiters({ invite: deny() }, store);

      expect((await enforce('invite', userKey(IDENTIFIERS.user), STANDARD))?.status).toBe(429);
      await expect(deferred[0]!()).resolves.toBeUndefined();
      expect(lines('error')).toEqual([
        expect.objectContaining({ event: 'rate_limit_store_error', name: 'invite', op: 'count' }),
      ]);
    });

    it('also catches a store that throws before sending anything', async () => {
      const store: BlockStatsStore = {
        pipeline() {
          throw new TypeError('pipeline unavailable');
        },
      };
      __setRateLimiters({ follow: deny() }, store);

      expect((await enforce('follow', userKey(IDENTIFIERS.user), STANDARD))?.status).toBe(429);
      await vi.waitFor(() =>
        expect(lines('error')).toEqual([
          {
            event: 'rate_limit_store_error',
            name: 'follow',
            keyKind: 'user',
            op: 'count',
            error: 'TypeError: pipeline unavailable',
          },
        ])
      );
    });

    it('gives up on a store that never answers after STORE_TIMEOUT_MS', async () => {
      vi.useRealTimers(); // re-install, this time with the timers faked too
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
      const { store, pipelines } = fakeStats(() => new Promise<never>(() => {}));
      __setRateLimiters({ signinEmail: deny() }, store);

      // The request isn't held up by the hung store.
      expect(await checkRateLimit('signinEmail', emailKey(IDENTIFIERS.email))).toBe(false);
      expect(pipelines).toEqual([counted('rl:stats:production:signinEmail:2026-10-01')]);

      await vi.advanceTimersByTimeAsync(STORE_TIMEOUT_MS - 1);
      expect(spies.error).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(lines('error')).toEqual([
        {
          event: 'rate_limit_store_error',
          name: 'signinEmail',
          keyKind: 'email',
          op: 'count',
          error: `Timeout: no answer from the store within ${STORE_TIMEOUT_MS} ms`,
        },
      ]);
      expect(everythingLogged()).not.toContain(IDENTIFIERS.email);
    });
  });
});

// WIS-42: the operator's values (2026-10-04). Only these surfaces have a
// new-account tier; search and sign-in keep one limit for everyone.
const NEW_ACCOUNT_LIMITS: Record<NewAccountLimiterName, { tokens: number; window: string }> = {
  invite: { tokens: 5, window: '1 h' },
  follow: { tokens: 20, window: '1 h' },
  content: { tokens: 20, window: '1 h' },
  upload: { tokens: 5, window: '10 m' },
  // WIS-334: making share links, budgeted like invites.
  shareLink: { tokens: 5, window: '1 h' },
  // WIS-335: each ask notifies every owner of a list a share link opened.
  joinRequest: { tokens: 3, window: '1 h' },
  // WIS-337: joining through a Join link, and booking, which a forwarded Join
  // link would otherwise open to a fresh account reserving a whole list.
  linkJoin: { tokens: 5, window: '1 h' },
  booking: { tokens: 20, window: '1 h' },
};
const TIERED = Object.keys(NEW_ACCOUNT_LIMITS) as NewAccountLimiterName[];
const NEW = { newAccount: true };

describe('the new-account tier', () => {
  it('has the agreed limits, stricter than the standard tier', () => {
    for (const name of TIERED) {
      expect(tierLimits(name, true)).toEqual(NEW_ACCOUNT_LIMITS[name]);
      const standard = tierLimits(name, false);
      expect(standard.window).toBe(NEW_ACCOUNT_LIMITS[name].window);
      expect(standard.tokens).toBeGreaterThan(NEW_ACCOUNT_LIMITS[name].tokens);
    }
  });

  it('leaves every other limiter on its one tier', () => {
    for (const name of Object.keys(KEY_KINDS) as LimiterName[]) {
      if ((TIERED as LimiterName[]).includes(name)) continue;
      expect(tierLimits(name, true)).toEqual(tierLimits(name, false));
    }
  });

  it.each(TIERED)(
    '%s: a new account is counted on <name>:new, anyone else on <name>',
    async (name) => {
      const calls: string[] = [];
      const recording = (id: string): RateLimiter => ({
        async limit(key) {
          calls.push(`${id} ${key}`);
          return { success: true, reset: 0, limit: 1, remaining: 1 };
        },
      });
      __setRateLimiters({ [name]: recording(name), [`${name}:new`]: recording(`${name}:new`) });
      const key = userKey(IDENTIFIERS.user);

      await enforceTiered(name, key, NEW);
      await enforceTiered(name, key, STANDARD);
      await enforceTiered(name, key, { newAccount: undefined });
      await checkTiered(name, key, NEW);

      expect(calls).toEqual([
        `${name}:new ${IDENTIFIERS.user}`,
        `${name} ${IDENTIFIERS.user}`,
        `${name} ${IDENTIFIERS.user}`,
        `${name}:new ${IDENTIFIERS.user}`,
      ]);
    }
  );

  it('turns a new account away on its own tier while the standard one would allow it', async () => {
    __setRateLimiters({ invite: fake({ success: true }), 'invite:new': deny() });
    const key = userKey(IDENTIFIERS.user);

    expect((await enforce('invite', key, NEW))?.status).toBe(429);
    expect(await enforce('invite', key, STANDARD)).toBeNull();
  });

  it.each(TIERED)(
    '%s: a block logs one line with tier "new", and counts it apart, never with the key',
    async (name) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
      vi.stubEnv('VERCEL_ENV', 'production');
      const { store, pipelines } = fakeStats();
      __setRateLimiters({ [`${name}:new`]: deny() }, store);
      const key = userKey(IDENTIFIERS.user);

      expect((await enforceTiered(name, key, NEW))?.status).toBe(429);

      expect(lines('warn')).toEqual([
        { event: 'rate_limited', name, keyKind: 'user', tier: 'new' },
      ]);
      await vi.waitFor(() =>
        expect(pipelines).toEqual([counted(`rl:stats:production:${name}:new:2026-10-01`)])
      );
      expect(everythingLogged()).not.toContain(IDENTIFIERS.user);
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  );

  it('logs a store failure on the new tier with tier "new" and its policy', async () => {
    __setRateLimiters({
      'upload:new': fake(() => {
        throw new Error(`redis down for ${IDENTIFIERS.user}`);
      }),
    });

    expect(await enforce('upload', userKey(IDENTIFIERS.user), NEW)).toBeNull(); // fail-open
    expect(lines('error')).toEqual([
      {
        event: 'rate_limit_store_error',
        name: 'upload',
        keyKind: 'user',
        tier: 'new',
        policy: 'fail-open',
        error: 'Error: redis down for <key>',
      },
    ]);
  });

  it('is required where it exists and refused where it does not, at compile time', async () => {
    // The assertions that matter are the `@ts-expect-error`s: a route on a tiered
    // limiter can't forget the session's `newAccount`, and no other takes one.
    __setRateLimiters({});
    const key = userKey(IDENTIFIERS.user);
    // @ts-expect-error a tiered limiter needs { newAccount }
    expect(await enforce('invite', key)).toBeNull();
    // @ts-expect-error booking has one since WIS-337
    expect(await enforce('booking', key)).toBeNull();
    // @ts-expect-error search has no new-account tier
    expect(await enforce('search', ipKey(new Headers()), NEW)).toBeNull();
    expect(await enforce('search', ipKey(new Headers()))).toBeNull();
  });

  describe('against the real SDK', () => {
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

    /** Everything sent to the store so far, as one string. */
    const sent = () => JSON.stringify(vi.mocked(fetch).mock.calls);

    it.each(TIERED)('%s: keeps the new tier under its own prefix, rl:<name>:new', async (name) => {
      void enforceTiered(name, userKey(IDENTIFIERS.user), NEW);
      await vi.advanceTimersByTimeAsync(0);
      expect(sent()).toContain(`rl:${name}:new:${IDENTIFIERS.user}`);

      vi.mocked(fetch).mockClear();
      void enforceTiered(name, userKey(IDENTIFIERS.user), STANDARD);
      await vi.advanceTimersByTimeAsync(0);
      expect(sent()).toContain(`rl:${name}:${IDENTIFIERS.user}`);
      expect(sent()).not.toContain(`rl:${name}:new:`);
      await vi.advanceTimersByTimeAsync(STORE_TIMEOUT_MS);
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
