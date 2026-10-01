# 🎁 Wishlist

A modern wishlist app: create wishlists, share them, follow friends, and quietly reserve gifts for each other. Built with Next.js 16, React 19, TypeScript, and MongoDB.

## ✨ Features

- **Multiple wishlists per user**, each with its own cover image, currency, and human-readable slug.
- **Co-ownership** — a wishlist can have several equal owners (a family list appears on each of their profiles, and each can pin it to their own dashboard). Ownership is only ever granted with the new owner's consent; accepting it releases the bookings they held on that list, since owners can never see booking status.
- **Visibility tiers** per wishlist: `everyone`, `friends` (mutual followers of any owner), or `private`. Archived wishlists are visible to owners only.
- **Follows & friends** — follow people; a mutual follow makes you "friends", which unlocks friends-only content.
- **Booking without spoilers** — friends reserve items to gift; the owner never sees what's been booked on their own list.
- **Reservations & gift history** — a durable record of what you're giving, decoupled from the owner's item (see [AGENTS.md](AGENTS.md) for the invariants).
- **Invitations** to a wishlist as an owner or a member, registered-users-only, with accept/decline.
- **Most wanted** — owners can mark the items they want most. Everyone sees a star on them, and a list sorts them first unless you pick another sort.
- **Item proposals** — members can propose items for the owners to approve.
- **Multi-currency** prices with live conversion to any currency you pick.
- **Profiles** with avatar, bio, follower/following counts, and privacy controls.
- **Magic-link sign-in** (no passwords), image uploads, responsive Apple-inspired UI, light/dark themes.
- **Rich link previews** — dynamic Open Graph / Twitter images for shared wishlist and profile links (privacy-aware: private/archived lists and friends-only bios never leak into a preview).
- **Notification center** — an in-app feed (with a header bell + unread badge) for follows, wishlist invitations, accepted invites, and item-proposal activity. Proposal notifications are anonymous to the owner.

## 🛠️ Tech stack

- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **Database**: MongoDB with Mongoose
- **Auth**: NextAuth v5 / Auth.js (`next-auth@5`) with the MongoDB adapter — **database sessions**, magic-link email (Nodemailer provider)
- **Email**: SMTP via Nodemailer (works with Brevo, Postmark, Gmail, etc.), or printed to the server log in local dev (`EMAIL_TRANSPORT=console`)
- **Image uploads**: Vercel Blob
- **Rate limiting**: Upstash Redis (`@upstash/ratelimit`) — optional; disabled when unconfigured
- **Styling**: Tailwind CSS v4
- **Testing**: Vitest + Testing Library + `mongodb-memory-server`, Playwright for E2E
- **Deployment**: Vercel

## 📋 Prerequisites

