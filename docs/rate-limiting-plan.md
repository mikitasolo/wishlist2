# Rate limiting & anti-spam — plan

Status: **plan, not yet implemented.** This proposes the mechanism, where to apply it, and a rollout order. Two distinct problems, one shared mechanism:

- **Load / abuse** — protect cost and availability (email sends, blob writes, DB load, third-party fetches).
- **Anti-spam** — protect _other users_ from being flooded with content or notifications by one actor.

## Why we can't just use an in-memory counter

The app runs on Vercel serverless — each request may hit a different, short-lived instance, so a `Map` of counts in module scope neither shares state across instances nor survives cold starts. We need a **shared, atomic, TTL'd store**.

**Recommended store: Upstash Redis** via `@upstash/ratelimit` — serverless-native (HTTP, no connection pool), atomic sliding-window counters, one env var pair (`UPSTASH_REDIS_REST_URL` / `_TOKEN`), free tier covers this app. Alternatives considered:

- **Vercel Firewall / WAF rate rules** — edge-enforced, zero app code, great as an outer coarse layer (per-IP request ceilings). Can't express per-user or per-action logic, so it complements but doesn't replace app-level limits.
- **MongoDB TTL collection** — no new dependency (we already have Mongo), a `{ key, count, expiresAt }` doc with an atomic `$inc` upsert + TTL index. Adds DB load to the hot path and races are fiddlier than Redis. Fine as a fallback if we refuse a new dependency.

Decision: **Upstash for app-level limits + Vercel WAF for a coarse per-IP edge ceiling.** MongoDB fallback documented if we want zero new services.

## Identity key: what we count per

- **Authenticated actions** → key on `session.user.id` (the real actor; survives IP changes).
- **Unauthenticated actions** (sign-in, username-check) → key on client IP (`x-forwarded-for` first hop, via Vercel's `request.headers`), plus the target where it matters (see sign-in).
- **Cost-bearing external effects** (emails) → _also_ key on the target (email address / invited user) so one attacker can't fan out across many IPs to bomb one victim.

## Where to apply it

Highest value first. "Limit" values are starting points to tune from logs.

| Surface                                 | Route                                             | Risk                                                          | Limit (start)                                        | Key                     |
| --------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------- | ----------------------- |
| **Magic-link sign-in** (email send)     | `api/auth/[...nextauth]` (email provider)         | **Email bombing** a victim; SMTP cost/reputation. Top target. | 3 / 15 min per (email), 10 / 15 min per IP           | email **and** IP        |
| **Image upload**                        | `api/upload`                                      | Blob storage cost, bandwidth                                  | 20 / 10 min per user                                 | user                    |
| **Invites**                             | `api/invite`, `api/wishlists/[id]/invites`        | Spamming a user's Invitations list / notifications            | 30 / hour per user; + per-target cap (below)         | user (+ invited target) |
| **Follows**                             | `api/users/[id]/follow`                           | Follow/unfollow churn, notification spam                      | 60 / hour per user                                   | user                    |
| **Content creation** (wishlists, items) | `api/wishlists`, `api/wishlists/[id]/items`       | Bulk junk content                                             | 60 / hour per user                                   | user                    |
| **Booking toggle**                      | `api/items/[id]` (book/unbook)                    | Toggle churn, notification noise for the gifter view          | 60 / hour per user                                   | user                    |
| **Username availability**               | `api/users/check-username`                        | Enumeration / scraping                                        | 30 / min per IP                                      | IP                      |
| **Search & profile lookup**             | `api/search`, `api/users/search`, `by-username/*` | Scraping the user/wishlist graph                              | 60 / min per user-or-IP                              | user or IP              |
| **Paste-a-link import** (when built)    | (future) `api/import/link`                        | SSRF amplification, outbound fetch abuse                      | 10 / 10 min per user                                 | user                    |
| **Migration endpoints**                 | `api/migrations/*`                                | Secret brute force                                            | Already secret-gated + timing-safe; add 5 / min / IP | IP                      |

Coarse outer layer (Vercel WAF): a blanket per-IP ceiling (e.g. 100 req / 10 s) to absorb floods before they reach functions.

## Anti-spam layer (separate from counting)

Rate limits slow a single actor; these stop the _effect_ from reaching victims and don't depend on request volume:

- **Per-target caps, not just per-actor rates.** E.g. at most _N pending invites per (invitee)_ across all inviters, and dedupe (already have a unique invite index) so re-inviting doesn't stack. Same idea for follow notifications.
- **Idempotency / dedupe.** Booking, follow, invite already have natural unique keys — lean on unique indexes so retries and rapid toggles don't create duplicate side effects or notifications.
- **Bot wall on sign-in.** Add **Cloudflare Turnstile** (or hCaptcha) to the sign-in form. It's the cheapest big win against automated email-bombing and pairs with the per-email limit above. Invisible/managed mode keeps UX friction near zero.
- **Notification coalescing** (ties into the notification-center work): collapse "X and 3 others followed you" so even lawful bursts don't flood; a spammer then produces one line, not fifty.
- **New-account friction.** Lower limits for accounts younger than ~24h (most abuse is throwaway accounts), relaxed automatically after age/activity.

## Implementation sketch

A single helper so every route reads the same:

```ts
// lib/rateLimit.ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const limiters = {
  signinEmail: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(3, '15 m'),
    prefix: 'rl:signin:email',
  }),
  upload: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(20, '10 m'),
    prefix: 'rl:upload',
  }),
  // ...one per row above
};

/** Returns a 429 NextResponse if over limit, else null. */
export async function enforce(name: keyof typeof limiters, key: string) {
  const { success, reset } = await limiters[name].limit(key);
  if (success) return null;
  return NextResponse.json(
    { success: false, error: 'Too many requests. Please slow down.' },
    { status: 429, headers: { 'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)) } }
  );
}
```

Usage in a route:

```ts
const limited = await enforce('upload', session.user.id);
if (limited) return limited;
```

Sign-in is special — it's inside NextAuth's email provider, so the check goes in `sendVerificationRequest` (throw to abort the send) keyed on both the email and the request IP.

**Graceful degradation:** if Upstash is unreachable, `enforce` should _fail open_ for user-facing reads (don't lock people out on an infra blip) but _fail closed_ for the email-send path (never let a bomb through because Redis hiccuped). Make that per-limiter policy explicit.

## Testing

- Unit: a fake limiter store → assert `enforce` returns 429 with `Retry-After` past the threshold, null under it, and the fail-open/fail-closed branches.
- API: hit a limited route N+1 times with a mocked store and assert the last call 429s and the handler's side effect didn't run.
- Keep real Upstash out of tests — inject the limiter or mock `@upstash/ratelimit`.

## Rollout order

1. **Sign-in email limit + Turnstile** — highest impact (cost + victim protection), smallest surface.
2. **Upload + paste-a-link** — direct cost.
3. **Invite / follow / booking per-target caps + notification coalescing** — anti-spam for other users.
4. **Search / lookup / username** — anti-scraping.
5. **Vercel WAF coarse per-IP ceiling** — one-time infra config, independent of the above.
