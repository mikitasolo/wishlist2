# 🎁 Wishlist

A modern wishlist app: create wishlists, share them, follow friends, and quietly reserve gifts for each other. Built with Next.js 16, React 19, TypeScript, and MongoDB.

## ✨ Features

- **Multiple wishlists per user**, each with its own cover image, currency, and human-readable slug.
- **Visibility tiers** per wishlist: `everyone`, `friends` (mutual followers), or `private`. Archived wishlists are visible to the owner only.
- **Follows & friends** — follow people; a mutual follow makes you "friends", which unlocks friends-only content.
- **Booking without spoilers** — friends reserve items to gift; the owner never sees what's been booked on their own list.
- **Reservations & gift history** — a durable record of what you're giving, decoupled from the owner's item (see [AGENTS.md](AGENTS.md) for the invariants).
- **Invitations** to co-manage a wishlist (member/admin), registered-users-only, with accept/decline.
- **Item proposals** — members can propose items for the owner to approve.
- **Multi-currency** prices with live conversion to any currency you pick.
- **Profiles** with avatar, bio, follower/following counts, and privacy controls.
- **Magic-link sign-in** (no passwords), image uploads, responsive Apple-inspired UI, light/dark themes.
- **Rich link previews** — dynamic Open Graph / Twitter images for shared wishlist and profile links (privacy-aware: private/archived lists and friends-only bios never leak into a preview).
- **Notification center** — an in-app feed (with a header bell + unread badge) for follows, wishlist invitations, accepted invites, and item-proposal activity. Proposal notifications are anonymous to the owner.

## 🛠️ Tech stack

- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **Database**: MongoDB with Mongoose
- **Auth**: NextAuth v5 / Auth.js (`next-auth@5`) with the MongoDB adapter — **database sessions**, magic-link email (Nodemailer provider)
- **Email**: SMTP via Nodemailer (works with Brevo, Postmark, Gmail, etc.)
- **Image uploads**: Vercel Blob
- **Rate limiting**: Upstash Redis (`@upstash/ratelimit`) — optional; disabled when unconfigured
- **Styling**: Tailwind CSS v4
- **Testing**: Vitest + Testing Library + `mongodb-memory-server`
- **Deployment**: Vercel

## 📋 Prerequisites

