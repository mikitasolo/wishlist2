# 🎁 Wishlist

A modern wishlist app: create wishlists, share them, follow friends, and quietly reserve gifts for each other. Built with Next.js 16, React 19, TypeScript, and MongoDB.

## ✨ Features

- **Multiple wishlists per user**, each with its own cover image, currency, and human-readable slug.
- **Co-ownership** — a wishlist can have several equal owners (a family list appears on each of their profiles, and each can pin it to their own dashboard). Ownership is only ever granted with the new owner's consent; accepting it releases the bookings they held on that list, since owners can never see booking status. A list always keeps at least one owner: Leave on the sole owner's own row in Manage explains that they need to invite a co-owner first (and takes them to an owner invite) or delete the list.
- **Visibility tiers** per wishlist: `everyone`, `friends` (mutual followers of any owner), or `private`. Archived wishlists are visible to owners only.
- **Follows & friends** — follow people; a mutual follow makes you "friends", which unlocks friends-only content.
- **Search** — one search for people and wishlists, in the header and on the signed-out landing page. A handle typed as it's shown (`@alice`) finds the person, while list names match as typed. It only returns lists you could open, including your friends' friends-only lists and private lists you belong to, and it puts the closest matches first: an exact username, then friends, people you follow and your followers; your own and shared lists, then friends' lists.
- **Booking without spoilers** — friends reserve items to gift; the owner never sees what's been booked on their own list.
- **Reservations & gift history** — a durable record of what you're giving, decoupled from the owner's item (see [AGENTS.md](AGENTS.md) for the invariants). The gifts you still have to give are grouped by their list's upcoming occasion, the nearest first, with the rest under "No date"; a list you can no longer see shows no date.
- **Invitations** to a wishlist as an owner or a member, registered-users-only, with accept/decline.
- **Most wanted** — owners can mark the items they want most. Everyone sees a star on them, and a list sorts them first unless you pick another sort.
- **Item proposals** — members can propose items for the owners to approve.
- **Occasions** — an owner can give a list one occasion (a birthday, holiday, wedding or other) in the list's settings: a date for a one-off, or just a day and month for one that repeats every year, which keeps no year at all. Everyone who can see the list sees it next to the list's name and on the list's card with a countdown ("Birthday · in 12 days"), counted from their own local date. Your own lists (the dashboard and Your wishlists) show the ones with an occasion coming up first, nearest first. It only labels and orders the list: it never changes who can see it.
- **Save to my list** — see something you want too on a list you can view? Save a copy of it to one of your own wishlists (or copy between your own lists), editable before it's saved. The copy is independent and gets its own copy of the image; the list it came from isn't told, and its notes and bookings never come across.
- **Multi-currency** prices with live conversion to any currency you pick. Accounts start on USD, and the dashboard offers anyone still on it, once, the local currency instead ("Show prices in PLN?"), which the browser works out from its time zone, then its language's region, with no IP lookup. Use it or choose another in Settings: either way it isn't offered again.
- **Profiles** with avatar, bio, follower/following counts, and privacy controls.
- **Magic-link sign-in** (no passwords), behind an optional, usually invisible Cloudflare Turnstile bot check; image uploads, responsive Apple-inspired UI, light/dark themes.
- **A private handle from the start** — a new account gets a random username (`user_…`), never one taken from the email, and its first sign-in opens a welcome step offering to pick one of its own. It's skippable, and either way it continues to wherever the sign-in was headed (an invite, a list).
- **Rich link previews** — a shared wishlist or profile link shows its own card in messengers and social networks (Telegram, WhatsApp, iMessage, Viber, Facebook, X, Slack…): a public list's name, owner, item count and cover photo, or a profile's avatar, username and bio. Privacy-aware: friends-only, private and archived lists get a generic card that looks just like a missing list's, and friends-only bios never show. Cards are cached on Vercel's CDN for a day and dropped as soon as anything on them changes.
- **Notification center** — an in-app feed (with a header bell + unread badge) for follows, wishlist invitations, accepted invites, item-proposal activity, and being demoted from owner to member of a list or removed from one. Answering an invitation marks its notification read and turns it into your answer ("You joined …" / "You declined the invite to …"). Proposal notifications are anonymous to the owner, and demotions and removals never say which owner made them.

