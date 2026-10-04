import { NextResponse, after } from 'next/server';
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
 *  - **Configured but the store fails** at request time — it throws, or doesn't
 *    answer within `STORE_TIMEOUT_MS`: per-limiter policy — `fail-open` for
 *    user-facing reads/writes (an infra blip must not lock people out) and
 *    `fail-closed` for the cost-bearing sign-in email path (never let an email
 *    bomb through because Redis hiccuped).
 *
 * Observability: each time a limiter turns a request away it logs one JSON
 * line, `{"event":"rate_limited","name":…,"keyKind":…}`, and — after the
 * response — bumps a per-surface, per-day counter in Redis (see
 * `countBlockAfterResponse`), which outlives Vercel's short log retention, so
 * there are block counts to tune `SPECS` from. A store failure (a throw or a
 * timeout) logs one `rate_limit_store_error` line instead. Neither line, nor the
 * counter's key, ever includes the limiter key — it's an email, an IP or a user
 * id — so a key's *kind* is declared per limiter and enforced at compile time
 * (see `RateLimitKey`) rather than read from the key.
 */

export interface RateLimitResult {
  success: boolean;
  /** Epoch ms when the current window resets. */
  reset: number;
  limit: number;
  remaining: number;
  /**
   * Why the SDK answered the way it did, when it didn't consult Redis normally.
   * `'timeout'` means Redis never answered — `success` is then the SDK's own
   * fail-open default, not a verdict, so `run()` treats it as a store failure.
   */
  reason?: Awaited<ReturnType<Ratelimit['limit']>>['reason'];
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
// the `rl:stats:*` counters (and the `rate_limited` log lines) count blocks per surface.
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
  // Asking a list's owners to invite you (WIS-275): each ask notifies every
  // owner, so a cancel-and-ask-again loop can't turn into a stream of them.
  joinRequest: { tokens: 10, window: '1 h', policy: 'fail-open', keyKind: 'user' },
  usernameCheck: { tokens: 30, window: '1 m', policy: 'fail-open', keyKind: 'user' },
  // A list's URL, chosen by its owner. Slugs are unique across every list, so
  // "already taken" (409) says some list holds one, an archived list included
  // (the one kind no other answer confirms): a budget for a person renaming a
  // URL, not for trying slugs in bulk from a list of their own.
  wishlistSlug: { tokens: 10, window: '10 m', policy: 'fail-open', keyKind: 'user' },
  // Deleting an account: a few tries for a person whose deletion failed part-way
  // and is finishing it, not a loop hammering the heaviest write there is.
  accountDelete: { tokens: 5, window: '1 h', policy: 'fail-open', keyKind: 'user' },
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

/**
 * How long `limit()` waits for Redis before giving up — shorter than the SDK's
 * 5 s default, because every limited request (a sign-in included) waits this
 * long when the store is down. A healthy Upstash call takes tens of ms (a few
 * hundred on a cold cross-region connection), so 2 s is well past a slow answer.
 * It also covers the Redis client's first four retries when a fetch fails fast
 * (a reset or DNS error — it sleeps 50, 136, 369 and 1004 ms before them), so a
 * brief blip is retried rather than failed. The trade-off: a store answering
 * slower than this fails the sign-in limiters closed rather than waiting for a
 * verdict. If timeout lines show up in the logs while Upstash is healthy, raise it.
 *
 * On timeout the SDK doesn't throw: it resolves `{ success: true, reason:
 * 'timeout' }`. A connection that hangs never retries, and a fast-failing one
 * retries past the deadline (the five retries alone sleep ~4.3 s), so an
 * unreachable store surfaces this way, not as a throw; only an HTTP error from
 * Upstash throws. `run()` therefore applies the failure policy to a timeout too.
 */
export const STORE_TIMEOUT_MS = 2_000;

/** What a store failure logs when Redis didn't answer within `STORE_TIMEOUT_MS`. */
const STORE_TIMEOUT_ERROR = `Timeout: no answer from the store within ${STORE_TIMEOUT_MS} ms`;

/**
 * How long a day's block counter lives: about 60 days, comfortably past the 2–4
 * week window `SPECS` is tuned from. `EXPIRE` runs on every block, so it counts
 * from the day's last block.
 */
export const BLOCK_STATS_TTL_SECONDS = 60 * 24 * 60 * 60;

/** The slice of `@upstash/redis` the block counter uses — lets tests inject a fake. */
export interface BlockStatsStore {
  pipeline(): BlockStatsPipeline;
}

export interface BlockStatsPipeline {
  incr(key: string): BlockStatsPipeline;
  expire(key: string, seconds: number): BlockStatsPipeline;
  exec(): Promise<unknown>;
}

let registry: Partial<Record<LimiterName, RateLimiter>> | null = null;
/** Where blocks are counted — the limiters' Redis; `null` while limiting is disabled. */
let statsStore: BlockStatsStore | null = null;
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
      timeout: STORE_TIMEOUT_MS,
      // Off: `countBlockAfterResponse` already counts blocks per surface.
      // Upstash analytics would add a ZINCRBY to every `limit()` call, allowed
      // or blocked, and store the raw key (email / IP / user id) in Redis.
      analytics: false,
    });
  }
  registry = built;
  statsStore = redis;
  return registry;
}

/**
 * The store's error, minus anything that could carry the key. `UpstashError`
 * appends the whole command (`…, command was: ["evalsha",…,"rl:<name>:<key>:…"]`),
 * so that tail is cut, and any other occurrence of the key is masked.
 */
