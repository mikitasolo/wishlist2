import { NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * App-level rate limiting. See `README.md` (Security & privacy) for the design.
 *
 * Store: Upstash Redis via `@upstash/ratelimit` — serverless-native (HTTP, no
 * connection pool), atomic sliding-window counters, shared across the ephemeral
 * function instances Vercel spins up. Configured via `UPSTASH_REDIS_REST_URL` /
 * `UPSTASH_REDIS_REST_TOKEN`.
 *
 * Graceful degradation:
 *  - **Not configured** (no Upstash env — local dev, CI, tests): limiting is
 *    disabled and every request is allowed. Logged once so it's obvious in prod.
 *  - **Configured but the store errors** at request time: per-limiter policy —
 *    `fail-open` for user-facing reads/writes (an infra blip must not lock
 *    people out) and `fail-closed` for the cost-bearing sign-in email path
 *    (never let an email bomb through because Redis hiccuped).
 *
 * Observability: each time a limiter turns a request away it logs one JSON
 * line, `{"event":"rate_limited","name":…,"keyKind":…}`, so Vercel's logs give
 * per-surface block counts to tune `SPECS` from. A store error (a throw) logs
 * one `rate_limit_store_error` line instead. Neither ever includes the key — it's
 * an email, an IP or a user id — so a key's *kind* is declared per limiter and
 * enforced at compile time (see `RateLimitKey`) rather than read from the key.
 */

export interface RateLimitResult {
  success: boolean;
  /** Epoch ms when the current window resets. */
  reset: number;
  limit: number;
  remaining: number;
}

/** The shape we depend on from `@upstash/ratelimit` — lets tests inject a fake. */
export interface RateLimiter {
  limit(key: string): Promise<RateLimitResult>;
}

type Policy = 'fail-open' | 'fail-closed';

/** What a limiter's key identifies. Logged on a block in place of the key itself. */
export type KeyKind = 'user' | 'ip' | 'email';

declare const keyKindBrand: unique symbol;

/**
 * A limiter key, branded with what it identifies. Build one only with `userKey` /
 * `ipKey` / `emailKey`: `enforce` / `checkRateLimit` accept only the kind their
 * `SPECS` entry declares, so a key of the wrong kind — which would mislabel the
 * `rate_limited` log line — is a type error rather than a silent mislabel.
 */
export type RateLimitKey<K extends KeyKind = KeyKind> = string & { readonly [keyKindBrand]: K };

interface LimiterSpec {
  tokens: number;
  /** Upstash duration string, e.g. `'15 m'`, `'1 h'`. */
  window: Parameters<typeof Ratelimit.slidingWindow>[1];
  policy: Policy;
  keyKind: KeyKind;
}

// One entry per surface. Limits are starting points to tune from real traffic —
// the `rate_limited` log lines count blocks per surface.
const SPECS = {
  // Sign-in magic link — the top abuse target (email bombing + SMTP cost). Fail
  // closed: better to reject a legitimate retry than to let a flood through.
  signinEmail: { tokens: 3, window: '15 m', policy: 'fail-closed', keyKind: 'email' },
  signinIp: { tokens: 10, window: '15 m', policy: 'fail-closed', keyKind: 'ip' },
  // Authenticated, cost-bearing or spammy write surfaces — keyed on user id.
  upload: { tokens: 20, window: '10 m', policy: 'fail-open', keyKind: 'user' },
  invite: { tokens: 30, window: '1 h', policy: 'fail-open', keyKind: 'user' },
  follow: { tokens: 60, window: '1 h', policy: 'fail-open', keyKind: 'user' },
  content: { tokens: 60, window: '1 h', policy: 'fail-open', keyKind: 'user' },
  booking: { tokens: 60, window: '1 h', policy: 'fail-open', keyKind: 'user' },
  usernameCheck: { tokens: 30, window: '1 m', policy: 'fail-open', keyKind: 'user' },
  // Public read/scraping surfaces — keyed on IP.
  search: { tokens: 60, window: '1 m', policy: 'fail-open', keyKind: 'ip' },
} satisfies Record<string, LimiterSpec>;

export type LimiterName = keyof typeof SPECS;

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

/**
 * The key a limiter accepts: branded with the kind its `SPECS` entry declares.
 * `never` unless `N` is a single limiter — a non-literal `LimiterName` would
 * otherwise accept a key of any kind and slip past the check.
 */
type KeyFor<N extends LimiterName> =
  IsUnion<N> extends true ? never : RateLimitKey<(typeof SPECS)[N]['keyKind']>;

/** Key an authenticated surface on the caller's user id. */
export function userKey(userId: string): RateLimitKey<'user'> {
  return userId as RateLimitKey<'user'>;
}

/** Key a public surface on the client IP (`ip:<first x-forwarded-for hop>`). */
export function ipKey(headers: Headers): RateLimitKey<'ip'> {
  return `ip:${clientIp(headers)}` as RateLimitKey<'ip'>;
}

/** Key the sign-in email path on the (case-insensitive) target address. */
export function emailKey(email: string): RateLimitKey<'email'> {
  return email.toLowerCase() as RateLimitKey<'email'>;
}

let registry: Partial<Record<LimiterName, RateLimiter>> | null = null;
let warned = false;

/**
 * REST credentials for the Redis store. Accepts either the Upstash-native names
 * (`UPSTASH_REDIS_REST_*`) or the `KV_REST_API_*` names Vercel's Marketplace
 * integration may inject — so the app works whichever the connector chooses.
 */
function redisCreds(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

function getRegistry(): Partial<Record<LimiterName, RateLimiter>> {
  if (registry) return registry;

  const creds = redisCreds();
  if (!creds) {
    if (!warned) {
      console.warn(
        '[rateLimit] No Redis credentials (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN) ' +
          '— rate limiting is DISABLED. Set them in production to enforce limits.'
      );
      warned = true;
    }
    registry = {};
    return registry;
  }

  const redis = new Redis({ url: creds.url, token: creds.token });
  const built: Partial<Record<LimiterName, RateLimiter>> = {};
  for (const name of Object.keys(SPECS) as LimiterName[]) {
    const spec = SPECS[name];
    built[name] = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(spec.tokens, spec.window),
      prefix: `rl:${name}`,
      // Off: the `rate_limited` log line already counts blocks per surface.
      // Upstash analytics would add a ZINCRBY to every `limit()` call, allowed
      // or blocked, and store the raw key (email / IP / user id) in Redis.
      analytics: false,
    });
  }
  registry = built;
  return registry;
}