## 🛠️ Tech stack

- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **Database**: MongoDB with Mongoose
- **Auth**: NextAuth v5 / Auth.js (`next-auth@5`) with the MongoDB adapter — **database sessions**, magic-link email (Nodemailer provider)
- **Email**: SMTP via Nodemailer (works with Brevo, Postmark, Gmail, etc.), or printed to the server log in local dev (`EMAIL_TRANSPORT=console`)
- **Image uploads**: Vercel Blob
- **Link previews**: `next/og` share cards in bundled Geist fonts, cached on Vercel's CDN and purged by tag (`@vercel/functions`)
- **Rate limiting**: Upstash Redis (`@upstash/ratelimit`) — optional; disabled when unconfigured
- **Bot protection**: Cloudflare Turnstile on the sign-in form (Cloudflare's script, no npm dependency) — optional; off when unconfigured
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

Open [http://localhost:3000](http://localhost:3000). Sign in from `/auth/signin` with your email, then click the magic link in the email, or, in console mode, copy the link from the terminal into your browser. On first sign-in an account is created with a random username (`user_…`), and you land on `/welcome`, which offers to pick your own — there is no separate admin/seed step. Each wishlist has owners (any number, all equal) and members.

## 🔑 Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable                         | Required | Description                                                                          |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `MONGODB_URI`                    | yes      | Connection string **including the database name** in the path                        |
| `NEXTAUTH_SECRET`                | yes      | Session secret — generate with `openssl rand -base64 32`                             |
| `NEXTAUTH_URL`                   | yes\*    | App URL (e.g. `http://localhost:3000`). \*Derived from `VERCEL_URL` on Vercel        |
| `EMAIL_TRANSPORT`                | no       | `smtp` (default) or `console` (logs mail; local/Development only). See below         |
| `SMTP_HOST`                      | yes\*\*  | SMTP server host                                                                     |
| `SMTP_PORT`                      | yes\*\*  | SMTP port (e.g. `587`)                                                               |
| `SMTP_SECURE`                    | yes\*\*  | `true` for port 465, otherwise `false`                                               |
| `SMTP_USER`                      | yes\*\*  | SMTP username                                                                        |
| `SMTP_PASSWORD`                  | yes\*\*  | SMTP password                                                                        |
| `EMAIL_FROM`                     | yes      | From address for outgoing mail                                                       |
| `MIGRATION_SECRET`               | yes      | Shared secret guarding migration endpoints                                           |
| `BLOB_READ_WRITE_TOKEN`          | yes      | Vercel Blob token for uploads. Its store ID says which blob URLs are ours            |
| `UPSTASH_REDIS_REST_URL`         | no       | Upstash Redis REST URL for rate limiting. Unset ⇒ rate limiting disabled             |
| `UPSTASH_REDIS_REST_TOKEN`       | no       | Upstash Redis REST token (set together with the URL)                                 |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | no       | Cloudflare Turnstile site key for the sign-in form. Unset ⇒ Turnstile off. See below |
| `TURNSTILE_SECRET_KEY`           | no       | Cloudflare Turnstile secret key (set together with the site key)                     |

\*\*Only when `EMAIL_TRANSPORT` is `smtp` (the default). With `EMAIL_TRANSPORT=console` no email is sent: each one is printed to the server log (recipient, subject and its link, e.g. the magic link), so the `SMTP_*` variables are optional. It's meant for local dev, CI and E2E (`VERCEL_ENV` unset) and the Vercel Development environment (`VERCEL_ENV=development`), and refused with any other `VERCEL_ENV`, Preview and Production included: env validation throws, which fails the build and every request, so a misconfigured Vercel deploy can neither silently drop sign-in emails nor print working magic links into its runtime logs. The check keys on `VERCEL_ENV`, so it guards Vercel deployments only. Any other `EMAIL_TRANSPORT` value is an error. Rate limits apply in both modes, since the sign-in limiter runs before the email goes anywhere.

`KV_REST_API_URL` / `KV_REST_API_TOKEN` (the names the Vercel Marketplace integration injects) are accepted as fallbacks for the two Upstash variables — so a `.env` pulled with `npm run vercel:env` turns rate limiting **on** against that store.

The two Turnstile keys are **all or nothing**: both set turns the sign-in bot check on, neither leaves it off (local dev, CI and E2E need no keys), and setting only one is refused by env validation, which fails the build and every request. Half a config would otherwise either refuse every sign-in (a secret but no widget to earn a token) or show a widget nothing checks. The site key is public; it's read on the server per request and handed to the form, so the widget and the check always come from the same environment. A widget only runs on the hostnames registered for it in Cloudflare, so set the keys only for environments whose hostnames are on it (e.g. Production and the staging domain). Leave them unset where they aren't, such as per-deployment preview URLs: the check would fail there and every sign-in be refused. To see the widget locally, use Cloudflare's always-pass test keys, `NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA` and `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA` (more in [Cloudflare's testing docs](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)); they load Cloudflare's real script, so they need network access.

