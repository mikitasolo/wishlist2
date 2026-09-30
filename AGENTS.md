# AGENTS.md

Working instructions for AI agents (and humans) contributing to this repo. Keep this file current when conventions change.

## Project

A wishlist app: **Next.js 16 (App Router), React 19, TypeScript, MongoDB/Mongoose, NextAuth v5 / Auth.js (database sessions), Tailwind v4, Vercel Blob**. Package manager is **npm**. Path alias `@/*` maps to the repo root.

## Commands

```bash
npm ci               # install deps (Conductor's setup script runs this for you)
npm run dev          # local dev server — in Conductor: npm run dev -- --port $CONDUCTOR_PORT
npm run lint         # eslint — must pass before done
npm run format:check # prettier --check — must pass before done (npm run format fixes it)
npx tsc --noEmit     # typecheck — must pass before done
npm run test:cov     # full Vitest suite (unit + component + API) + the coverage floor in vitest.config.ts — must pass before done
npm run build        # production build — must pass before done
npm run test:e2e     # Playwright end-to-end suite
npm run test:watch   # watch mode
npm test             # the same suite without coverage
npm run release:preview  # list commits remote staging is ahead of remote main (dry run)
npm run release          # promote: fast-forward remote main to remote staging — operator only
```

## How work flows

Tasks live in **Linear** — workspace `mikitasolo`, team **Wishlist**, issue keys `WIS-<n>`. Each issue is worked in its own **Conductor** workspace (a git worktree + branch cut from `staging`), usually by an AI agent. The human is the **operator**: they write and clarify requirements, review, merge, and release.

### Branches

- **`staging`** is the default and integration branch. Every change reaches it through a **pull request**, which the operator **squash-merges**. CI (`ci.yml`, `e2e.yml`) runs on every PR.
- **`main` is production** (Vercel deploys on push). It only ever moves by **fast-forwarding to `staging`** (`npm run release`, i.e. `git push origin origin/staging:main`) — never commit to `main`, never open a PR into it. This keeps `main` a strict prefix of `staging` (identical hashes, no divergence).
- **A push to `main` is a release.** `.github/workflows/release-notify.yml` posts the changelog to a Telegram channel (built from the commit subjects in the pushed range by `.github/scripts/telegram-release-notes.py`) and moves the Linear issues those commits close from **On Staging** to **Done** (`.github/scripts/linear-mark-released.py`). Secrets: `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` / `LINEAR_API_KEY`; without them each job prints a preview and changes nothing.

### Issue statuses

| Status      | Meaning                                         | Moved by                                    |
| ----------- | ----------------------------------------------- | ------------------------------------------- |
| Backlog     | Idea, or not specified well enough to build yet | operator                                    |
| Todo        | Spec is ready — an agent can take it            | operator                                    |
| In Progress | Being worked in a workspace                     | the agent, when it starts                   |
| In Review   | PR is open                                      | Linear's GitHub integration                 |
| On Staging  | Squash-merged into `staging`, not yet released  | Linear's GitHub integration                 |
| Done        | Released to production                          | `release-notify.yml`, on the push to `main` |
| Canceled    | Won't do                                        | operator                                    |

Labels: one **Type** (Feature / Bug / Improvement / Tech debt — maps to the commit prefix) and one **Area** per issue. Large features are Linear **projects**; their design notes and open questions live in the project description, so read it before starting an issue inside one.

### Agent lifecycle for an issue

1. **Read the issue** (`WIS-<n>`) through the Linear MCP server — description, comments, and the parent project's description if it has one. If the acceptance criteria are missing or ambiguous, especially anywhere near the domain invariants below, **ask the operator before writing code**. Don't guess at product decisions.
2. **Move the issue to In Progress.**
3. **Stay in your workspace branch.** Conductor created it from `staging`; don't rename it, and never check out, commit to, or push `staging` or `main`.
4. **Implement with tests** (see Testing policy). Stay in scope: an unrelated bug or idea you notice becomes a **new Linear issue in Backlog** (link it from the PR), not part of this change.
5. **Verify**: everything marked "must pass before done" under Commands passes locally, plus `npm run test:e2e` if you touched a flow the E2E smoke tests cover.
6. **Review your own diff** (`git diff origin/staging...`) as a skeptical reviewer would — correctness, the domain invariants, missing tests, leftover debug code, docs the change makes stale — and fix what you find.
7. **Commit, push your branch, and open a PR into `staging`** (`gh pr create --base staging`), following the rules below.
8. **Get CI green** (`gh pr checks --watch`) and fix failures. Branch protection isn't available on the free GitHub plan, so nothing else stops a red PR from being merged.
9. **Hand off**: reply with the PR link, what changed, how you verified it, and anything the operator has to do by hand (env vars, migrations, dashboard config).

