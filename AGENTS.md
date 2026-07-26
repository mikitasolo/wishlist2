# AGENTS.md

Working instructions for AI agents (and humans) contributing to this repo. Keep this file current when conventions change.

## Project

A wishlist app: **Next.js 16 (App Router), React 19, TypeScript, MongoDB/Mongoose, NextAuth v5 / Auth.js (database sessions), Tailwind v4, Vercel Blob**. Package manager is **npm**. Path alias `@/*` maps to the repo root. (Note: `README.md` is partly out of date on versions — trust the code and `package.json`.)

## Commands

```bash
npm install          # install deps (use `npm ci` in CI)
npm run dev          # local dev server
npm run build        # production build — must pass before done
npx tsc --noEmit     # typecheck — must pass before done
npm test             # run the full Vitest suite (unit + component + API)
npm run test:e2e     # Playwright end-to-end suite
npm run test:watch   # watch mode
npm run test:cov     # coverage report
npm run format       # prettier
npm run release:preview  # list commits remote staging is ahead of remote main (dry run)
npm run release          # promote: fast-forward remote main to remote staging (no local push)
```

## Branching & releases

- **Work on `staging`** (the default branch). CI runs on every push to `staging` and `main`.
- **`main` is production** (Vercel deploys on push). `main` is only ever advanced by **fast-forwarding to `staging`** — never commit directly to `main`, never squash/merge-commit into it. This keeps `main` a strict prefix of `staging` (identical hashes, no divergence).
- **To release:** push `staging` yourself when a chunk is ready, verify CI is green and the Vercel staging deploy looks good, then `npm run release`. It fast-forwards **remote** `main` to **remote** `staging` (via `git push origin origin/staging:main`) — it does **not** push your local branch, so unreleased WIP commits on your local `staging` stay local. No PR/merge-button — those mint new commits and diverge the two branches.

## Testing policy (required)

**Add or update tests for every change that touches logic — no exceptions for "small" fixes.** The booking flow, currency conversion, privacy gating, and invite/gift lifecycle are exactly the kinds of things that broke before and must stay covered.

- **New pure logic** (`lib/utils/**`, Zod schemas in `lib/validations.ts`) → a unit test.
- **New/changed interactive component behavior** (conditional rendering, state, optimistic updates) → a component test. Skip purely presentational markup.
- **New/changed API route with authorization or business rules** → an API test (in-memory Mongo + mocked session).
- **Every bug you fix** → a regression test tagged with a `// regression:` comment citing the cause, so it can't silently come back.
- Before considering work done: `npm test` **and** `npx tsc --noEmit` **and** `npm run build` all pass.

Chase meaningful coverage of logic/authorization, not a headline line-coverage number.

### Test layout & harness

- `test/unit/**` — pure functions and schemas (node env, no DB).
- `test/components/**` — React Testing Library; **add `// @vitest-environment jsdom`** as the first line.
- `test/api/**` — route handlers against a real in-memory MongoDB. Pattern:
  - `vi.mock('@/lib/mongodb', ...)` → no-op `connectDB` (the shared mongoose connection from `test/db.ts` backs the models).
  - `vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))`, then `const session = vi.mocked(auth)` to control the session (NextAuth v5 — routes call `auth()`, not `getServerSession`).
  - Mock `@/lib/email` / `@/lib/utils/currencyRates` when a route would otherwise send mail or hit the rates API.
  - `connectTestDB` / `disconnectTestDB` / `clearTestDB` from `test/db.ts` in `beforeAll` / `afterAll` / `beforeEach`.
- Vitest config injects dummy env vars (see `vitest.config.ts`) so import-time env reads don't throw. Vitest only picks up `test/**/*.test.{ts,tsx}`; Playwright specs live in `e2e/**`.
- `e2e/**` — Playwright (`npm run test:e2e`). `e2e/global-setup.ts` starts an ephemeral MongoDB, seeds a user + a database session (writing a `authjs.session-token` storageState so the `authed` project is logged in without magic-link), then builds and starts the app; `global-teardown` stops both. Specs are `*.public.spec.ts` (signed-out) or `*.authed.spec.ts` (signed-in). Keep E2E to a few resilient smoke tests per flow — unit/component/API tests carry the detailed coverage.

## Domain invariants — do not regress

These are correctness/privacy rules the product depends on:

