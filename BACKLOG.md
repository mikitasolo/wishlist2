# Backlog

Ideas we've discussed and deliberately deferred. Not scheduled — captured here so the design thinking isn't lost.

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

## Rough ideas — needs refinement

Captured for later; each still needs a real problem statement and design before it's worth building. Listed as prompts, not commitments.

- **Complex / linked items.** Items that belong together — a drill and the bits for it, a console and an extra controller. Would let an owner group related items and a gifter see "this pairs with X." Open: is this a parent/child relation, a soft tag, or just a note? Does booking one affect the others? _Unsure it's worth the complexity._
- **Wishlist themes.** Per-wishlist visual themes (color/typography/cover style) beyond the current cover image. Open: preset themes vs. free customization; how it interacts with the app's light/dark theming without hurting readability. _Unsure it earns its keep._
- **User tags / groups** (e.g. "family", "close friends"). Let a user bucket the people they follow/know, then act on a whole group at once — invite the group to co-manage a list, or scope visibility to a group. Open: overlaps with the existing `friends` axis and per-wishlist visibility; needs a clear model so it doesn't become a third confusing privacy dimension. Ties into invites and (future) occasions.
- **Add someone else's item to your own wishlist.** "I want that too" — copy an item you saw on another list onto yours. Open: copy the snapshot vs. link back to the source; what happens when the source changes or is deleted; attribution/privacy. _Needs refinement._
- **Share one item across multiple wishlists (1-to-many).** Today an item belongs to exactly one wishlist. Move to a model where the same item can appear on several of a user's lists (e.g. a "birthday" and a "general" list). Open: this is a data-model change (`Item.wishlist` → a join or an array); booking/reservation semantics when the same item is on multiple lists; how the owner edits it in one place. Larger refactor — scope carefully before starting.