**Operator-only** — never do these as an agent: merge a PR, run `npm run release`, run a migration against a deployed host, change env vars or secrets in Vercel/GitHub, or push to any branch other than your own.

### Pull requests & commit messages

**PR titles are published.** A PR is squash-merged, so its title becomes the commit subject on `staging`, and every subject in a release goes verbatim into the Telegram changelog. The title is release-note copy, not a note to yourself:

- **Conventional-commit prefix**, which the changelog groups by: `feat:` `fix:` `perf:` `refactor:` `docs:` `test:` `build:` `ci:` `chore:`. Anything unprefixed lands in a catch-all "Other" section — avoid it.
- **Imperative, specific subject** that stands alone. A reader in the channel sees only the subject, with no diff and no body: `fix: release a member's bookings when they're made an owner`, not `fix: bug` or `fix: address review comments`.
- **No issue ID in the title** — the channel's readers don't have Linear. Put `Closes WIS-<n>` in the **body**: that links the PR to the issue and drives its status. Use `Part of WIS-<n>` for a PR that doesn't finish the issue.
- **The body becomes the squash commit's message**, so it explains _why_, plus anything a future reader would otherwise have to reconstruct: the invariant being protected, the failure mode being closed, migrations the change requires and their ordering, how it was tested. Follow `.github/pull_request_template.md`.
- **One issue, one PR, one coherent change.** "Various fixes" is one useless changelog line covering several things worth naming. Commits inside the branch can be as granular as you like — they're squashed away — but still use the conventional prefixes.

### Parallel workspaces

Several agents run at once, each in its own worktree. Don't assume anything is exclusive to you:

- **Ports**: dev runs on `$CONDUCTOR_PORT` (the Conductor run script passes it); E2E derives its port from `CONDUCTOR_PORT` too (`playwright.config.ts`). Never hard-code 3000/3100.
- **Conflicts**: other PRs touch `README.md` / `AGENTS.md` too. When yours conflicts, rebase onto `origin/staging` and force-push **your own branch** with `--force-with-lease`; don't merge `staging` into it.
- **Local dev data**: workspaces get the repo root's `.env` / `.env.local` copied in (`.conductor/settings.toml`); `.env.prod` / `.env.staging` deliberately aren't. The dev MongoDB is shared by every workspace — don't wipe or bulk-edit it. Prefer the test suites (in-memory Mongo, mocked email) over poking the dev server.

## Testing policy (required)

**Add or update tests for every change that touches logic — no exceptions for "small" fixes.** The booking flow, currency conversion, privacy gating, and invite/gift lifecycle are exactly the kinds of things that broke before and must stay covered.

- **New pure logic** (`lib/utils/**`, Zod schemas in `lib/validations.ts`) → a unit test.
- **New/changed interactive component behavior** (conditional rendering, state, optimistic updates) → a component test. Skip purely presentational markup.
- **New/changed API route with authorization or business rules** → an API test (in-memory Mongo + mocked session).
- **Every bug you fix** → a regression test tagged with a `// regression:` comment citing the cause, so it can't silently come back.
- Before considering work done: everything marked "must pass before done" under Commands passes — the same checks CI runs.

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

