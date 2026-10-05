# 🎁 Wishlist

A modern wishlist app: create wishlists, share them, follow friends, and quietly reserve gifts for each other. Built with Next.js 16, React 19, TypeScript, and MongoDB.

## ✨ Features

- **Multiple wishlists per user**, each with its own cover image, currency, and human-readable slug.
- **Co-ownership** — a wishlist can have several equal owners (a family list appears on each of their profiles, and each can pin it to the top of their own dashboard, from the list's ⋯ menu or with Pin to top on its card). Ownership is only ever granted with the new owner's consent; accepting it releases the items they'd reserved on that list, since owners can never see reservations. The invite form's username suggestions show who's already an owner, a member or invited, and offer to make a member a co-owner instead. A list always keeps at least one owner: the sole owner's Leave list (in the ⋯ menu) explains that they need to make someone else an owner first (and takes them to an owner invite) or delete the list.
- **Visibility tiers** per wishlist: Public, Friends (mutual followers of any owner) or Invite only (owners and the people they invite), stored as `everyone`, `friends` and `private`. Archived wishlists are visible to owners only.
- **Item details** — an item card shows a line of its notes, and tapping its name or price opens the item in a sheet (a bottom sheet on a phone, a dialog on desktop): a large photo, the full name and notes, the price, the shop link by its domain (`amazon.de ↗`), and the card's own actions.
- **Follows & friends** — follow people; a mutual follow makes you "friends", which unlocks friends-only content.
- **Search** — one search for people and wishlists, in the header and on the signed-out landing page. A handle typed as it's shown (`@alice`) finds the person, while list names match as typed. It only returns lists you could open, including your friends' friends-only lists and private lists you belong to, and it puts the closest matches first: an exact username, then usernames that start with what you typed, then ones that contain it, each with friends, people you follow and your followers first; your own and shared lists, then friends' lists. You never come up under People yourself (your lists still do). A result says how it relates to you (Friend, Follows you, Your list, Member), and nothing about anyone else's relations. Opened empty, it offers up to five people you follow, and it works from the keyboard (↑ ↓ to move, Enter to open, Escape to close).
- **Reserving without spoilers** — friends reserve items to give and release them if plans change; the owner never sees what's been reserved on their own list, and marks an item as received once they have it. A list shared with you says on its card how many of its items you've reserved ("2 reserved by you"); nobody else sees that count.
- **Reservations & gift history** — a durable record of what you're giving, decoupled from the owner's item (see [the domain invariants](docs/agents/invariants.md)). The Reserved page opens on the gifts you still have to give, grouped by their list's upcoming occasion, the nearest first ("Birthday · today — Dmitri's birthday · @dmitri_v"), with the rest under "No date"; a list you can no longer see shows no date. Each card has the item's shop link (Open link ↗) and notes while it's still yours, and View on list opens the list scrolled to that item, highlighted (`?item=`). Prices and the "≈ €520 to give" total under the title are in your own currency. Gifts that changed since you reserved them come next, each offering what most likely fits (I gave it, or Dismiss), then your gift history. Release a gift you no longer plan to give right from the Reserved page, which frees it on the list for others; one you've marked as given (it moves to your gift history) shows as "Given by you" on the list, so it isn't put back up by mistake.
- **Invitations** to a wishlist as an owner or a member, registered-users-only, answered with Accept or Decline right at the top of Activity (each says what the role means, shows the list's cover, occasion and size when you could already open it, and a co-owner invite warns first when accepting would release gifts you've reserved there). Nobody can be sent more than 20 invitations in 30 days that they haven't answered yet, however many people send them.
- **Most wanted** — owners can mark the items they want most. Everyone sees a star on them, and a list sorts them first unless you pick another sort.
- **Item proposals** — members can propose items, and the owners answer each one with Add to list, Add as draft (editing it first if they like) or Decline, which is silent. Proposers stay anonymous to the owners.
- **Dashboard** — opens on what needs you: pending invitations with Accept and Decline in place, how many of your reservations changed and need confirming, the proposals waiting for review on each of your lists, and the one-time currency prompt (at most three, with See all in Activity, and nothing when nothing does). Under it, **Coming up** shows every list, yours and shared, with an occasion in the next 30 days, nearest first, with Find a gift on a friend's list and Share on your own. Then your lists, your pinned one first, and the ones shared with you.
- **Phone-sized lists** — on a phone the dashboard, Your wishlists and Shared with you show each list as a compact row (cover, name, occasion, owner and item count) instead of a full card, and archived lists fold into one Archived (n) row you can open.
- **Navigation** — four places: Home (your lists and the ones shared with you), Reserved, Activity and Me (your profile). On a phone they're a tab bar along the bottom of the screen; on a wider screen the header links Home · Reserved · Activity, and Me is your avatar, whose menu keeps just your profile, Settings, the theme and Sign out. Home shows up to eight lists in each section, with See all (n) to the rest, and All items beside Your wishlists. The header keeps its shape while the page loads, so nothing in it jumps when your session arrives.
- **Quick adding** — an owner's list starts with an Add item tile (a member's with Propose an item), and Keep adding in the dialog saves item after item without closing it, keeping the currency. New list is one click away on the dashboard and on Your wishlists.
- **Status chips** on every list — one row of chips with counts narrows it to drafts, proposals, live or received items (an owner's), or what's available, what you've reserved and your proposals (a member's). Every list opens on All, with what you can act on first, and nothing carries over to the next list; the chip you pick goes into the link (`?show=`), so back and refresh keep it.
- **Occasions** — an owner can give a list one occasion (a birthday, holiday, wedding or other) in the list's settings: a date for a one-off, or just a day and month for one that repeats every year, which keeps no year at all. Everyone who can see the list sees it under the list's name, with the day it next falls on and a countdown ("Birthday · Sat 17 Oct · in 14 days"), and on the list's card with the countdown ("Birthday · in 12 days"), counted from their own local date. Your own lists and the ones shared with you (the dashboard, Your wishlists and Shared with you) and every profile show the ones with an occasion coming up first, nearest first. It never changes who can see it. A week before it, each of the list's members (not its owners) gets one reminder in Activity ("Birthday coming up on Mon 12 Oct: Anna's 30th"), which says nothing about what's been reserved; an archived list sends none, and Settings → Notifications turns them off.
- **Save to my list** — see something you want too on a list you can view? Save a copy of it to one of your own wishlists (or copy between your own lists, or make a new list for it on the spot), editable before it's saved. The copy is independent and gets its own copy of the image; the list it came from isn't told, and its notes and bookings never come across.
- **Multi-currency** prices, written the way your browser's locale writes them ("€349.00", "349,00 €"), with live conversion to any currency you pick: a converted price is marked approximate ("≈ €247"), with the original under it. Other people's lists show their prices in your default currency from the start, your own lists in each item's own, and whatever you pick instead is remembered on that browser. Accounts start on USD, and the dashboard offers anyone still on it, once, the local currency instead ("Show prices in PLN?"), which the browser works out from its time zone, then its language's region, with no IP lookup. Use it or choose another in Settings: either way it isn't offered again.
- **Profiles** with avatar, bio, follower/following counts, and privacy controls. A profile lists its person's wishlists with the nearest occasion first, names the other owners only on a co-owned list ("with @chloe_r"), and on your own profile says how many of your lists signed-out visitors can open ("Visitors see 3 of your 5 lists"). Settings has five panels (Public profile with a link to copy or open your profile, Privacy, Notifications with an in-app and an email switch for each kind of notification, Preferences with the currency and theme, Account): each setting saves as you pick it and says Saved in place, while the username and bio have their own Save, and leaving with them unsaved asks first.
- **Delete your account** — Settings → Account has a Danger zone with Delete account…: its confirmation names the lists you own alone, which go with it, and asks you to type your username (or your email, without one). Everything is erased at once, with no grace period: those lists, your photos, reservations, gift history, follows, notifications, invites, requests to join and sign-in records. Lists you share with other owners keep working without you, items you reserved elsewhere become available again, and other people's own records stay. Then you're signed out to the home page.
- **Magic-link sign-in** (no passwords), one form for new and returning people, behind an optional, usually invisible Cloudflare Turnstile bot check. Once a link is sent you can resend it after 30 seconds or go back and fix the address, and an expired link's error page sends you back to sign in toward wherever you were headed; image uploads, responsive Apple-inspired UI, light, dark or System themes (System, the default, follows the OS live, with no flash on load).
- **A private handle from the start** — a new account gets a random username (`user_…`), never one taken from the email, and its first sign-in opens a welcome step offering to pick one of its own (and, where the browser suggests one, a currency). It's skippable, and either way it continues to wherever the sign-in was headed (an invite, a list).
- **Sharing** — Share on a list or profile opens the phone's share sheet on a touch device, and copies the link elsewhere. A list's owners first see who the link will open for (anyone, friends of the owners and people on the list, or only people on the list), and how to invite someone so they can reserve gifts.
- **Share links** — a list's owners can make secret links (People → Share links, or Share → Share links) that open the list for anyone who has one, whatever its visibility, so an Invite only list can still be sent to a group chat. Each link has an optional label, a level (Can view or Can join), an optional expiry (Never, 1 week, 1 month, the day after the occasion, or a date), Copy link, Edit, Preview as visitor and Revoke. Someone opening one sees the list as a visitor and can ask to join (or sign in to ask); a revoked, expired or archived list's link says it doesn't work anymore, the same for everyone. Owners and members who open a link go to the list's own page.
- **How to get invited** — anyone who opens a list they aren't on (signed out, or signed in but not a member or owner) sees a note under its name: only people its owners invite can reserve items, so nobody buys the same thing twice. Signed in, it offers **Ask to join**, which asks the owners to invite them (it then reads Requested, with Cancel request); signed out, it offers Sign in, back to the list. It never says which items are reserved.
- **Requests to join** — every owner is told in Activity ("@ivan asked to join …") and finds the request under Requests on the list's People tab, with **Invite** (a normal member invite, which the requester still has to accept) and **Decline**, which tells nobody: the requester's button keeps reading Requested, and they can ask again 30 days later. Owners see only the requester's public handle. A list someone can't open offers nothing to ask on.
- **Rich link previews** — a shared wishlist or profile link shows its own card in messengers and social networks (Telegram, WhatsApp, iMessage, Viber, Facebook, X, Slack…): a public list's name, owner, item count and cover photo, or a profile's avatar, username and bio. Privacy-aware: friends-only, private and archived lists get a generic card that looks just like a missing list's, and friends-only bios never show. A list's share link previews as the list whatever its visibility (the owner chose to share it), and a dead one as a missing list. Cards are cached on Vercel's CDN for a day and dropped as soon as anything on them changes.
- **Activity** — one page for what's new: your pending invitations pinned at the top, then a feed of follows, wishlist invitations, accepted invites, requests to join your lists, item-proposal activity, being demoted from owner to member of a list or removed from one, and a week's notice of an occasion on a list you're a member of. Activity's badge, in the tab bar on a phone and beside the header's Activity link on a wider screen, counts what's unread and is the one signal that something is waiting. Rows show who did it (never on a proposal, a demotion or a removal), a follow offers **Follow back** when you don't follow them yet, and a follow from several people opens your followers list. Answering an invitation marks its notification read and turns it into your answer ("You joined …" / "You declined the invite to …"). Proposal notifications are anonymous to the owner, and demotions and removals never say which owner made them. Old Invitations links (`/invites`) open Activity.
- **Notification settings** — Settings → Notifications lists each kind of notification (invitations, occasion reminders, requests to join, proposals to review, changes to your access, accepted invitations, approved proposals, new followers) with an In app switch and an Email switch, on or off by default as fits each (new followers never email). Emails say what the Activity row says and link to the same place; proposals email each owner at most once a day per list, and occasion reminders once per occasion. Every notification email ends with an Unsubscribe link, and mail apps get a one-click unsubscribe header, which turns off just that kind of email, signed in or not.

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