- Node.js 20+
- **pnpm** — the package manager (enable via `corepack enable`; the version is pinned in `package.json`'s `packageManager` field)
- A MongoDB database (MongoDB Atlas recommended)
- An SMTP provider for sending magic-link emails
- A Vercel Blob store (for image uploads)

## 🚀 Local setup

```bash
git clone <your-repo-url>
cd wishlist2
corepack enable              # makes the pinned pnpm available
pnpm install
cp .env.example .env.local   # then fill in the values
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in from `/auth/signin` with your email and click the magic link. On first sign-in an account (with an auto-generated username) is created — there is no separate admin/seed step; roles are per-wishlist (owner / admin / member).

## 🔑 Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable                   | Required | Description                                                                   |
| -------------------------- | -------- | ----------------------------------------------------------------------------- |
| `MONGODB_URI`              | yes      | Connection string **including the database name** in the path                 |
| `NEXTAUTH_SECRET`          | yes      | Session secret — generate with `openssl rand -base64 32`                      |
| `NEXTAUTH_URL`             | yes\*    | App URL (e.g. `http://localhost:3000`). \*Derived from `VERCEL_URL` on Vercel |
| `SMTP_HOST`                | yes      | SMTP server host                                                              |
| `SMTP_PORT`                | yes      | SMTP port (e.g. `587`)                                                        |
| `SMTP_SECURE`              | yes      | `true` for port 465, otherwise `false`                                        |
| `SMTP_USER`                | yes      | SMTP username                                                                 |
| `SMTP_PASSWORD`            | yes      | SMTP password                                                                 |
| `EMAIL_FROM`               | yes      | From address for outgoing mail                                                |
| `MIGRATION_SECRET`         | yes      | Shared secret guarding migration endpoints                                    |
| `BLOB_READ_WRITE_TOKEN`    | yes      | Vercel Blob token (read implicitly by the Blob SDK) for image uploads         |
| `UPSTASH_REDIS_REST_URL`   | no       | Upstash Redis REST URL for rate limiting. Unset ⇒ rate limiting disabled      |
| `UPSTASH_REDIS_REST_TOKEN` | no       | Upstash Redis REST token (set together with the URL)                          |

> ⚠️ Never commit real secrets. `.env*` is gitignored; only the placeholder `.env.example` is tracked.

## 📜 Scripts

```bash
pnpm dev             # dev server
pnpm build           # production build
pnpm start           # run the production build
pnpm lint            # eslint (flat config)
pnpm test            # full Vitest suite (unit + component + API)
pnpm test:e2e        # Playwright end-to-end suite
pnpm test:watch      # tests in watch mode
pnpm test:cov        # tests with coverage
pnpm format          # prettier --write
```

## 🧪 Testing

Tests live in `test/` and run on Vitest:

- `test/unit/**` — pure logic and Zod schemas (currency, slugs, filters, validation, …)
- `test/components/**` — React Testing Library (jsdom)
- `test/api/**` — route handlers against an in-memory MongoDB with a mocked session
- `e2e/**` — Playwright end-to-end smoke tests (`pnpm test:e2e`). `global-setup` boots an ephemeral MongoDB, seeds a signed-in session, builds and starts the app — no external services needed. Public and signed-in flows run as separate projects.

**Every change that touches logic should add or update tests, and every bug fix should add a regression test.** See [AGENTS.md](AGENTS.md) for the full policy, the API-test harness pattern, and the domain invariants that must not regress.

CI runs on every push to `main` and every pull request: `.github/workflows/ci.yml` does lint, typecheck, the full Vitest suite, and a production build; `.github/workflows/e2e.yml` runs the Playwright suite (kept separate since it downloads a browser and builds the app). Coverage (`pnpm test:cov`) enforces a non-regression threshold floor configured in `vitest.config.ts`.

## 📁 Project structure

```
app/            # App Router pages + API routes (app/api/**)
components/     # React components (WishlistItem, ItemForm, Select, Skeleton, …)
lib/            # auth, mongodb, email, env, validations, hooks, utils/**
models/         # Mongoose models (User, Wishlist, Item, WishlistMember,
                #   WishlistInvite, Reservation, GiftLog, Follow, Session, CurrencyRate)
test/           # Vitest unit / component / api suites + helpers
types/          # shared TS types
```

## 🔐 Security & privacy notes

- Owner-facing views never reveal booking status (booked folds into available).
- User emails are never exposed to other users; invitations target registered accounts by username.
- Archived wishlists 404 for everyone except the owner, even by direct link.
- `friends`-only profile visibility hides the bio and the browsable wishlist list from non-friends while keeping the profile discoverable.
- Security headers (CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS) are set for every route in `next.config.js`.
- Migration endpoints compare their secret in constant time (`crypto.timingSafeEqual`) to avoid a timing side-channel.
- **Rate limiting** (`lib/rateLimit.ts`) guards abuse-prone surfaces — magic-link sign-in (keyed on both email and IP), uploads, invites, follows, content creation, booking toggles, username checks, and public search/profile lookups. It uses Upstash Redis (`@upstash/ratelimit`), so counters are shared across Vercel's ephemeral function instances. When Upstash isn't configured, limiting is **disabled** (dev/CI); when configured but the store errors, it fails **open** for reads/writes but **closed** for the sign-in email path. To enable it, follow [docs/upstash-vercel-setup.md](docs/upstash-vercel-setup.md). Deferred hardening (Cloudflare Turnstile on sign-in, a Vercel WAF per-IP edge ceiling, notification coalescing, new-account friction) is tracked in [BACKLOG.md](BACKLOG.md).

## 📄 License

MIT — use freely for personal or commercial projects.

---

**Happy wishing! 🎁✨**
