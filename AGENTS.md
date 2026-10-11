# AGENTS.md

Working instructions for AI agents (and humans) contributing to this repo. This file is the core and stays short: the full rules live in the topic files under [`docs/agents/`](docs/agents/), indexed under [Rules by topic](#rules-by-topic). **Before you change code in an area, read its topic file**: the one-line summaries here aren't the whole rule.

## Project

A wishlist app: **Next.js 16 (App Router), React 19, TypeScript (`strict`, keep it green), MongoDB/Mongoose, NextAuth v5 / Auth.js (database sessions), Tailwind v4, Vercel Blob**. Package manager is **npm**. Path alias `@/*` maps to the repo root.

## Commands

```bash
npm ci               # install deps (scripts/workspace-setup.sh runs this for you)
npm run dev          # local dev server, on this checkout's own port (scripts/dev-port.mjs: 3000 in the main checkout)
npm run verify       # every must-pass check below, in order, stopping at the first failure; `-- --quick` is the pre-push subset
npm run lint         # eslint — must pass before done
npm run format:check # prettier --check — must pass before done (npm run format fixes it)
npx tsc --noEmit     # typecheck — must pass before done
npm run test:cov     # full Vitest suite (unit + component + API) + the coverage floor in vitest.config.mts — must pass before done
npm run build        # production build — must pass before done
npm run check:trace  # after a build: sharp's native libvips ships with every route that ships sharp (the upload routes, share cards), and NextAuth's route ships none (`npm run verify` runs it)
npm run smoke:deploy -- <url>  # read-only GET smoke of a deployed host (auth + upload routes start, a share card draws); safe on staging
npm run generate:bookmarklet  # rebuild lib/bookmarklet/code.ts; rerun after changing lib/bookmarklet/**, productExtract.ts or productFragment.ts
npm run generate:email-logo    # re-render the email logo (lib/emailLogo.ts) from app/icon.svg; rerun when the logo changes
npm run test:e2e     # Playwright end-to-end suite
npm run test:watch   # watch mode
npm test             # the same suite without coverage
npm run release:preview  # list commits remote staging is ahead of remote main, and the tag it would get (dry run)
npm run release          # promote: fast-forward remote main to remote staging and tag it — operator only
```

## How work flows

Tasks live in **Linear** (workspace `mikitasolo`, team **Wishlist**, keys `WIS-<n>`). Each issue is worked in its own **Orca** workspace (a git worktree + branch cut from `staging`, under `~/orca/workspaces/wishlist2/`), usually by an AI agent. The human **operator** writes and clarifies requirements, reviews, merges and releases.

### Branches

- **`staging`** is the default and integration branch. Every change reaches it through a **PR**, which the operator **squash-merges**. **There is no CI on PRs** (WIS-419: the free GitHub Actions minutes ran out every month): the checks run locally (`npm run verify`; the pre-push hook runs its quick subset) and the PR body reports them. The only workflow is `audit.yml`, weekly on `staging` and on demand; for a PR that changes `package.json` / `package-lock.json`, run `npm audit --omit=dev --audit-level=high` by hand (not in `verify`: it needs the network). **Vercel builds only `staging` and `main`** (`git.deploymentEnabled` in `vercel.json`, pinned by `test/unit/vercelConfig.test.ts`): PR branches get no preview, since PR pushes used up the Hobby plan's daily deploy cap. Vercel matches those keys as minimatch globs (`*` stops at `/`), so the catch-all is `"**"` (WIS-185). A change's first real Vercel build is its `staging` deploy, so smoke `staging` after a merge that touches the build, env or runtime.
- **`main` is production** (Vercel deploys on push). It only ever **fast-forwards to `staging`** (`npm run release`, `scripts/release.mjs`): never commit to it or open a PR into it.
- **Every release is tagged.** `npm run release` pins `origin/staging`'s commit, tags it `release-YYYY-MM-DD` (UTC; `.2`, `.3`… for later releases that day, annotated with the commits it ships) and pushes `main` and the tag in one `git push --atomic`, so a tag exists exactly when its release happened. The newest `release-*` tag is what production runs. **To roll back**, the tag before it is the last good release: promote that commit's deployment with Vercel's Instant Rollback, then fix forward with a revert PR into `staging` (`main` never moves backwards).
- **A push to `main` is a release.** After its atomic push, `npm run release` (`scripts/releaseNotify.mjs`, WIS-379; there is no GitHub Actions workflow for this) posts the changelog (commit subjects in the pinned range) to Telegram and moves the Linear issues those commits close from **On Staging** to **Done**. It reads `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` / `LINEAR_API_KEY` from the operator's shell or `~/.config/wishlist2/release.env` (outside every worktree), never logs them, and without them prints a preview; a failure only warns, and `release:preview` posts nothing. A release pushed by hand notifies no one.

### Issue statuses

| Status      | Meaning                                         | Moved by                                    |
| ----------- | ----------------------------------------------- | ------------------------------------------- |
| Backlog     | Idea, or not specified well enough to build yet | operator                                    |
| Todo        | Spec is ready — an agent can take it            | operator                                    |
| In Progress | Being worked in a workspace                     | the agent, when it starts                   |
| In Review   | PR is open                                      | Linear's GitHub integration                 |
| On Staging  | Squash-merged into `staging`, not yet released  | Linear's GitHub integration                 |
| Done        | Released to production                          | `npm run release`, after its push to `main` |
| Canceled    | Won't do                                        | operator                                    |

Labels: one **Type** (Feature / Bug / Improvement / Tech debt — maps to the commit prefix) and one **Area** per issue. Large features are Linear **projects** whose description holds the design notes and open questions: read it before starting an issue inside one.

### Agent lifecycle for an issue

1. **Read the issue** through the Linear MCP server: description, comments, and the parent project's description. If the acceptance criteria are missing or ambiguous, especially near the domain invariants, **ask the operator before writing code**. Don't guess at product decisions.
2. **Move the issue to In Progress.**
3. **Stay in your workspace branch.** Don't rename it, and never check out, commit to, or push `staging` or `main`.
4. **Implement with tests** (see Testing policy), after reading the topic files for the areas you touch. Stay in scope: an unrelated bug or idea becomes a **new Linear issue in Backlog** (linked from the PR).
5. **Verify**: `npm run verify` (everything marked "must pass before done" under Commands; the pre-push hook runs the quick subset, `--no-verify` skips it), plus `npm run test:e2e` if you touched a flow the E2E smoke tests cover.
6. **Review your own diff** (`git diff origin/staging...`) as a skeptical reviewer: correctness, the domain invariants, missing tests, leftover debug code, docs the change makes stale. Fix what you find.
7. **Commit, push your branch, open a PR into `staging`** (`gh pr create --base staging`), following the rules below.
8. **Report the checks in the PR body**: which ran on the final commit (the full `npm run verify`, not just the hook's quick subset, plus `npm run test:e2e` when a flow it covers changed) and their results. There's no CI and no branch protection, so nothing else stops a red PR being merged.
9. **Hand off**: the PR link, what changed, how you verified it, and anything the operator must do by hand (env vars, migrations, dashboard config).

**Operator-only** — never do these as an agent: merge a PR, run `npm run release`, run a migration against a deployed host, change env vars or secrets in Vercel/GitHub, or push to any branch other than your own.

### Pull requests & commit messages

**PR titles are published**: squash-merged, the title becomes the commit subject on `staging`, and every subject in a release goes verbatim into the Telegram changelog. It's release-note copy:

- **Conventional-commit prefix**, which the changelog groups by: `feat:` `fix:` `perf:` `refactor:` `docs:` `test:` `build:` `ci:` `chore:`. Unprefixed lands in a catch-all "Other".
- **Imperative, specific subject** that stands alone (readers see no diff or body): `fix: release a member's bookings when they're made an owner`, not `fix: bug` or `fix: address review comments`.
- **No issue ID in the title** (the channel has no Linear). Put `Closes WIS-<n>` in the **body** (it links the PR and drives the status), or `Part of WIS-<n>` for a PR that doesn't finish the issue.
- **The body becomes the squash commit's message**: explain _why_, plus what a future reader would otherwise reconstruct (the invariant protected, the failure mode closed, required migrations and their ordering, how it was tested). Follow `.github/pull_request_template.md`.
- **One issue, one PR, one coherent change.** Commits inside the branch are squashed away but still use the prefixes.

### Parallel workspaces

Several agents run at once, each in its own worktree. Assume nothing is exclusive to you:

- **Ports**: each workspace gets its own dev / E2E pair from its worktree path (`scripts/dev-port.mjs`, 3200–3999; the main checkout keeps 3000 / 3100), read by `npm run dev`, `playwright.config.ts` and the setup's `NEXTAUTH_URL`. If two collide (setup warns), set `DEV_PORT` (E2E takes the one above) or `E2E_PORT` in one. Never hard-code 3000/3100.
- **`next dev` leaves `AGENTS.md` alone** thanks to `agentRules: false` in `next.config.js` (Next 16.3 otherwise appends a "nextjs-agent-rules" block); keep it.
- **Conflicts**: other PRs touch `README.md` / `AGENTS.md` / `docs/agents/` too. Rebase onto `origin/staging` and force-push **your own branch** with `--force-with-lease`; don't merge `staging` into it.
- **Local dev data**: `scripts/workspace-setup.sh` copies in the main checkout's `.env` without the real Blob store credentials (WIS-221), and never `.env.prod` / `.env.staging`. Local dev and E2E must never write to the shared Blob store: `@vercel/blob` prefers `VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID` over `BLOB_READ_WRITE_TOKEN`, so the setup strips them and the E2E harness blanks both, gives the app a dummy token and points `VERCEL_BLOB_API_URL` at a closed port (`e2e/blobEnv.ts`, pinned by `test/unit/e2eBlobEnv.test.ts`); no spec uploads (one that needs it routes `/api/upload`). The setup also runs `npm ci` with a shared MongoDB binary cache, fetches Playwright's Chromium and points `NEXTAUTH_URL` (`.env.local`) at the dev port. **The dev MongoDB is shared** by every workspace: don't wipe or bulk-edit it, and prefer the test suites over poking the dev server. When you run it, use `EMAIL_TRANSPORT=console`: emails (magic links included) print to the dev-server log instead of being sent. Only that transport ever prints a recipient or link; the `smtp` path in `lib/email.ts` must never log them, not even in a send error. A printed magic link is a working credential, so `lib/env.ts` allows `console` only where `VERCEL_ENV` is unset or `development`.
- **A real install in every worktree** (`npm ci`, which setup runs): `tsc`, lint and Vitest work through a symlinked `node_modules`, but `next build` (so `check:trace` and E2E) doesn't.
- **Screenshots of a change** drive the app as the E2E suite does, never against the shared dev MongoDB: a throwaway Playwright script, kept out of the commit, on top of `e2e/global-setup.ts`. Only the screens the change touches, at 390 and 1280, "before" on `origin/staging` and "after" on the branch, light theme unless the change is about colour or contrast.

## Testing policy (required)

**Add or update tests for every change that touches logic — no exceptions for "small" fixes.** The booking flow, currency conversion, privacy gating and the invite/gift lifecycle are what broke before and must stay covered.

- **New pure logic** (`lib/utils/**`, Zod schemas in `lib/validations.ts`) → a unit test.
- **New/changed interactive component behaviour** (conditional rendering, state, optimistic updates) → a component test. Skip purely presentational markup.
- **New/changed API route with authorization or business rules** → an API test (in-memory Mongo + mocked session).
- **Every bug you fix** → a regression test tagged with a `// regression:` comment citing the cause.

Chase meaningful coverage of logic and authorization, not a headline line-coverage number.

### Test layout & harness

- `test/unit/**` — pure functions and schemas (node env, no DB).
- `test/components/**` — React Testing Library; **`// @vitest-environment jsdom`** as the first line.
- `test/api/**` — route handlers against a real in-memory MongoDB:
  - `vi.mock('@/lib/mongodb', ...)` → no-op `connectDB` (the shared connection from `test/db.ts` backs the models).
  - `vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))`, then `const session = vi.mocked(auth)` (routes call `auth()`, not `getServerSession`).
  - Mock `@/lib/email` / `@/lib/utils/currencyRates` when a route would send mail or hit the rates API.
  - `connectTestDB` / `disconnectTestDB` / `clearTestDB` from `test/db.ts` in `beforeAll` / `afterAll` / `beforeEach`.
- **Mock lifecycle (Vitest 5).** Call history is cleared before each test (`clearMocks`), but implementations aren't: `vi.restoreAllMocks()` only undoes `vi.spyOn` and leaves a `vi.fn()`'s `mockResolvedValue` / `mockImplementation` in place, so a shared `vi.fn()` that tests configure (the mocked `auth`, `sendEmail`, `fetch`) gets a `mockReset()` in `beforeEach` (as with `session.mockReset()`). `vi.mock` / `vi.hoisted` must be top-level, and an un-awaited `expect(…).resolves` / `.rejects` fails the test.
- `vitest.config.mts` injects dummy env vars so import-time env reads don't throw. Vitest picks up only `test/**/*.test.{ts,tsx}`.
- `e2e/**` — Playwright. `e2e/global-setup.ts` starts an ephemeral MongoDB and seeds a user who owns `e2e-birthday` and is a member of another user's `e2e-friend` (so specs can take either side), a database session (an `authjs.session-token` storageState for the `authed` project), and single-use magic-link tokens (`e2e/magicLinks.ts`: four for emails with no account (one signs up through a Join link), two for the friend, plus a session for the friend, and one for `e2etour`, the only seeded account that hasn't done the guided walkthrough; a third user's Invite only list has a Join link for the friend, `e2e/shareLinks.ts`) so a spec can sign up or in through Auth.js's real callback; then builds and starts the app (`global-teardown` stops both). Specs are `*.public.spec.ts` (signed out) or `*.authed.spec.ts`. Every spec imports `test` / `expect` from `e2e/fixtures.ts`, never `@playwright/test` (ESLint enforces; types may come from there). That `test` fails a spec on any uncaught page error (`pageerror`, unhandled rejections included) or an unallowed `console.error`; a failure the spec provokes on purpose (a request it fails or aborts, logged as `Failed to load resource`, plus the app's own log line) is allowed in that spec, as narrowly as possible, with `consoleErrors.allow(failedRequest(/…path…/), /^Error updating item: /)`, and a context it opens itself (`browser.newContext()`) is only guarded once passed to `consoleErrors.watch`. The suite-wide `ALLOWED_CONSOLE_ERRORS` is only for errors no spec can avoid, each with a comment and tracking issue (empty today). Keep E2E to a few resilient smoke tests per flow. `a11y.*.spec.ts` scan the key screens with axe in light and dark and fail on serious / critical violations (WIS-383); a new screen gets a scan there, and exceptions go only in `ALLOWED_A11Y_VIOLATIONS` (`e2e/axe.ts`), each with a comment and tracking issue.

## Rules by topic

Each line names a rule; the topic file has the whole of it, including the helpers to use and the tests that pin it.

### [Domain invariants](docs/agents/invariants.md) — correctness and privacy rules; never regress them

Read it before touching roles, invites, bookings, visibility, notifications or account deletion.

- **Roles**: a list has exactly owners (`Wishlist.owners[]`) and members (`WishlistMember`, no role field); all co-owners are equal, authorized only through the `wishlistOwners.ts` / `wishlistAccess.ts` helpers, and owner-only writes are conditional (`removeWishlistOwner`, `deleteOwnedWishlist`, `ownedByFilter`). A list always keeps one owner.
- **Members** browse, propose and reserve; everything else is owner-only.
- **Becoming an owner** takes consent (create, `owner` invite, promotion of an existing member) and releases that person's bookings and reservations; route role changes through `releaseHoldingsForRole`, and keep the grant-then-release order that `undoBookingUnlessMember` relies on. A share link never makes anyone an owner: a Join link's join only adds a member, re-reading after its upsert.
- **Demote / remove / kick** notify only the person affected, never naming who did it; losing ownership clears `owners` and `featuredBy`; nobody changes their own role; a kick keeps them out of the list's share links until an invite is accepted.
- **Occasion reminders** go 7 days ahead to members only (never owners or friends), once per (person, list, occurrence) via a unique index, re-checked after the write, capped per run, opt-out in `notificationPrefs`, no booking info. **The one exception** is a friend's birthday reminder, about a person, not a list: to the friends `canSeeBirthday` admits at send time, minus members of that person's Birthday lists due in the same window, once per (friend, person, occurrence), re-checked after the write and on every feed read, never naming a list; email off by default.
- **Gift reminders** (WIS-384): `gift_reminder` 7 days before an occasion and `gift_nudge` 3 days after (only what isn't marked as given) go only to whoever holds a reservation or group gift pledge there as a plain member (`giftHolders`; the nudge to a live group gift's organizer only, and to a received item's gifter too), once per (person, list, occurrence) per event via a unique index, re-checked after the write, before each email and on every feed read, capped per run; no item or count; hidden by No spoiler mode; email off by default.
- **The birthday nudge** (Needs you + `birthday_nudge` email) goes 21 days before your own profile birthday, silenced by any unarchived Birthday list you own or co-own coming; the email once a year through a claim re-checked after it, capped per run.
- **Invites**: by username only (a group invite, WIS-37, fans out to one ordinary invite per person, each held to every single-invite rule), one pending per person per list, issued through `issueWishlistInvite` (20-pending cap, `PENDING_INVITE_CAP`); answered by claiming the pending row first; leaving or losing a role cancels your pending invites, and an owner taken off loses the ones they sent; an archived list's `member` invites are paused.
- **Requests to join** grant nothing: owners answer with a normal invite or a silent decline.
- **Asking a friend for a wishlist** (WIS-324): friends only, when they can open none of the person's lists; one live ask per 30 days that quietly expires; a new list tells only askers `getWishlistViewAccess` admits, re-checked after the write.
- **Owners never see booking status**, any reservation count, or who proposed an item; every item answer goes through `serializeItem`. Starting a new list from one (`/copy`, WIS-325) offers a booked item exactly as an available one, and makes one whole list per `Idempotency-Key` or none. Bulk item actions (WIS-386) run each item through `updateItem` / `deleteItem`, pick items by status with booked as available, and answer ids with no reason; a move to another list (WIS-434) is a copy plus that delete, to a list the caller owns that isn't archived (re-checked on both after the copies are written), its copies recorded first so an attempt that fails or dies is settled.
- **Linked items** (WIS-29): symmetric, same-list, owner-written via `itemLinkWrites.ts`, never a proposal, 10 per item on both sides (conditional writes); shown only where both sides agree, only partners the viewer may see, as `{ id, name }` with no status; a delete unlinks, `/copy` remaps.
- **"N items"** is a list's published items, counted only with the `itemCounts` helpers.
- **A booking is never left unreleasable**; gifting is decoupled from the live item (`Reservation`, `GiftLog`); an item edit never changes its status. **Group gifts** (WIS-361) go only through `groupGifts.ts`: conditional writes on the gift, the item following; anyone leaving, kicked, made owner or deleted is withdrawn (organizer → earliest remaining contributor, none left → item released); never shown to owners or non-members, discreet mode hides them. Their notifications (WIS-364) reach contributors only, never the actor, re-checked as plain members at send, after the write and at every feed read; nobody is named but a joiner. A contributor's Reserved card stays theirs while they're in it, and their `GiftLog` records their pledge (`Reservation.pledge`), never the full price (WIS-363).
- **Share links** (`/l/<token>`): a `ShareLink` per link, managed by any owner (`/api/wishlists/[id]/links`, 20 per list, none created while archived); the token (22 base62, `generateShareToken`) goes only to owners, is format-checked before any query (`isShareTokenFormat`) and never logged; resolve only via `resolveShareLink` (every dead link is the same `null`); a link is bound to its list and never grants ownership; its QR code is drawn in the browser (`qrShape`). Requests carry it in `X-Share-Token`, admitted only through `admitListViewer` (list `GET`, items `GET`, join requests); a dead link is the same 404 for everyone; the `/l/` page is `WishlistPage` in link mode.
- **Archived lists are owner-only** (the `Wishlist not found` 404 for everyone else); viewers are admitted only through `getWishlistViewAccess` / `viewableWishlistsFilter`; a list you can't open looks the same whatever the reason; search returns only lists the searcher could open.
- **Never expose a user's email** to other users; name people with `publicDisplayName`.
- **Groups** (WIS-27) are private tags on people you follow, only via `lib/utils/peopleGroups.ts` filtered on their owner (someone else's is a plain 404); 20 groups of 100, re-checked after the write; unfollowing or account deletion takes people out; a whole group is read only through `groupMemberIds`; never linked to a list.
- **A profile birthday** (`User.birthday`, day + month only) is answered to others only through `visibleBirthday` / `birthdayVisibleFilter` (the narrower of `birthdayVisibility` and `profileVisibility`); excluded viewers get no `birthday` key, as for none; Coming up gets only friends' (`/api/users/me/birthdays`), each its own card that never hints at their lists; never in the session, search or list answers, and in a notification or email only as a friend's birthday reminder (to friends it admits, re-checked when the feed is read); independent of list occasions.
- **Account deletion** is `deleteAccount`'s ordered cascade; a new collection that references a user needs a step there.

### [Backend & platform](docs/agents/backend.md)

- **Money** is integer cents; currency codes are uppercase everywhere (normalize client input with `normalizeCurrency`); other people's prices show in the viewer's currency, always through `formatPrice`. A user's currency is suggested, never guessed. An occasion date is a `YYYY-MM-DD` calendar date: use `lib/utils/occasion.ts` and `useLocalToday`.
- **Auth**: accounts are created on the first verified sign-in (the adapter's `createUser`); the session callback returns the `sessionPayload` allowlist; only the home page reads the session on the server (and `/l/[token]` and `/welcome`, for a kick block; `/l/` also server-draws a signed-out visitor's list header from it, WIS-447); a magic link is sent only by the sign-in form's Turnstile-checked server action.
- **sharp** needs libvips shipped by hand (`outputFileTracingIncludes`, `check:trace`); load it lazily outside the upload route.
- **Uploads** are re-encoded, type-checked, owned (`uploads/<userId>/`, `canAttachImage`) and freed only via the `blob.ts` helpers from what the write replaced; unsaved uploads are handed back; snapshots have their own helpers. An image from a URL is re-hosted only by `POST /api/upload/from-url` through `safeFetch` (https, public addresses only, pinned connection, every redirect re-checked, one generic error); no other server code fetches a user's URL.
- **Link previews** show only what a signed-out visitor could see (a live share link's: its list, whatever the visibility); a write that changes a card calls `purgeShareCards`.
- **Email** is `lib/email.ts` (transport) plus one template module per email in `lib/emailTemplates/`, each with a fixture for the local-dev-only gallery `/dev/emails` (a 404 wherever `EMAIL_TRANSPORT=console` isn't allowed); its HTML escapes every user value, and subjects carry no free text; every notification email has a signed one-click unsubscribe for its event (`unsubscribeUrls`), and each event's email follows its setting in `NOTIFICATION_EVENTS`, says no more than its in-app row (`sendNotificationEmail`), and is limited per recipient (proposals and link joins: one per list per owner a day). **Logs** carry no personal data. **Analytics** (Umami, production only) goes only through `lib/analytics.ts`: route patterns for URLs (never a share token or id), coarse enum props, fired after a write succeeds, never a reservation event from an owner's view.
- **Rate limiting** only through `enforce()` in `lib/rateLimit.ts`, with branded keys and the new-account tier.
- **Migrations** are idempotent `createMigration` HTTP endpoints with a stated deploy order. Hot queries never `COLLSCAN` (`test/api/indexAudit.test.ts`); a new one gets a scenario there.
- **`overrides`** and the known `npm audit` exceptions live in backend.md; update that list with any audit change.

### [UI kit & design system](docs/agents/ui.md)

- One **control size scale** (`Button`, `IconButton`, `Input`, `Select`, `Field`…), one **type scale** (no `text-[Npx]`), four **icon sizes**, sentence case, and "…" only on pending labels.
- **D1 vocabulary**: reserve / release / mark as given / mark as received / Public · Friends · Invite only. Counts go through `plural`. Confirmation copy never says a reservation goes when it stays.
- **Shared kit only**: `EmptyState`, `Badge`, `Panel`, `SegmentedControl`, `Callout`, `Spinner`, `Skeleton`, `Cover`, `Menu`, `BaseModal` + `useFocusTrap`, toasts with one action.
- **Spacing rhythm** for pages, grids and forms; skeletons mirror their page.
- **Colour**: status tones only via `statusMeta` / `TONE_CLASSES` (no raw palette classes), `danger` tokens for red, `text-accent`, one popover look, base CSS inside `@layer base`, visible keyboard focus.
- **Motion** (WIS-407): played only by the viewer's own successful action (`lib/utils/motion.ts`, `useCardMotion`), never by a data change; no reservation motion for owners or in discreet mode; nothing under reduced motion.

### [Screens & client behaviour](docs/agents/screens.md)

- **A failed read is never shown as empty** (`LoadError`); later failed reads keep what's shown.
- **Live reads** go through `useLiveRead` (polling only while visible, a read on return, no answer cache); **mutations are optimistic** and survive the 5s poll (`updateItemOptimistically`, `mutations.track`, `withRequestTimeout`, idempotency keys); per-card actions use `useBusyIds`.
- **Destructive actions offer Undo** (WIS-387): shown at once, sent after the 5s Undo window through `useUndoableAction` (deferred commit, flushed with `keepalive` when the page goes away), so an undone kick, release or delete never sent anything; a confirmation stays only where Undo can't be honest (account and list deletion, leaving or archiving a list, Mark as given).
- **Group gifts on the item card** (WIS-362): members only, optimistic through `handleGroupGift` / `groupGiftClient.ts`, hidden by discreet mode; details in screens.md.
- **Navigation** lives in `AppHeader` (Home · Reserved · Activity · Me); the header holds its shape while the session loads; read the session with `useKnownSession`.
- **Discreet mode** ("No spoiler mode" to people; a device switch in the header, WIS-46): reservations are hidden at render time only (`useDiscreetMode`, `withoutReservation`), never from fetched data; any new surface showing a reservation or its count honours it; `/booked` is covered until Show.
- **Guided walkthrough** (WIS-371): `Walkthrough` in `AppHeader`, state on the account (`User.walkthrough`, `lastActiveAt` bumped once a day by `GET /api/users/me`, the 90-day re-offer decided in that write), one tour for everyone that goes to each step's page and dims around a real `data-tour` control (WIS-436: "try it" steps move on when it's used, Next always works; a centred card with a made-up picture only as fallback), reserving (and adding/sharing without a list of one's own) on the client-only practice list `/tour` (`PracticeList`, made-up data, sends nothing, owner view never shows a reservation); seeded E2E users have it done.
- **Dashboard** (Needs you, Coming up, lists), **Activity** (invitations and the one unread badge), a list's **status chips** (never saved; sort is) and `/items`, the **item card** and its sheet, the owners' **Items · People · Settings tabs**, the **add tile** and item dialogs, an owner's **Select mode** (one bulk request per batch, WIS-386), and **settings forms that send only what changed**.

- **Never print, commit, or expose secrets** (`.env*`). Never read or use production credentials (`.env.prod`, `.env.staging`), and only perform authorized DB operations.

## Keep docs current

When a change affects how the project is set up, run, or structured, update the docs in the **same** change — stale docs are worse than none:

- New/changed/removed **env var** → `README.md` and `.env.example`.
- New/removed **npm script**, dependency, or tech-stack change → `README.md`.
- New or removed user-facing **feature** → the README feature list.
- New or changed **convention, invariant, or workflow** → the topic file in `docs/agents/` it belongs to, plus its one-line entry under Rules by topic here. Workflow, commands and testing policy stay in this file. **Keep this file lean**: Claude Code loads it into every session and refuses files over 150k characters, so detail goes in the topic files, never here.
- **Deferred ideas and follow-ups** go to Linear (Backlog), not into a file in the repo; a large feature's design notes belong in its Linear project description.
