# Backlog

Ideas we've discussed and deliberately deferred. Not scheduled — captured here so the design thinking isn't lost.

## Roles — follow-ups

Co-ownership shipped (see the ownership invariants in [AGENTS.md](AGENTS.md)): `Wishlist.owners[]`,
per-owner `featuredBy[]`, consent-gated promotion via an `owner` invite, the self-role-change guard,
and the retirement of the `admin` tier (a wishlist now has owners and members, nothing between). The
legacy single-owner fields and all three migrations are gone too — applied everywhere, then deleted.
What's still open:

- **Tell people when their role changes.** Being demoted from owner, or removed from a list, is
  currently silent — there's no notification type for it. Being _promoted_ is fine (they accepted an
  invite). Needs a `role_changed` / `removed_from_wishlist` notification type plus rendering in the
  notification center.
- **Transfer sole ownership.** A single owner can't hand a list over and walk away — they can invite
  a co-owner and then leave, which works but is two steps. A "transfer ownership" action might be
  worth it.
- **Cleanup on wishlist delete.** Deleting a wishlist removes items and memberships but leaves
  pending `WishlistInvite` rows behind. Harmless (the invites API skips deleted lists) but untidy.
- **Interaction with the deferred user tags/groups idea** — invite a whole "family" group as
  co-owners in one action.

## Group gifting

Let several gifters split one expensive item instead of one person booking it whole.

**Sketch**

- A reservation gains a `contributors` list and a `target`/`pledged` amount (in cents).
- Booking an item can start a "group gift": the first gifter sets a target (defaults to the item price) and pledges an amount; others can join and pledge until `pledged >= target`.
- The owner still sees only `available` (never who/how many are contributing) — the group-gift state lives entirely on the gifter side, like the existing `Reservation`.
- Mark-as-gifted becomes a group action: the item is "given" once contributions are settled; the resulting `GiftLog` records all contributors.

**Open questions**

- Money movement: do we track pledges only (honor system) or integrate real payment (Stripe)? MVP = pledges only.
- Partial/failed group gifts: if the target is never met, does it fall back to a normal single-gift reservation, or expire?
- Privacy between contributors: can gifters see each other's names/amounts?

## Occasions

Attach items (or whole wishlists) to a dated event — birthday, holiday, wedding — so gifts have a deadline and lists can resurface at the right time.

**Sketch**

- An `Occasion` = `{ owner, title, date, recurrence?: 'yearly' | null, wishlistIds }`.
- Items/wishlists can be tagged to an occasion; the booked/reservations views can group "to give" by upcoming occasion and sort by nearest date.
- Reminders: N days before an occasion, notify followers who can see the list (ties into the notification center).
- Recurring occasions (yearly birthday) pair naturally with repeatable items — reopening an item for next year's occasion.

**Open questions**

- Timezone handling for the date (store as a plain calendar date, not a timestamp).
- Do occasions drive visibility (a list only visible in its occasion window) or are they purely organizational? MVP = organizational only.
- Overlap with the "reopen repeatable item next year" flow already discussed for reservations.

## Paste-a-link item import (attempted, reverted — needs rework)

Paste a product URL and auto-fill the item form. A first version was built and
reverted because extraction was unreliable in practice: many stores block bots,
render prices client-side (so the server sees no price in the initial HTML), or
don't expose Open Graph product tags — so imports often came back with a title
and little else, or nothing.

**What worked and is worth reusing** (see the reverted commit for the code):

- An SSRF-safe server fetch: https/http only, no credentials, standard ports,
  public-IP-only with every redirect re-validated, and size/type/timeout caps.
  This part was solid and well-tested — resurrect it for any server-side fetch
  of a user URL.
- A dependency-free Open Graph / `<meta>` parser → title, image, price (cents).

**What to solve before trying again**

- **Better extraction.** Parse JSON-LD `Product`/`Offer` schema (where most real
  prices live) in addition to OG tags; consider microdata. Fall back gracefully
  and fill only what's found rather than failing.
- **JS-rendered pages.** Static HTML misses a lot. Evaluate a rendering/scraping
  service (or oEmbed/unfurl APIs) vs. the cost/complexity — or accept that we
  only support sites with good static metadata and set expectations in the UI.
- **Bot blocking.** Realistic UA, timeouts, and a clear "couldn't read this page"
  message; don't hang the form.
- **Abuse.** Per-user rate limit via `enforce()` in `lib/rateLimit.ts` (add a
  `SPECS` entry, e.g. 10 / 10 min per user) since this makes the server fetch
  arbitrary URLs.
- **Residual SSRF.** Close the DNS-rebinding window by pinning the connection to
  the validated IP (custom lookup/dispatcher), not just checking DNS beforehand.

## Rough ideas — needs refinement

