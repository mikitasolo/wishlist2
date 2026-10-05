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
 *
 * New accounts (WIS-42): a few surfaces that reach other people or cost money
 * have a stricter tier, `NEW_ACCOUNT_SPECS`, for an account whose first verified
 * sign-in is under 24h old (`isNewAccount`, carried as the session's
 * `newAccount`). The route passes `{ newAccount }` to `enforce`, which then uses
 * that tier's limiter, counted under its own Redis prefix (`rl:<name>:new`) so an
 * account that ages out starts on a clean standard bucket. A block on it logs and
 * counts with `tier: 'new'`.
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
  // Giving back an upload no form saved (WIS-181): its own budget, so a
  // cancelled form never spends an upload, and twice the upload's, since each
  // upload is handed back at most once.
  uploadRelease: { tokens: 40, window: '10 m', policy: 'fail-open', keyKind: 'user' },
  invite: { tokens: 30, window: '1 h', policy: 'fail-open', keyKind: 'user' },
  follow: { tokens: 60, window: '1 h', policy: 'fail-open', keyKind: 'user' },
  // Making a list's share links (WIS-334): each is a way in for anyone holding
  // it, so it's budgeted like an invite. Only creation: edits and revokes, and
  // opening a live link, are never limited.
  shareLink: { tokens: 30, window: '1 h', policy: 'fail-open', keyKind: 'user' },
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
  // A notification email's one-click unsubscribe (WIS-321), signed out. A valid
  // link is limited per account it names, never per IP: RFC 8058's POST comes
  // from the mail provider's servers, whose few shared IPs carry everyone's
  // unsubscribes, and a refused one isn't retried. Only links that don't
  // verify spend the per-IP budget.
  unsubscribe: { tokens: 20, window: '10 m', policy: 'fail-open', keyKind: 'user' },
  unsubscribeInvalid: { tokens: 30, window: '10 m', policy: 'fail-open', keyKind: 'ip' },
  // A share link that doesn't open the list it's sent for (WIS-335): unknown,
  // revoked, expired, another list's, or a malformed token. Only failed lookups
  // spend it, per IP, so guessing tokens is slow; a live link never does, as a
  // whole wedding may open one from a single IP, polling every 5 seconds.
  shareLinkInvalid: { tokens: 30, window: '10 m', policy: 'fail-open', keyKind: 'ip' },
  // Notification emails (WIS-321), one budget per kind, keyed on the
  // *recipient*: what someone else's actions can make us send to one inbox.
  // Fail closed, like the sign-in email: sending costs, and a dropped
  // notification email is only a missed nudge (Activity still has it). A
  // proposal's is also coalesced to one per list a day (`claimProposalEmail`).
  emailJoinRequest: { tokens: 10, window: '1 h', policy: 'fail-closed', keyKind: 'user' },
  emailProposal: { tokens: 10, window: '1 h', policy: 'fail-closed', keyKind: 'user' },
  emailAccessChanged: { tokens: 10, window: '1 h', policy: 'fail-closed', keyKind: 'user' },
  emailInviteAccepted: { tokens: 10, window: '1 h', policy: 'fail-closed', keyKind: 'user' },
  emailProposalApproved: { tokens: 10, window: '1 h', policy: 'fail-closed', keyKind: 'user' },
  emailOccasionReminder: { tokens: 10, window: '1 d', policy: 'fail-closed', keyKind: 'user' },
} satisfies Record<string, LimiterSpec>;

export type LimiterName = keyof typeof SPECS;

/**
 * The stricter tier for an account under 24h old (WIS-42, values the operator
 * accepted on 2026-10-04): only the surfaces that reach other people (invites,
 * follows, new lists and items) or cost money (uploads). Booking, search and
 * sign-in have none. Policy and key kind are the standard entry's.
 */
const NEW_ACCOUNT_SPECS = {
  upload: { tokens: 5, window: '10 m' },
  invite: { tokens: 5, window: '1 h' },
  follow: { tokens: 20, window: '1 h' },
  shareLink: { tokens: 5, window: '1 h' },
  joinRequest: { tokens: 3, window: '1 h' },
  content: { tokens: 20, window: '1 h' },
} satisfies Partial<Record<LimiterName, Pick<LimiterSpec, 'tokens' | 'window'>>>;