- **A wishlist has exactly two kinds of people: owners and members.** There is no `admin` tier — a manager of someone else's list isn't a relationship the product needs, so anyone trusted to manage a list is a co-owner. Owners live in `Wishlist.owners[]`; members are rows in `WishlistMember`, which carries **no role field**. Membership is existence, not a level.
- **All co-owners are equal.** Identical authority (including deleting the list), the list shows on each of their profiles, and none of them ever sees booking status. Authorize owners only through `isWishlistOwner` / `ownedByFilter` / `primaryOwnerId` from `lib/utils/wishlistOwners.ts`, or `getOwnerAccess` / `isOwnerOfWishlist` from `wishlistAccess.ts` — never by hand-rolling a check on `owners[]`. A list must always keep at least one owner.
- **Members have no management powers.** They browse, propose items, and book gifts. They can't see the members list, drafts, wishlist settings, or publish an item directly. Everything else is owner-only.
- **Owners never see booking status.** For any owner, `booked` folds into `available`; never reveal who booked what.
- **Becoming an owner requires consent and releases your bookings.** The three ways in are: create the list, accept an `owner` invite (`POST /api/wishlists/[id]/members` by username), or accept a promotion (`POST /api/wishlists/[id]/owners/[userId]`, which issues the same kind of invite — never a silent role write). On accept, `addWishlistOwner` frees the items that person booked **and deletes their reservations** — an owner can't be their own gifter. This is the one place that deletes a reservation on a membership change; leave/remove deliberately keep it.
- **A booking must never be left where nobody can release it.** Only the holder can cancel a booking, and owners are booking-blind — so becoming an owner has to free their booked items first, or the item sits claimed forever (invisible to them, hidden from the owners, unbookable by everyone else). Route role transitions through `releaseHoldingsForRole` (`lib/utils/wishlistOwnership.ts`): → owner frees items **and** cancels reservations; → member does nothing (members manage their own bookings). Leave/remove free the items and keep the reservation, so the gifter can still log a gift they went on to give. Demotion and visibility changes need nothing — members retain access at every tier, and only members can book.
- **Never report a released-booking count to an owner.** "2 items released" tells them how much of the list was reserved. Counts only go back to the gifter themselves (invite accept, leave).
- **Losing ownership clears the per-owner state.** Demote, remove, or leave pulls the user from `owners` **and** from `featuredBy`. Only owners may change ownership, and nobody may change their own role.
- **"Featured" is per-owner** (`Wishlist.featuredBy[]`), not per-list: on a co-owned list one owner can pin it to their dashboard without touching anyone else's. API responses fold it to a boolean `featured` for the caller via `serializeWishlist`.
- **Never expose user emails to other users.** Invite/notification emails are used server-side only.
- **Invites are registered-users-only** (by username). There is no email-invite path; invites match `invitedUser`.
- **Proposals are anonymous to the owner.** Owners never see who proposed an item (`proposedBy` is hidden in the items API), and this extends to notifications: the `proposal` notification carries `actorUsername: null` and renders as "Someone proposed…". Never surface the proposer to the owner anywhere. Owner-facing notifications fan out to **every** owner (`createNotifications`).
- **Gifting is decoupled from the live item.** Booking creates a durable `Reservation` (survives owner status changes and leave/kick). Marking a gift writes a permanent `GiftLog` and deletes the reservation but **does not modify the owner's item**. Owner status changes (`complete`/`draft`/reopen) clear `bookedBy` but must **not** delete reservations.
- **Editing an item never changes its status.** Status changes are explicit actions (publish / move-to-draft); a content edit must not clobber a booking.
- **Archived wishlists are owner-only** — 404 for everyone else, including direct links (any owner still sees them).
- **`profileVisibility: 'friends'`** hides the bio and the browsable wishlist list from non-friends, but keeps username/avatar public. Per-wishlist visibility is a separate axis and is never bulk-mutated as a side effect.

## Conventions