- **Owners never see booking status.** For the wishlist owner, `booked` folds into `available`; never reveal who booked what.
- **Never expose user emails to other users.** Invite/notification emails are used server-side only.
- **Invites are registered-users-only** (by username). There is no email-invite path; invites match `invitedUser`.
- **Proposals are anonymous to the owner.** Owners/admins never see who proposed an item (`proposedBy` is hidden in the items API), and this extends to notifications: the `proposal` notification carries `actorUsername: null` and renders as "Someone proposed…". Never surface the proposer to the owner anywhere.
- **Gifting is decoupled from the live item.** Booking creates a durable `Reservation` (survives owner status changes and leave/kick). Marking a gift writes a permanent `GiftLog` and deletes the reservation but **does not modify the owner's item**. Owner status changes (`complete`/`draft`/reopen) clear `bookedBy` but must **not** delete reservations.
- **Editing an item never changes its status.** Status changes are explicit actions (publish / move-to-draft); a content edit must not clobber a booking.
- **Archived wishlists are owner-only** — 404 for everyone else, including direct links.
- **`profileVisibility: 'friends'`** hides the bio and the browsable wishlist list from non-friends, but keeps username/avatar public. Per-wishlist visibility is a separate axis and is never bulk-mutated as a side effect.

## Conventions

- **Money** is stored as integer **cents**; currency codes are **lowercase** in the DB. Conversion routes through USD (`rate` = units per USD). Use the shared helpers in `lib/utils/currency.ts` / `currencyRates.ts`.
- Prefer the shared `Select`, `ConfirmDialog`, `BaseModal`, `Skeleton` components over bespoke ones. When a page's layout changes, **update its skeleton to match**.
- Async UI mutations should be **optimistic** and resilient to the 5s polling on the wishlist page (see `handleUpdateItem`): update locally, merge the server response for the single item, and don't let a stale in-flight poll overwrite fresher local state.
- TypeScript is `strict`. Keep it green.
- **Uploads are sanitized and owned.** Every image is re-encoded with `sharp` on upload (`app/api/upload`), which strips EXIF/metadata and bakes in orientation. Blobs live under `uploads/<userId>/` and count against a per-user quota. When an image field (`Item.imageUrl`, `User.image`, `Wishlist.bannerUrl`) is replaced or its record deleted, free the old blob with the helpers in `lib/utils/blob.ts` — but **only ever delete our own blobs** (`isOwnBlob`); a user-pasted external image URL must never be deleted.
- **Never push to a remote unless the user explicitly asks.** Committing is fine when the user requests it, but `git push` is always gated on an explicit request — never push as a side effect of finishing work, even after committing.
- **The `overrides` in `package.json` keep `npm audit` clean** by forcing patched transitive deps across the whole tree. Don't remove any without re-running `npm audit`:
  - `nodemailer`, `postcss`, `sharp` — past `next-auth`'s peer cap on nodemailer and over Next's bundled postcss/sharp. Drop the `nodemailer` override once `next-auth` widens its peer to `^9` (then we're back in supported range).
  - `brace-expansion` → `5.0.8` **and** `minimatch` → `^10.2.5` (paired) — for GHSA-mh99-v99m-4gvg, a **dev-only** DoS advisory reaching us via eslint + `@vitest/coverage-v8`. `5.0.8` is the only version that clears the advisory, but it exports a _named_ `expand` that old `minimatch` (≤9, `require('brace-expansion')()`) can't call — so `minimatch` must be forced to 10 alongside it. Drop both once eslint/vitest upstream ship minimatch 10 themselves.
- **Rate limiting goes through `enforce()` / `checkRateLimit()` in `lib/rateLimit.ts`** — never hand-roll an in-memory counter (Vercel's per-request instances don't share it). Add a new surface by adding a `SPECS` entry (tokens/window/policy) and calling `enforce('<name>', key)` right after the auth/access check, returning its response if non-null. Key **authed** writes on `session.user.id`; key **public** reads on `` `ip:${clientIp(request.headers)}` ``; key the sign-in email path on **both** email and IP. Choose `fail-open` for user-facing reads/writes and `fail-closed` for cost-bearing email sends. Limiting is **disabled** when `UPSTASH_REDIS_REST_URL`/`_TOKEN` are unset (dev/CI/tests) — tests inject a fake via `__setRateLimiters`, they don't need Redis.
- **Never print, commit, or expose secrets** (`.env`, `.env.prod`). Only perform authorized DB operations.

## Keep docs current

When a change affects how the project is set up, run, or structured, update the docs in the **same** change — stale docs are worse than none:

- New/changed/removed **env var** → update `README.md` and `.env.example`.
- New/removed **npm script**, dependency, or tech-stack change → update `README.md`.
- New user-facing **feature** or removed one → update the README feature list.
- New **convention, invariant, or workflow** for contributors → update this `AGENTS.md`.