/**
 * The store's error, minus anything that could carry the key. `UpstashError`
 * appends the whole command (`…, command was: ["evalsha",…,"rl:<name>:<key>:…"]`),
 * so that tail is cut, and any other occurrence of the key is masked.
 */
function describeStoreError(error: unknown, key: string): string {
  let text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (error instanceof Error && error.cause instanceof Error) {
    text += ` (cause: ${error.cause.message})`;
  }
  text = text.split(', command was:')[0]!;
  return key ? text.replaceAll(key, '<key>') : text;
}

async function run(name: LimiterName, key: string): Promise<RateLimitResult> {
  const spec = SPECS[name];
  const limiter = getRegistry()[name];

  // Not configured → allow (limiting disabled).
  if (!limiter) {
    return { success: true, reset: 0, limit: spec.tokens, remaining: spec.tokens };
  }

  let result: RateLimitResult;
  try {
    result = await limiter.limit(key);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'rate_limit_store_error',
        name,
        keyKind: spec.keyKind,
        policy: spec.policy,
        error: describeStoreError(error, key),
      })
    );
    // Store unreachable → apply the limiter's failure policy.
    return {
      success: spec.policy === 'fail-open',
      reset: Date.now() + 60_000,
      limit: spec.tokens,
      remaining: 0,
    };
  }

  if (!result.success) {
    // One line per block, for tuning SPECS from real traffic. Never the key.
    console.warn(JSON.stringify({ event: 'rate_limited', name, keyKind: spec.keyKind }));
  }
  return result;
}

/**
 * Enforce a limit for a route handler. Returns a ready-to-return 429
 * `NextResponse` (with `Retry-After`) when over the limit, or `null` when the
 * request may proceed.
 *
 *   const limited = await enforce('upload', userKey(session.user.id));
 *   if (limited) return limited;
 */
export async function enforce<N extends LimiterName>(
  name: N,
  key: KeyFor<N>
): Promise<NextResponse | null> {
  const result = await run(name, key);
  if (result.success) return null;

  const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
  return NextResponse.json(
    { success: false, error: 'Too many requests. Please slow down.' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  );
}

/**
 * Boolean check for non-route contexts (e.g. NextAuth's `sendVerificationRequest`,
 * which must throw to abort rather than return a response). `true` = allowed.
 */
export async function checkRateLimit<N extends LimiterName>(
  name: N,
  key: KeyFor<N>
): Promise<boolean> {
  return (await run(name, key)).success;
}

/** First hop of `x-forwarded-for` (the client) for IP-keyed limits. */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Test-only: inject a fake limiter registry (or `null` to reset to real). */
export function __setRateLimiters(r: Partial<Record<LimiterName, RateLimiter>> | null): void {
  registry = r;
}
