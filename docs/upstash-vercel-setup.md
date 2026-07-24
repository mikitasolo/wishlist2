# Enabling rate limiting — Upstash Redis via Vercel

The app's rate limiter (`lib/rateLimit.ts`) is **disabled until a Redis store is configured**. Vercel has a native Upstash integration in its Marketplace, so this is a few clicks — no separate Upstash billing account needed (billing rolls up through Vercel).

Until you finish this, the app runs fine but every limit is a no-op, and functions log a one-time warning: `[rateLimit] No Redis credentials … rate limiting is DISABLED`.

---

## 1. Create the database

1. Vercel dashboard → **your project → `Storage` tab → `Create Database`.**
2. Under **Marketplace Database Providers**, pick **Upstash → Redis**. (Accept the connect/authorize prompt the first time.)
3. Configure:
   - **Primary Region:** **Frankfurt (`eu-central-1`)** — the closest EU region to our Stockholm functions/DB (Upstash doesn't offer Stockholm). ~20 ms away, one round-trip per rate-limited request — fine. For EU-first, do **not** leave it on a US default. See [latency-audit.md](latency-audit.md) for the full topology.
   - **Eviction / plan:** the free tier is plenty for this app. Leave eviction off (rate-limit keys expire on their own TTL).
   - Optionally a "Global" database if you later want multi-region reads — not needed now.
4. Create it, then **connect it to this project** and select the environments: **Production, Preview, and Development.**

## 2. Environment variables (automatic)

Connecting the store **injects the credentials into the project automatically** — you don't paste anything. Depending on the connector you'll get either:

- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, or
- `KV_REST_API_URL` + `KV_REST_API_TOKEN`

**Both naming schemes work** — `lib/rateLimit.ts` reads either (`redisCreds()`), so there's nothing to rename. Verify they appear under **Project → Settings → Environment Variables**.

## 3. Redeploy

Env vars are bound at build/deploy time. **Trigger a redeploy** (or push a commit) so the running functions pick up the new variables. Existing deployments won't see them until redeployed.

## 4. Local development (optional)

Rate limiting doesn't need to run locally, but to test it:

```bash
pnpm vercel:env      # = `vercel env pull .env` — pulls the linked project's env, including the Redis creds
```

…then restart `pnpm dev`. (Alternatively, copy the REST URL/token from the Upstash console into `.env.local`.) Without these, local limiting stays disabled — which is the intended default for dev.

## 5. Verify it's live

- **Logs:** after redeploy, the `… rate limiting is DISABLED` warning should **no longer** appear.
- **Behavior:** exceed a limit and confirm a `429` with a `Retry-After` header. Easiest target is the sign-in email limit (3 sends / 15 min per email): request magic links for the same address repeatedly — the 4th should be refused.
- **Upstash console → Data Browser / Metrics:** you'll see keys like `rl:signinEmail:*`, `rl:search:*` and a command count ticking up.

## 6. Tuning the limits

Limits live in one place — the `SPECS` map in `lib/rateLimit.ts` (tokens / window / fail-open|closed). They're deliberately conservative starting points; adjust from real traffic once you can see Upstash metrics and Vercel logs. Add a new limited surface by adding a `SPECS` entry and calling `enforce('<name>', key)` in the route (see the convention note in `AGENTS.md`).

---

### Notes

- **Cost/abuse safety:** the sign-in email path is **fail-closed** — if Redis is unreachable, sign-in sends are blocked rather than risking an email bomb. All other limiters are **fail-open** so an Upstash blip never locks users out of normal use.
- **Not configured ≠ broken:** with no creds, the app behaves exactly as before this feature — everything allowed. So it's safe to ship the code before provisioning, and safe to leave unprovisioned in a throwaway environment.