/** The limiters that have a new-account tier. */
export type NewAccountLimiterName = keyof typeof NEW_ACCOUNT_SPECS;

/** A limiter in the registry: a standard one by its name, a new-account one as `<name>:new`. */
export type RegistryName = LimiterName | `${NewAccountLimiterName}:new`;

/** Which of a limiter's tiers a request is counted against. */
interface Tier {
  name: LimiterName;
  /** `true` for the new-account tier (ignored by a limiter that has none). */
  newAccount: boolean;
}

function hasNewAccountTier(name: LimiterName): name is NewAccountLimiterName {
  return Object.hasOwn(NEW_ACCOUNT_SPECS, name);
}

/** The registry entry, tokens and window a request is counted against. */
function tierSpec(tier: Tier): {
  id: RegistryName;
  tokens: number;
  window: LimiterSpec['window'];
} {
  const { name } = tier;
  if (tier.newAccount && hasNewAccountTier(name)) {
    return { id: `${name}:new`, ...NEW_ACCOUNT_SPECS[name] };
  }
  return { id: name, tokens: SPECS[name].tokens, window: SPECS[name].window };
}

/**
 * A limiter's budget for one tier, the standard one or (for a limiter that has
 * one) the new-account one: what the registry builds, and what tests pin.
 */
export function tierLimits(
  name: LimiterName,
  newAccount: boolean
): { tokens: number; window: LimiterSpec['window'] } {
  const { tokens, window } = tierSpec({ name, newAccount });
  return { tokens, window };
}

/**
 * `enforce` / `checkRateLimit`'s options: `newAccount` (the session's) picks the
 * stricter tier, and only a limiter that has one takes it.
 */
export type EnforceOptions<N extends LimiterName> = N extends NewAccountLimiterName
  ? { newAccount: boolean | undefined }
  : never;

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;

/**
 * The key a limiter accepts: branded with the kind its `SPECS` entry declares.
 * `never` unless `N` is a single limiter — a non-literal `LimiterName` would
 * otherwise accept a key of any kind and slip past the check.
 */
type KeyFor<N extends LimiterName> =
  IsUnion<N> extends true ? never : RateLimitKey<(typeof SPECS)[N]['keyKind']>;

/**
 * The rest of `enforce` / `checkRateLimit`'s arguments: `[options]`, required,
 * for a limiter with a new-account tier, and nothing for any other.
 */
type OptionsArg<N extends LimiterName> = [N] extends [NewAccountLimiterName]
  ? [options: EnforceOptions<N>]
  : [];

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

let registry: Partial<Record<RegistryName, RateLimiter>> | null = null;
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