Open [http://localhost:3000](http://localhost:3000) (in an agent workspace, a git worktree, `npm run dev` prints the workspace's own port instead: see `scripts/dev-port.mjs`). Sign in from `/auth/signin` with your email, then click the magic link in the email, or, in console mode, copy the link from the terminal into your browser. On first sign-in an account is created with a random username (`user_…`), and you land on `/welcome`, which offers to pick your own — there is no separate admin/seed step. Each wishlist has owners (any number, all equal) and members.

## 🔑 Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable                         | Required  | Description                                                                                                                  |
| -------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`                    | yes       | Connection string **including the database name** in the path                                                                |
| `NEXTAUTH_SECRET`                | yes       | Session secret — generate with `openssl rand -base64 32`                                                                     |
| `NEXTAUTH_URL`                   | yes\*     | App URL (e.g. `http://localhost:3000`). \*Derived from `VERCEL_URL` on Vercel                                                |
| `EMAIL_TRANSPORT`                | no        | `smtp` (default) or `console` (logs mail; local/Development only). See below                                                 |
| `SMTP_HOST`                      | yes\*\*   | SMTP server host                                                                                                             |
| `SMTP_PORT`                      | yes\*\*   | SMTP port (e.g. `587`)                                                                                                       |
| `SMTP_SECURE`                    | yes\*\*   | `true` for port 465, otherwise `false`                                                                                       |
| `SMTP_USER`                      | yes\*\*   | SMTP username                                                                                                                |
| `SMTP_PASSWORD`                  | yes\*\*   | SMTP password                                                                                                                |
| `EMAIL_FROM`                     | yes       | From address for outgoing mail                                                                                               |
| `MIGRATION_SECRET`               | yes       | Shared secret guarding migration endpoints                                                                                   |
| `CRON_SECRET`                    | prod only | Vercel Cron sends it as a bearer token; without it the monthly snapshot sweep and the daily occasion reminders refuse to run |
| `BLOB_READ_WRITE_TOKEN`          | yes       | Vercel Blob token for uploads. Its store ID says which blob URLs are ours                                                    |
| `UPSTASH_REDIS_REST_URL`         | no        | Upstash Redis REST URL for rate limiting. Unset ⇒ rate limiting disabled                                                     |
| `UPSTASH_REDIS_REST_TOKEN`       | no        | Upstash Redis REST token (set together with the URL)                                                                         |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | no        | Cloudflare Turnstile site key for the sign-in form. Unset ⇒ Turnstile off. See below                                         |
| `TURNSTILE_SECRET_KEY`           | no        | Cloudflare Turnstile secret key (set together with the site key)                                                             |

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
npm run release:preview  # list commits staging is ahead of main and the tag a release would get (dry run)
npm run release          # fast-forward remote main to remote staging and tag it release-YYYY-MM-DD (operator only)
```

## 🗂️ Development workflow

Tasks live in [Linear](https://linear.app/mikitasolo) (team **Wishlist**, issue keys `WIS-…`). Each issue is worked in its own **Orca** workspace — a git worktree and branch cut from `staging`, prepared by `scripts/workspace-setup.sh` — usually by an AI agent, and lands as a pull request into `staging` that gets squash-merged. `main` is production and only ever fast-forwards to `staging` via `npm run release`, which also tags each release `release-YYYY-MM-DD` (the tag before the newest is the rollback target). The full lifecycle, status meanings, and PR conventions are in [AGENTS.md](AGENTS.md).

## 🧪 Testing

Tests live in `test/` and run on Vitest:

- `test/unit/**` — pure logic and Zod schemas (currency, slugs, filters, validation, …)
- `test/components/**` — React Testing Library (jsdom)
- `test/api/**` — route handlers against an in-memory MongoDB with a mocked session
- `e2e/**` — Playwright end-to-end smoke tests (`npm run test:e2e`). `global-setup` boots an ephemeral MongoDB, seeds a signed-in user (owner of one list, member of another) and a few unused magic links for the sign-up specs, builds and starts the app — no external services needed. Public and signed-in flows run as separate projects. Specs import `test` from `e2e/fixtures.ts`, which fails any spec whose pages throw an uncaught error or log a `console.error` that isn't allowed.

**Every change that touches logic should add or update tests, and every bug fix should add a regression test.** See [AGENTS.md](AGENTS.md) for the full policy and the API-test harness pattern, and [docs/agents/invariants.md](docs/agents/invariants.md) for the domain invariants that must not regress.

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

None is in the tree right now. These have been applied to every environment and removed; recover any of them from git history if you ever need
to replay one against a restored backup:

- the co-ownership set: `wishlist-owners`, `remove-admin-role`, `drop-legacy-owner-fields`;
- `dedupe-pending-invites`, which deduped pending invites and built the unique pending-invite index;
- `relabel-answered-invite-notifications` (WIS-255), which wrote the answer onto invite notifications answered before answers were recorded;
- `uppercase-currency-codes` (WIS-49), which uppercased the currency code of item prices and of the booking snapshots copied from them.

See [docs/agents/backend.md](docs/agents/backend.md) for the rules a new migration should follow.

The same secret guards read-only **maintenance** endpoints under `app/api/maintenance/<name>`, which stay in
the tree. `orphan-snapshots` lists the booking snapshot images (`snapshots/` in Blob) that no reservation or
gift log holds any more, older than a day, with their sizes. It deletes nothing. Vercel Cron (`crons` in `vercel.json`, production only) runs the
sweep that does delete them, `GET /api/cron/sweep-snapshots`, at 03:00 UTC on the 1st of each month: each
orphan is checked again 45 seconds later and only freed if still unheld, at most 500 per run. It needs
`CRON_SECRET`. The report:

```bash
curl -X POST -H "X-Migration-Secret: $MIGRATION_SECRET" \
  https://<your-host>/api/maintenance/orphan-snapshots
```

## 📁 Project structure

```
app/            # App Router pages + API routes (app/api/**)
components/     # React components (WishlistItem, ItemForm, Select, Skeleton, …)
lib/            # auth, mongodb, email, env, validations, hooks, utils/**
models/         # Mongoose models (User, Wishlist, Item, WishlistMember, WishlistInvite, WishlistJoinRequest,
                #   ShareLink, Reservation, GiftLog, Follow, Notification, CurrencyRate)
test/           # Vitest unit / component / api suites + helpers
e2e/            # Playwright smoke tests + global setup/teardown
types/          # shared TS types
docs/           # brand assets and their generators
```

## 🔐 Security & privacy notes

- Owner-facing views never reveal booking status (booked folds into available) — for every co-owner, not just the creator.
- Nobody can change their own role, and only an owner can grant or revoke ownership. Ownership is never applied without the recipient accepting, since it puts the list on their public profile.
- Owners can't see bookings, so being made an owner releases whatever that person had reserved — a booking is never left in a state only they could cancel but can no longer see. Owners are never told how many were released.
- User emails are never exposed to other users; invitations target registered accounts by username.
- The session (`auth()` on the server, `GET /api/auth/session` in the browser) is an explicit allowlist of the signed-in user's own fields. It never carries the session token, which the httpOnly cookie keeps away from scripts, or the rest of the user's database row.
- Archived wishlists 404 for everyone except the owners, even by direct link.
- Deleting an account (`DELETE /api/users/me`, `lib/utils/accountDeletion.ts`) erases it immediately, through the same helpers each part goes through elsewhere, never leaves a list without an owner or a booking nobody can release, and can be finished by running it again if it fails part-way.
- `friends`-only profile visibility hides the bio and the browsable wishlist list from non-friends (on the profile and in search) while keeping the profile discoverable.
- Search returns only the lists the searcher could open. It matches with `viewableWishlistsFilter`, the query form of the access check every wishlist read uses, and a table test keeps the two identical.
- Security headers (CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS) are set for every route in `next.config.js`. The CSP allows one third-party origin, `https://challenges.cloudflare.com`, for scripts and frames only (Turnstile's script and its challenge iframe).
- Migration endpoints compare their secret in constant time (`crypto.timingSafeEqual`) to avoid a timing side-channel.
- **Rate limiting** (`lib/rateLimit.ts`) guards abuse-prone surfaces — magic-link sign-in (keyed on both email and IP), uploads, invites, requests to join a list, follows, content creation, booking toggles, username checks, list URL (slug) changes, account deletion, and public search/profile lookups. It uses Upstash Redis (`@upstash/ratelimit`), so counters are shared across Vercel's ephemeral function instances. When Upstash isn't configured, limiting is **disabled** (dev/CI); when configured but the store errors or doesn't answer within `STORE_TIMEOUT_MS` (2 s), it fails **open** for reads/writes but **closed** for the sign-in email path. Each limiter that turns a request away logs one JSON line, `{"event":"rate_limited","name":"<limiter>","keyKind":"user|ip|email"}` (a Redis error or timeout logs `rate_limit_store_error` instead), so Vercel's logs show which surfaces actually hit their limits. The key itself (an email, IP or user id) is never logged. Upstash's own `analytics` option stays off, because it stores those raw keys in Redis. Turn rate limiting on by adding an Upstash Redis store via the Vercel Marketplace integration and setting the two env vars above. **New accounts** get a stricter tier on the surfaces that reach other people or cost money: for 24 hours after an account's first verified sign-in (its `createdAt`: `emailVerified` is reset on every sign-in), invites are capped at 5 an hour (normally 30), follows and new lists or items at 20 an hour (60), and uploads at 5 per 10 minutes (20). Booking, search and sign-in don't change. That tier counts under its own Redis prefix (`rl:<limiter>:new`), so an account that ages out starts on a clean standard bucket, and its blocks log and count with `"tier":"new"` (`rl:stats:<env>:<limiter>:new:<day>`). Deferred hardening (a Vercel WAF per-IP edge ceiling, per-target caps, notification coalescing) is tracked in the Linear project [Rate-limit hardening](https://linear.app/mikitasolo/project/rate-limit-hardening-5ddda788ac4f).
  - **Block counters.** Vercel keeps runtime logs only briefly (about an hour on Hobby, a day on Pro), so each block is also counted in the same Redis store, once the response has gone out: `rl:stats:<env>:<limiter>:<YYYY-MM-DD>`, per UTC day, where `env` is `VERCEL_ENV` (`local` when unset; a `.env` pulled from Vercel sets it to `development`), so dev and preview blocks never mix with production's. Each counted block costs one extra Upstash request (an `INCR` + `EXPIRE` pipeline, billed as two commands); allowed requests cost nothing extra. Only blocks Redis answered are counted: once a key is blocked, the SDK turns away its repeat requests on that instance from an in-memory cache, at no Redis cost, and counting those would let a flood from one source use up the store's command quota. So a counter reads as "times a key hit the limit", not "requests rejected". The `rate_limited` log line still covers every block. Each day's counter expires about 60 days after its last block. The counter key holds only the limiter's name, never its key. A failed or timed-out increment doesn't affect the response; it logs `rate_limit_store_error` with `"op":"count"` in place of `policy`.
  - **Reading them**: open the store in the Upstash console and filter the **Data Browser** by `rl:stats:production:*`. Each key's value is that surface's block count for that day. In the console's **CLI** tab, `SCAN 0 MATCH rl:stats:production:* COUNT 1000` lists the keys (repeat with the returned cursor until it comes back `0`), and `MGET <keys…>` reads their counts.
- **Cloudflare Turnstile on sign-in** (`lib/turnstile.ts`, on when both keys are set). The sign-in form gets a token from Turnstile's widget (rendered `interaction-only`, so most visitors never see it), and its server action (`app/auth/signin/actions.ts`) checks the token with Cloudflare's `siteverify` before anything else happens, then calls Auth.js's server-side `signIn`. That action is the only way a magic link is sent: Auth.js's own `POST /api/auth/signin/<provider>` answers 403, and a request that didn't start in the action is refused by the `signIn` callback (when the link is requested) and by `sendVerificationRequest` (before the send). An invalid or spent token is refused ("Please complete the check"), and so is a missing one, which is still put to Cloudflare: the form sends none when Turnstile's script couldn't load or run, as in a Cloudflare outage. When Cloudflare can't give a verdict (unreachable, no answer within 3 s, a 5xx, its own `internal-error`, or a secret it rejects) sign-in fails **open**, and the per-email and per-IP limiters above, which fail closed, stay the backstop. Each such case logs one `{"event":"turnstile_unavailable","reason":"…"}` line, and each refusal a `turnstile_refused` line with Cloudflare's error codes. Neither ever carries the token, the visitor's IP or the email.

## 📄 License

MIT — use freely for personal or commercial projects.

---

**Happy wishing! 🎁✨**