- **Money** is stored as integer **cents**. Currency-code casing is **not uniform** in the DB: `Item.price.currency` is lowercase (to match the rates format), while `Wishlist.currency` and `User.defaultCurrency` are uppercase — normalize before comparing. Conversion routes through USD (`rate` = units per USD). Use the shared helpers in `lib/utils/currency.ts` / `currencyRates.ts`.
- Prefer the shared `Select`, `ConfirmDialog`, `BaseModal`, `Skeleton` components over bespoke ones. When a page's layout changes, **update its skeleton to match**.
- Async UI mutations should be **optimistic** and resilient to the 5s polling on the wishlist page (see `handleUpdateItem`): update locally, merge the server response for the single item, and don't let a stale in-flight poll overwrite fresher local state.
- TypeScript is `strict`. Keep it green.
- **Uploads are sanitized and owned.** Every image is re-encoded with `sharp` on upload (`app/api/upload`), which strips EXIF/metadata and bakes in orientation. Blobs live under `uploads/<userId>/` and count against a per-user quota. When an image field (`Item.imageUrl`, `User.image`, `Wishlist.bannerUrl`) is replaced or its record deleted, free the old blob with the helpers in `lib/utils/blob.ts` — but **only ever delete our own blobs** (`isOwnBlob`, which matches our exact store host, derived from `BLOB_READ_WRITE_TOKEN`); a user-pasted external image URL must never be deleted. Because whatever a record holds gets freed, **you may only attach blobs from your own `uploads/<yourId>/` folder**: every route that writes one of those fields checks `canAttachImage(next, actorId, current)` and returns 400 `FOREIGN_IMAGE_ERROR` otherwise. Keeping the value already on the record is allowed (a co-owner's upload on an item or banner, a proposer's image on an approved proposal), and external URLs are always allowed.
- **Schema migrations are HTTP endpoints** under `app/api/migrations/<name>/route.ts`, built with `createMigration` (`lib/utils/migration.ts`) and gated on the `X-Migration-Secret` header. Run with `curl -X POST -H "X-Migration-Secret: $MIGRATION_SECRET" <host>/api/migrations/<name>`. There are none in the tree right now — the co-ownership set was applied to every environment and deleted (see git history). When you add one:
  - Make it **idempotent**, so re-running is free and a partial run can be finished by running it again.
  - Decide its **deploy ordering** and say so in the docstring. An _additive_ migration (only writes new fields) is safe to run before the deploy, because the live old code still reads what it needs. One that removes or moves data the old code depends on must run **after**, or it breaks the running deployment.
  - If the reading code needs a fallback for the un-migrated shape, gate that fallback on the new field being absent, and delete it in a follow-up once the migration has run everywhere. Don't leave fallbacks behind — they quietly become unreachable code that still has to be reasoned about.
- **The `overrides` in `package.json` keep `npm audit` clean** by forcing patched transitive deps across the whole tree. Don't remove any without re-running `npm audit`:
  - `nodemailer`, `postcss`, `sharp` — past `next-auth`'s peer cap on nodemailer and over Next's bundled postcss/sharp. Drop the `nodemailer` override once `next-auth` widens its peer to `^9` (then we're back in supported range).
  - `brace-expansion` → `5.0.8` **and** `minimatch` → `^10.2.5` (paired) — for GHSA-mh99-v99m-4gvg, a **dev-only** DoS advisory reaching us via eslint + `@vitest/coverage-v8`. `5.0.8` is the only version that clears the advisory, but it exports a _named_ `expand` that old `minimatch` (≤9, `require('brace-expansion')()`) can't call — so `minimatch` must be forced to 10 alongside it. Drop both once eslint/vitest upstream ship minimatch 10 themselves.
- **Rate limiting goes through `enforce()` / `checkRateLimit()` in `lib/rateLimit.ts`** — never hand-roll an in-memory counter (Vercel's per-request instances don't share it). Add a new surface by adding a `SPECS` entry (tokens/window/policy) and calling `enforce('<name>', key)` right after the auth/access check, returning its response if non-null. Key **authed** writes on `session.user.id`; key **public** reads on `` `ip:${clientIp(request.headers)}` ``; key the sign-in email path on **both** email and IP. Choose `fail-open` for user-facing reads/writes and `fail-closed` for cost-bearing email sends. Limiting is **disabled** when neither `UPSTASH_REDIS_REST_URL`/`_TOKEN` nor their `KV_REST_API_URL`/`_TOKEN` fallbacks are set (CI/tests) — tests inject a fake via `__setRateLimiters`, they don't need Redis. A `.env` pulled from Vercel carries the `KV_*` pair, so local dev _does_ rate-limit against that store.
- **Never print, commit, or expose secrets** (`.env*`). Never read or use production credentials (`.env.prod`, `.env.staging`), and only perform authorized DB operations.

## Keep docs current

When a change affects how the project is set up, run, or structured, update the docs in the **same** change — stale docs are worse than none:

- New/changed/removed **env var** → update `README.md` and `.env.example`.
- New/removed **npm script**, dependency, or tech-stack change → update `README.md`.
- New user-facing **feature** or removed one → update the README feature list.
- New **convention, invariant, or workflow** for contributors → update this `AGENTS.md`.
- **Deferred ideas and follow-ups** go to Linear (Backlog), not into a file in the repo — design notes for a large feature belong in its Linear project description.
