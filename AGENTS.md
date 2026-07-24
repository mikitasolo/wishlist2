# AGENTS.md

Working instructions for AI agents (and humans) contributing to this repo. Keep this file current when conventions change.

## Project

A wishlist app: **Next.js 16 (App Router), React 19, TypeScript, MongoDB/Mongoose, NextAuth v5 / Auth.js (database sessions), Tailwind v4, Vercel Blob**. Path alias `@/*` maps to the repo root. (Note: `README.md` is partly out of date on versions — trust the code and `package.json`.)

## Commands

```bash
npm run dev          # local dev server
npm run build        # production build — must pass before done
npx tsc --noEmit     # typecheck — must pass before done
npm test             # run the full Vitest suite (unit + component + API)
npm run test:watch   # watch mode
npm run test:cov     # coverage report
npm run format       # prettier
```

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
- **`package.json` `overrides` keep `npm audit` clean** by forcing patched `nodemailer`, `postcss`, and `sharp` across the whole tree — past `next-auth`'s peer cap on nodemailer and over Next's bundled postcss/sharp. Don't remove them without re-running `npm audit`. If a lockfile ever fails `npm ci` with a `@emnapi/*` / sharp-wasm "not in sync" error (an npm quirk with platform-optional deps), regenerate it cleanly: `rm -rf node_modules package-lock.json && npm install` (an incremental `npm install` won't fix it).
- **Never print, commit, or expose secrets** (`.env`, `.env.prod`). Only perform authorized DB operations.

## Keep docs current

When a change affects how the project is set up, run, or structured, update the docs in the **same** change — stale docs are worse than none:

- New/changed/removed **env var** → update `README.md` and `.env.example`.
- New/removed **npm script**, dependency, or tech-stack change → update `README.md`.
- New user-facing **feature** or removed one → update the README feature list.
- New **convention, invariant, or workflow** for contributors → update this `AGENTS.md`.