- Node.js 24 (the runtime we build and deploy on; pinned via `package.json`'s `engines` field)
- **npm** — the package manager (bundled with Node.js)
- A MongoDB database (MongoDB Atlas recommended)
- An SMTP provider for sending magic-link emails (not needed for local dev: see `EMAIL_TRANSPORT=console` below)
- A Vercel Blob store (for image uploads)

## 🚀 Local setup

```bash
git clone <your-repo-url>
cd wishlist2
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

You don't need an SMTP account to run locally: set `EMAIL_TRANSPORT=console` in `.env.local` (the `SMTP_*` variables can then stay empty) and every email the app would send, the magic link included, is printed to the terminal running `npm run dev` instead. Nothing is sent.

Open [http://localhost:3000](http://localhost:3000). Sign in from `/auth/signin` with your email, then click the magic link in the email, or, in console mode, copy the link from the terminal into your browser. On first sign-in an account (with an auto-generated username) is created — there is no separate admin/seed step. Each wishlist has owners (any number, all equal) and members.

## 🔑 Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable                   | Required | Description                                                                   |
| -------------------------- | -------- | ----------------------------------------------------------------------------- |
| `MONGODB_URI`              | yes      | Connection string **including the database name** in the path                 |
| `NEXTAUTH_SECRET`          | yes      | Session secret — generate with `openssl rand -base64 32`                      |
| `NEXTAUTH_URL`             | yes\*    | App URL (e.g. `http://localhost:3000`). \*Derived from `VERCEL_URL` on Vercel |
| `EMAIL_TRANSPORT`          | no       | `smtp` (default) sends mail; `console` prints it to the server log. See below |
| `SMTP_HOST`                | yes\*\*  | SMTP server host                                                              |
| `SMTP_PORT`                | yes\*\*  | SMTP port (e.g. `587`)                                                        |
| `SMTP_SECURE`              | yes\*\*  | `true` for port 465, otherwise `false`                                        |
| `SMTP_USER`                | yes\*\*  | SMTP username                                                                 |
| `SMTP_PASSWORD`            | yes\*\*  | SMTP password                                                                 |
| `EMAIL_FROM`               | yes      | From address for outgoing mail                                                |
| `MIGRATION_SECRET`         | yes      | Shared secret guarding migration endpoints                                    |
| `BLOB_READ_WRITE_TOKEN`    | yes      | Vercel Blob token for uploads. Its store ID says which blob URLs are ours     |
| `UPSTASH_REDIS_REST_URL`   | no       | Upstash Redis REST URL for rate limiting. Unset ⇒ rate limiting disabled      |
| `UPSTASH_REDIS_REST_TOKEN` | no       | Upstash Redis REST token (set together with the URL)                          |

\*\*Only when `EMAIL_TRANSPORT` is `smtp` (the default). With `EMAIL_TRANSPORT=console` no email is sent: each one is printed to the server log (recipient, subject and its link, e.g. the magic link), so the `SMTP_*` variables are optional. It's meant for local dev and the Vercel Development environment. It's refused in production (`VERCEL_ENV=production`): env validation throws, which fails the build and every request, so a misconfigured deploy can't silently drop sign-in emails. Any other value is an error. Rate limits apply in both modes, since the sign-in limiter runs before the email goes anywhere.

`KV_REST_API_URL` / `KV_REST_API_TOKEN` (the names the Vercel Marketplace integration injects) are accepted as fallbacks for the two Upstash variables — so a `.env` pulled with `npm run vercel:env` turns rate limiting **on** against that store.

> ⚠️ Never commit real secrets. `.env*` is gitignored; only the placeholder `.env.example` is tracked.

## 📜 Scripts

```bash
npm run dev          # dev server
npm run build        # production build
npm start            # run the production build
npm run lint         # eslint (flat config)
npm test             # full Vitest suite (unit + component + API)
npm run test:e2e     # Playwright end-to-end suite
npm run test:watch   # tests in watch mode
npm run test:cov     # tests + the coverage floor (what CI runs)
npm run format       # prettier --write
npm run format:check # prettier --check (what CI runs)
npm run vercel:env   # pull Vercel env vars into .env
npm run release:preview  # list commits staging is ahead of main (dry run)
npm run release          # fast-forward remote main to remote staging (operator only)
```

## 🗂️ Development workflow

Tasks live in [Linear](https://linear.app/mikitasolo) (team **Wishlist**, issue keys `WIS-…`). Each issue is worked in its own [Conductor](https://conductor.build) workspace — a git worktree and branch cut from `staging` — usually by an AI agent, and lands as a pull request into `staging` that gets squash-merged. `main` is production and only ever fast-forwards to `staging` via `npm run release`. The full lifecycle, status meanings, and PR conventions are in [AGENTS.md](AGENTS.md).

## 🧪 Testing

Tests live in `test/` and run on Vitest:

- `test/unit/**` — pure logic and Zod schemas (currency, slugs, filters, validation, …)
- `test/components/**` — React Testing Library (jsdom)
- `test/api/**` — route handlers against an in-memory MongoDB with a mocked session
- `e2e/**` — Playwright end-to-end smoke tests (`npm run test:e2e`). `global-setup` boots an ephemeral MongoDB, seeds a signed-in user (owner of one list, member of another), builds and starts the app — no external services needed. Public and signed-in flows run as separate projects.

**Every change that touches logic should add or update tests, and every bug fix should add a regression test.** See [AGENTS.md](AGENTS.md) for the full policy, the API-test harness pattern, and the domain invariants that must not regress.

CI runs on every push to `main` and `staging` and on every pull request: `.github/workflows/ci.yml` does lint, format check, typecheck, the full Vitest suite with coverage (`npm run test:cov`), and a production build; `.github/workflows/e2e.yml` runs the Playwright suite (kept separate since it downloads a browser and builds the app). The coverage run enforces a non-regression floor configured in `vitest.config.ts`, so a change that drops coverage below it fails CI — run `npm run test:cov` locally to check before pushing.

A push to `main` is a release, so `.github/workflows/release-notify.yml` also posts the changelog to a Telegram channel — grouped by conventional-commit prefix, which is why PR titles (the squash-commit subjects) need to read as release notes (see [AGENTS.md](AGENTS.md)) — and moves the released Linear issues from **On Staging** to **Done**. It needs three **repo secrets** (not app env vars): `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` for the announcement, `LINEAR_API_KEY` for the status update. With them unset each job prints a preview and changes nothing. Preview locally without secrets:

```bash
BEFORE=$(git rev-parse HEAD~3) AFTER=$(git rev-parse HEAD) REPO=owner/repo \
  python3 .github/scripts/telegram-release-notes.py
BEFORE=$(git rev-parse HEAD~3) AFTER=$(git rev-parse HEAD) \
  python3 .github/scripts/linear-mark-released.py
```

## 🗄️ Data migrations

Schema migrations are one-off POST endpoints under `app/api/migrations/<name>`, guarded by the
`MIGRATION_SECRET` header and written to be idempotent:

```bash
curl -X POST -H "X-Migration-Secret: $MIGRATION_SECRET" \
  https://<your-host>/api/migrations/<name>
```

None are currently in the tree. These have been applied to every environment and removed; recover any
of them from git history if you ever need to replay one against a restored backup:

- the co-ownership set: `wishlist-owners`, `remove-admin-role`, `drop-legacy-owner-fields`;
- `dedupe-pending-invites`, which deduped pending invites and built the unique pending-invite index.

See [AGENTS.md](AGENTS.md) for the rules a new migration should follow.

## 📁 Project structure

```
app/            # App Router pages + API routes (app/api/**)
components/     # React components (WishlistItem, ItemForm, Select, Skeleton, …)
lib/            # auth, mongodb, email, env, validations, hooks, utils/**
models/         # Mongoose models (User, Wishlist, Item, WishlistMember, WishlistInvite,
                #   Reservation, GiftLog, Follow, Notification, CurrencyRate)
test/           # Vitest unit / component / api suites + helpers
e2e/            # Playwright smoke tests + global setup/teardown
types/          # shared TS types
docs/           # brand assets and their generators
.conductor/     # Conductor workspace setup/run scripts and agent prompts
```

## 🔐 Security & privacy notes

- Owner-facing views never reveal booking status (booked folds into available) — for every co-owner, not just the creator.
- Nobody can change their own role, and only an owner can grant or revoke ownership. Ownership is never applied without the recipient accepting, since it puts the list on their public profile.
- Owners can't see bookings, so being made an owner releases whatever that person had reserved — a booking is never left in a state only they could cancel but can no longer see. Owners are never told how many were released.
- User emails are never exposed to other users; invitations target registered accounts by username.
- Archived wishlists 404 for everyone except the owners, even by direct link.
- `friends`-only profile visibility hides the bio and the browsable wishlist list from non-friends while keeping the profile discoverable.
- Security headers (CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS) are set for every route in `next.config.js`.
- Migration endpoints compare their secret in constant time (`crypto.timingSafeEqual`) to avoid a timing side-channel.
- **Rate limiting** (`lib/rateLimit.ts`) guards abuse-prone surfaces — magic-link sign-in (keyed on both email and IP), uploads, invites, follows, content creation, booking toggles, username checks, and public search/profile lookups. It uses Upstash Redis (`@upstash/ratelimit`), so counters are shared across Vercel's ephemeral function instances. When Upstash isn't configured, limiting is **disabled** (dev/CI); when configured but the store errors or doesn't answer within `STORE_TIMEOUT_MS` (2 s), it fails **open** for reads/writes but **closed** for the sign-in email path. Each limiter that turns a request away logs one JSON line, `{"event":"rate_limited","name":"<limiter>","keyKind":"user|ip|email"}` (a Redis error or timeout logs `rate_limit_store_error` instead), so Vercel's logs show which surfaces actually hit their limits. The key itself (an email, IP or user id) is never logged. Upstash's own `analytics` option stays off, because it stores those raw keys in Redis. Turn rate limiting on by adding an Upstash Redis store via the Vercel Marketplace integration and setting the two env vars above. Deferred hardening (Cloudflare Turnstile on sign-in, a Vercel WAF per-IP edge ceiling, per-target caps, notification coalescing, new-account friction) is tracked in the Linear project [Rate-limit hardening](https://linear.app/mikitasolo/project/rate-limit-hardening-5ddda788ac4f).
  - **Block counters.** Vercel keeps runtime logs only briefly (about an hour on Hobby, a day on Pro), so each block is also counted in the same Redis store, once the response has gone out: `rl:stats:<env>:<limiter>:<YYYY-MM-DD>`, per UTC day, where `env` is `VERCEL_ENV` (`local` when unset), so dev and preview blocks never mix with production's. That's one extra Upstash request per _blocked_ request (an `INCR` + `EXPIRE` pipeline) and none for allowed ones. Each day's counter expires about 60 days after its last block. The counter key holds only the limiter's name, never its key. A failed or timed-out increment doesn't affect the response; it logs `rate_limit_store_error` with `"op":"count"` in place of `policy`.
  - **Reading them**: open the store in the Upstash console and filter the **Data Browser** by `rl:stats:production:*`. Each key's value is that surface's block count for that day. In the console's **CLI** tab, `SCAN 0 MATCH rl:stats:production:* COUNT 1000` lists the keys (repeat with the returned cursor until it comes back `0`), and `MGET <keys…>` reads their counts.

## 📄 License

MIT — use freely for personal or commercial projects.

---

**Happy wishing! 🎁✨**