> ⚠️ Never commit real secrets. `.env*` is gitignored; only the placeholder `.env.example` is tracked.

## 📜 Scripts

```bash
npm run dev          # dev server
npm run build        # production build
npm run check:trace  # after a build: every route that ships sharp (the upload route, share cards) also ships its native libvips, and NextAuth's route ships none
npm run smoke:deploy -- <url>  # read-only GET smoke of a deployed host: auth and upload routes start, a share card draws (no emails, no uploads)
npm run generate:email-logo  # re-render the email header's logo (lib/emailLogo.ts) from app/icon.svg; rerun when the logo changes
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
- `e2e/**` — Playwright end-to-end smoke tests (`npm run test:e2e`). `global-setup` boots an ephemeral MongoDB, seeds a signed-in user (owner of one list, member of another) and a few unused magic links for the sign-up specs, builds and starts the app — no external services needed. Public and signed-in flows run as separate projects. Specs import `test` from `e2e/fixtures.ts`, which fails any spec whose pages throw an uncaught error or log a `console.error` that isn't allowed.

**Every change that touches logic should add or update tests, and every bug fix should add a regression test.** See [AGENTS.md](AGENTS.md) for the full policy, the API-test harness pattern, and the domain invariants that must not regress.

Vercel deploys only `staging` (the staging host) and `main` (production); pull-request branches get no preview deployment (`git.deploymentEnabled` in `vercel.json`), so CI below is a PR's only check. CI runs on every push to `main` and `staging` and on every pull request: `.github/workflows/ci.yml` does lint, format check, typecheck, the full Vitest suite with coverage (`npm run test:cov`), and a production build; `.github/workflows/e2e.yml` runs the Playwright suite (kept separate since it downloads a browser and builds the app). `.github/workflows/audit.yml` runs `npm audit` daily on `staging`, on demand, and on a pull request that changes `package.json` or `package-lock.json`, and fails on a high or critical advisory in the runtime dependencies. The coverage run enforces a non-regression floor configured in `vitest.config.mts`, so a change that drops coverage below it fails CI — run `npm run test:cov` locally to check before pushing.

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
- The session (`auth()` on the server, `GET /api/auth/session` in the browser) is an explicit allowlist of the signed-in user's own fields. It never carries the session token, which the httpOnly cookie keeps away from scripts, or the rest of the user's database row.
- Archived wishlists 404 for everyone except the owners, even by direct link.
- `friends`-only profile visibility hides the bio and the browsable wishlist list from non-friends (on the profile and in search) while keeping the profile discoverable.
- Search returns only the lists the searcher could open. It matches with `viewableWishlistsFilter`, the query form of the access check every wishlist read uses, and a table test keeps the two identical.
- Security headers (CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS) are set for every route in `next.config.js`. The CSP allows one third-party origin, `https://challenges.cloudflare.com`, for scripts and frames only (Turnstile's script and its challenge iframe).
- Migration endpoints compare their secret in constant time (`crypto.timingSafeEqual`) to avoid a timing side-channel.
- **Rate limiting** (`lib/rateLimit.ts`) guards abuse-prone surfaces — magic-link sign-in (keyed on both email and IP), uploads, invites, follows, content creation, booking toggles, username checks, and public search/profile lookups. It uses Upstash Redis (`@upstash/ratelimit`), so counters are shared across Vercel's ephemeral function instances. When Upstash isn't configured, limiting is **disabled** (dev/CI); when configured but the store errors or doesn't answer within `STORE_TIMEOUT_MS` (2 s), it fails **open** for reads/writes but **closed** for the sign-in email path. Each limiter that turns a request away logs one JSON line, `{"event":"rate_limited","name":"<limiter>","keyKind":"user|ip|email"}` (a Redis error or timeout logs `rate_limit_store_error` instead), so Vercel's logs show which surfaces actually hit their limits. The key itself (an email, IP or user id) is never logged. Upstash's own `analytics` option stays off, because it stores those raw keys in Redis. Turn rate limiting on by adding an Upstash Redis store via the Vercel Marketplace integration and setting the two env vars above. Deferred hardening (a Vercel WAF per-IP edge ceiling, per-target caps, notification coalescing, new-account friction) is tracked in the Linear project [Rate-limit hardening](https://linear.app/mikitasolo/project/rate-limit-hardening-5ddda788ac4f).
  - **Block counters.** Vercel keeps runtime logs only briefly (about an hour on Hobby, a day on Pro), so each block is also counted in the same Redis store, once the response has gone out: `rl:stats:<env>:<limiter>:<YYYY-MM-DD>`, per UTC day, where `env` is `VERCEL_ENV` (`local` when unset; a `.env` pulled from Vercel sets it to `development`), so dev and preview blocks never mix with production's. Each counted block costs one extra Upstash request (an `INCR` + `EXPIRE` pipeline, billed as two commands); allowed requests cost nothing extra. Only blocks Redis answered are counted: once a key is blocked, the SDK turns away its repeat requests on that instance from an in-memory cache, at no Redis cost, and counting those would let a flood from one source use up the store's command quota. So a counter reads as "times a key hit the limit", not "requests rejected". The `rate_limited` log line still covers every block. Each day's counter expires about 60 days after its last block. The counter key holds only the limiter's name, never its key. A failed or timed-out increment doesn't affect the response; it logs `rate_limit_store_error` with `"op":"count"` in place of `policy`.
  - **Reading them**: open the store in the Upstash console and filter the **Data Browser** by `rl:stats:production:*`. Each key's value is that surface's block count for that day. In the console's **CLI** tab, `SCAN 0 MATCH rl:stats:production:* COUNT 1000` lists the keys (repeat with the returned cursor until it comes back `0`), and `MGET <keys…>` reads their counts.
- **Cloudflare Turnstile on sign-in** (`lib/turnstile.ts`, on when both keys are set). The sign-in form gets a token from Turnstile's widget (rendered `interaction-only`, so most visitors never see it), and its server action (`app/auth/signin/actions.ts`) checks the token with Cloudflare's `siteverify` before anything else happens, then calls Auth.js's server-side `signIn`. That action is the only way a magic link is sent: Auth.js's own `POST /api/auth/signin/<provider>` answers 403, and a request that didn't start in the action is refused by the `signIn` callback (when the link is requested) and by `sendVerificationRequest` (before the send). An invalid or spent token is refused ("Please complete the check"), and so is a missing one, which is still put to Cloudflare: the form sends none when Turnstile's script couldn't load or run, as in a Cloudflare outage. When Cloudflare can't give a verdict (unreachable, no answer within 3 s, a 5xx, its own `internal-error`, or a secret it rejects) sign-in fails **open**, and the per-email and per-IP limiters above, which fail closed, stay the backstop. Each such case logs one `{"event":"turnstile_unavailable","reason":"…"}` line, and each refusal a `turnstile_refused` line with Cloudflare's error codes. Neither ever carries the token, the visitor's IP or the email.

## 📄 License

MIT — use freely for personal or commercial projects.

---

**Happy wishing! 🎁✨**