function getRegistry(): Partial<Record<RegistryName, RateLimiter>> {
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
  const built: Partial<Record<RegistryName, RateLimiter>> = {};
  const tiers: Tier[] = (Object.keys(SPECS) as LimiterName[]).flatMap((name) => [
    { name, newAccount: false },
    ...(hasNewAccountTier(name) ? [{ name, newAccount: true }] : []),
  ]);
  for (const tier of tiers) {
    const spec = tierSpec(tier);
    built[spec.id] = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(spec.tokens, spec.window),
      // `rl:<name>`, or `rl:<name>:new` for the new-account tier.
      prefix: `rl:${spec.id}`,
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
  tier: Tier,
  detail: { policy: Policy } | { op: 'count' },
  error: string
): void {
  console.error(
    JSON.stringify({
      event: 'rate_limit_store_error',
      name: tier.name,
      keyKind: SPECS[tier.name].keyKind,
      ...tierField(tier),
      ...detail,
      error,
    })
  );
}

/**
 * The store failed to answer (it threw or timed out): log one line — `error`
 * must already be free of the key — and apply the limiter's failure policy.
 */
function storeFailure(tier: Tier, error: string): RateLimitResult {
  const { policy } = SPECS[tier.name];
  logStoreError(tier, { policy }, error);
  return {
    success: policy === 'fail-open',
    reset: Date.now() + 60_000,
    limit: tierSpec(tier).tokens,
    remaining: 0,
  };
}

/**
 * What a log line adds for the tier: `tier: 'new'` on the new-account tier,
 * nothing on the standard one (whose lines keep their shape).
 */
function tierField(tier: Tier): { tier?: 'new' } {
  return tierSpec(tier).id === tier.name ? {} : { tier: 'new' };
}

async function run(tier: Tier, key: string): Promise<RateLimitResult> {
  const { name } = tier;
  const spec = tierSpec(tier);
  const limiter = getRegistry()[spec.id];

  // Not configured → allow (limiting disabled).
  if (!limiter) {
    return { success: true, reset: 0, limit: spec.tokens, remaining: spec.tokens };
  }

  let result: RateLimitResult;
  try {
    result = await limiter.limit(key);
  } catch (error) {
    return storeFailure(tier, describeStoreError(error, key));
  }

  // Not a verdict: the SDK gave up waiting on Redis and defaulted to allow (see
  // `STORE_TIMEOUT_MS`). Taking its `success` would fail the sign-in limiters open.
  if (result.reason === 'timeout') {
    return storeFailure(tier, STORE_TIMEOUT_ERROR);
  }

  if (!result.success) {
    // One line per block, for tuning SPECS from real traffic. Never the key.
    console.warn(
      JSON.stringify({
        event: 'rate_limited',
        name,
        keyKind: SPECS[name].keyKind,
        ...tierField(tier),
      })
    );
    // And one count per block Redis answered. A repeat block the SDK answers from
    // its in-memory cache (`cacheBlock`) costs no Redis command; counting it would
    // let a flood from one source spend the store's command quota, which every
    // limiter depends on (sign-in fails closed without it).
    if (result.reason !== 'cacheBlock') countBlockAfterResponse(tier);
  }
  return result;
}

/**
 * The counter a block is added to: `rl:stats:<env>:<name>:<YYYY-MM-DD>`, the UTC
 * day (`<name>:new` for the new-account tier). `env` is `VERCEL_ENV` (`'local'` when unset), so dev and preview traffic
 * sharing the store never mixes with production's. Built from the limiter's name
 * alone — never from its key, nor anything derived from it. (It shares the
 * limiters' `rl:<name>` prefix space, so `stats` can't be a limiter name.)
 */
function blockStatsKey(tier: Tier): string {
  const env = process.env.VERCEL_ENV || 'local';
  const day = new Date().toISOString().slice(0, 10);
  return `rl:stats:${env}:${tierSpec(tier).id}:${day}`;
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
function countBlockAfterResponse(tier: Tier): void {
  const store = statsStore;
  if (!store) return;
  const statsKey = blockStatsKey(tier); // now, so a block just before midnight counts that day
  const task = () => countBlock(store, tier, statsKey);
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
async function countBlock(store: BlockStatsStore, tier: Tier, statsKey: string): Promise<void> {
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
    if (!answered) logStoreError(tier, { op: 'count' }, STORE_TIMEOUT_ERROR);
  } catch (error) {
    // The command carries only the counter key, but cut it like any other.
    logStoreError(tier, { op: 'count' }, describeStoreError(error));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Enforce a limit for a route handler. Returns a ready-to-return 429
 * `NextResponse` (with `Retry-After`) when over the limit, or `null` when the
 * request may proceed.
 *
 *   const limited = await enforce('upload', userKey(session.user.id), {
 *     newAccount: session.user.newAccount,
 *   });
 *   if (limited) return limited;
 *
 * A limiter with a new-account tier (`NEW_ACCOUNT_SPECS`) requires
 * `{ newAccount }`, the session's, so a route can't forget it; only `true`
 * picks that tier. Any other limiter takes no options.
 */
export async function enforce<N extends LimiterName>(
  name: N,
  key: KeyFor<N>,
  ...[options]: OptionsArg<N>
): Promise<NextResponse | null> {
  const result = await run({ name, newAccount: options?.newAccount === true }, key);
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
  key: KeyFor<N>,
  ...[options]: OptionsArg<N>
): Promise<boolean> {
  return (await run({ name, newAccount: options?.newAccount === true }, key)).success;
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
 * Test-only: inject a fake limiter registry (a new-account tier as `<name>:new`), and optionally a fake store to count
 * blocks in (none by default, so nothing is counted), or `null` to reset both to real.
 */
export function __setRateLimiters(
  r: Partial<Record<RegistryName, RateLimiter>> | null,
  stats: BlockStatsStore | null = null
): void {
  registry = r;
  statsStore = stats;
}