function describeStoreError(error: unknown, key = ''): string {
  let text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (error instanceof Error && error.cause instanceof Error) {
    text += ` (cause: ${error.cause.message})`;
  }
  text = text.split(', command was:')[0]!;
  return key ? text.replaceAll(key, '<key>') : text;
}

/**
 * Log one `rate_limit_store_error` line. `error` must already be free of the key.
 * `policy` says how the request was answered; a failed block count carries
 * `op: 'count'` instead, since the request had already been turned away.
 */
function logStoreError(
  name: LimiterName,
  detail: { policy: Policy } | { op: 'count' },
  error: string
): void {
  console.error(
    JSON.stringify({
      event: 'rate_limit_store_error',
      name,
      keyKind: SPECS[name].keyKind,
      ...detail,
      error,
    })
  );
}

/**
 * The store failed to answer (it threw or timed out): log one line — `error`
 * must already be free of the key — and apply the limiter's failure policy.
 */
function storeFailure(name: LimiterName, error: string): RateLimitResult {
  const spec = SPECS[name];
  logStoreError(name, { policy: spec.policy }, error);
  return {
    success: spec.policy === 'fail-open',
    reset: Date.now() + 60_000,
    limit: spec.tokens,
    remaining: 0,
  };
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
    return storeFailure(name, describeStoreError(error, key));
  }

  // Not a verdict: the SDK gave up waiting on Redis and defaulted to allow (see
  // `STORE_TIMEOUT_MS`). Taking its `success` would fail the sign-in limiters open.
  if (result.reason === 'timeout') {
    return storeFailure(name, STORE_TIMEOUT_ERROR);
  }

  if (!result.success) {
    // One line per block, for tuning SPECS from real traffic. Never the key.
    console.warn(JSON.stringify({ event: 'rate_limited', name, keyKind: spec.keyKind }));
    // And one count per block Redis answered. A repeat block the SDK answers from
    // its in-memory cache (`cacheBlock`) costs no Redis command; counting it would
    // let a flood from one source spend the store's command quota, which every
    // limiter depends on (sign-in fails closed without it).
    if (result.reason !== 'cacheBlock') countBlockAfterResponse(name);
  }
  return result;
}

/**
 * The counter a block is added to: `rl:stats:<env>:<name>:<YYYY-MM-DD>`, the UTC
 * day. `env` is `VERCEL_ENV` (`'local'` when unset), so dev and preview traffic
 * sharing the store never mixes with production's. Built from the limiter's name
 * alone — never from its key, nor anything derived from it. (It shares the
 * limiters' `rl:<name>` prefix space, so `stats` can't be a limiter name.)
 */
function blockStatsKey(name: LimiterName): string {
  const env = process.env.VERCEL_ENV || 'local';
  const day = new Date().toISOString().slice(0, 10);
  return `rl:stats:${env}:${name}:${day}`;
}

/**
 * Count a block in Redis, once the response is out: `INCR` + `EXPIRE` in one
 * pipeline, so one Upstash request (two billed commands) per counted block and
 * none for allowed requests. Nothing when limiting is disabled.
 *
 * Inside a request scope — route handlers, and Auth.js's `sendVerificationRequest`
 * — it goes through Next's `after()`, which runs it after the response is sent
 * and keeps the function alive until it's done. Outside one (or where Next can't
 * wait on it), `after()` throws and the count is fired and forgotten. Either way
 * it can't slow down or fail the request: `countBlock` never rejects.
 */
function countBlockAfterResponse(name: LimiterName): void {
  const store = statsStore;
  if (!store) return;
  const statsKey = blockStatsKey(name); // now, so a block just before midnight counts that day
  const task = () => countBlock(store, name, statsKey);
  try {
    after(task);
  } catch {
    void task();
  }
}

/**
 * Run the counter pipeline. A failure — a throw, or no answer within
 * `STORE_TIMEOUT_MS` (a hung store would otherwise keep the function alive via
 * `after()`) — logs one `rate_limit_store_error` line and is otherwise ignored.
 */
async function countBlock(
  store: BlockStatsStore,
  name: LimiterName,
  statsKey: string
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answered = await Promise.race([
      store
        .pipeline()
        .incr(statsKey)
        .expire(statsKey, BLOCK_STATS_TTL_SECONDS)
        .exec()
        .then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(resolve, STORE_TIMEOUT_MS, false);
      }),
    ]);
    if (!answered) logStoreError(name, { op: 'count' }, STORE_TIMEOUT_ERROR);
  } catch (error) {
    // The command carries only the counter key, but cut it like any other.
    logStoreError(name, { op: 'count' }, describeStoreError(error));
  } finally {
    clearTimeout(timer);
  }
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

/** What `clientIp` answers when the request carries no client IP. */
export const UNKNOWN_CLIENT_IP = 'unknown';

/** First hop of `x-forwarded-for` (the client) for IP-keyed limits. */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return headers.get('x-real-ip')?.trim() || UNKNOWN_CLIENT_IP;
}

/**
 * Test-only: inject a fake limiter registry, and optionally a fake store to count
 * blocks in (none by default, so nothing is counted), or `null` to reset both to real.
 */
export function __setRateLimiters(
  r: Partial<Record<LimiterName, RateLimiter>> | null,
  stats: BlockStatsStore | null = null
): void {
  registry = r;
  statsStore = stats;
}
