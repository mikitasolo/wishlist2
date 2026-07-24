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