Captured for later; each still needs a real problem statement and design before it's worth building. Listed as prompts, not commitments.

- **Complex / linked items.** Items that belong together — a drill and the bits for it, a console and an extra controller. Would let an owner group related items and a gifter see "this pairs with X." Open: is this a parent/child relation, a soft tag, or just a note? Does booking one affect the others? _Unsure it's worth the complexity._
- **Wishlist themes.** Per-wishlist visual themes (color/typography/cover style) beyond the current cover image. Open: preset themes vs. free customization; how it interacts with the app's light/dark theming without hurting readability. _Unsure it earns its keep._
- **User tags / groups** (e.g. "family", "close friends"). Let a user bucket the people they follow/know, then act on a whole group at once — invite the group to co-manage a list, or scope visibility to a group. Open: overlaps with the existing `friends` axis and per-wishlist visibility; needs a clear model so it doesn't become a third confusing privacy dimension. Ties into invites and (future) occasions.
- **Add someone else's item to your own wishlist.** "I want that too" — copy an item you saw on another list onto yours. Open: copy the snapshot vs. link back to the source; what happens when the source changes or is deleted; attribution/privacy. _Needs refinement._
- **Share one item across multiple wishlists (1-to-many).** Today an item belongs to exactly one wishlist. Move to a model where the same item can appear on several of a user's lists (e.g. a "birthday" and a "general" list). Open: this is a data-model change (`Item.wishlist` → a join or an array); booking/reservation semantics when the same item is on multiple lists; how the owner edits it in one place. Larger refactor — scope carefully before starting.

## Rate limiting — deferred hardening

The app-level rate limiter (`lib/rateLimit.ts`, Upstash-backed) is implemented and applied to the abuse-prone routes. These complementary layers from the original plan were deliberately left out of that pass — each needs either an external account/infra step or ties into other work:

- **Cloudflare Turnstile (or hCaptcha) on the sign-in form.** The cheapest big win against automated email-bombing, pairs with the per-email/IP sign-in limit. Deferred because it needs a Cloudflare account + site/secret keys and a widget in the sign-in UI (managed/invisible mode to keep friction near zero) plus server-side token verification.
- **Vercel WAF coarse per-IP edge ceiling** (e.g. 100 req / 10 s). Absorbs floods before they reach functions. Pure dashboard/infra config, independent of app code.
- **Per-target caps (not just per-actor rates).** E.g. at most _N pending invites per invitee_ across all inviters; same idea for follow notifications. Stops the _effect_ reaching a victim regardless of how many actors/IPs are used. Lean on the existing unique indexes for dedupe.
- **Notification coalescing.** Collapse "X and 3 others followed you" so even lawful bursts don't flood the notification center; a spammer then produces one line, not fifty. Ties into the notification-center work.
- **New-account friction.** Lower limits for accounts younger than ~24h (most abuse is throwaway accounts), relaxed automatically after age/activity.

Limit values in `SPECS` are starting points — tune them from real traffic/logs once Upstash is live.

## Rethink wishlist & people search

The header search (and the landing-page search block) need a clearer model. Open questions before building:

- **Scope:** should search cover _all_ wishlists in the system, or only those visible/available to the searcher (respecting privacy/visibility)? Likely the latter, but confirm.
- **Ranking:** should results tied to the searcher — friends, people they follow, their followers — rank above strangers? A "people you know first" ordering.
- **Landing page:** the logged-out landing page has its own search block at the bottom; search is also in the header. Do we drop the landing-page one as redundant, or is it a deliberate entry point for first-time visitors?

## Compute the default currency instead of hardcoding USD

Today new users / wishlists default to `USD`. Questions:

- Do we even need this, or is USD a fine default? (Weigh against added complexity.)
- If we compute it, what to rely on? Options: the browser's `Intl`/locale (`navigator.language` → region → currency), `Accept-Language` server-side, IP geolocation, or an explicit onboarding choice. Each has accuracy/privacy tradeoffs. A safe path: infer a suggested default from locale, but always let the user override in settings.

## "Discreet mode" — hide booked status on demand

A user-toggleable mode that stops the UI from revealing booking status, so someone glancing at your screen (the very person you're gifting) can't see what's been booked and get spoiled. Open questions:

- Scope: per-session toggle in the header, or a persisted user setting? Probably an ephemeral toggle (like an incognito switch) that defaults off.
- What it hides: the "booked" badges / "booked by you" markers on items you're viewing, collapsing them back to "available" client-side. It's a _display_ guard, not a privacy/authorization change (the data still comes down; consider whether that's acceptable or if it should be server-enforced when enabled).
- Interaction with the "Reserved by you" page, which is inherently a list of your bookings — hide/blur there too, or leave it (you'd only open it deliberately)?
