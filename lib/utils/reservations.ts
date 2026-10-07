// Client-safe classification of a gifter's reservations for the "Reserved by
// you" page. The API (app/api/users/me/reservations) returns each reservation's
// live `itemStatus`, whether it's `stillReserved` by this gifter, whether
// they can still open its list (`listOpen`), and whether that list is archived
// (`listArchived`); these helpers turn that into UI grouping and copy.

import { convertPrice, normalizeCurrency } from '@/lib/utils/currency';
import { NO_UPCOMING_OCCASION, occasionSortKey, type Occasion } from '@/lib/utils/occasion';

export interface ReservationStatusInfo {
  /** The live item's status: `null` on a list the gifter can't open, which shows none. */
  itemStatus: string | null;
  /** The live item is still booked by the gifter: `null` on a list they can't open. */
  stillReserved: boolean | null;
  /**
   * The gifter can still open the reservation's list. Only their own access:
   * never why they can't, except that an archived list says so (`listArchived`).
   * One they can't open is frozen (WIS-124, WIS-295): its snapshot only.
   */
  listOpen: boolean;
  /**
   * The list is archived, and so out of the gifter's reach. The reservation is
   * frozen: shown as its snapshot only, with nothing live of the list or the
   * item (`itemStatus` and `stillReserved` are `null`), until it's unarchived.
   */
  listArchived: boolean;
}

/**
 * A reservation "needs confirmation" when the live item is no longer actively
 * reserved by the gifter — the owner completed / removed / drafted it, someone
 * else took it, or the gifter left or was removed from the wishlist — or when
 * it still is, but on a list the gifter can no longer open. The list's own
 * unbook (Release) refuses anyone the list is hidden from, so that booking can
 * only be released by an owner. That includes one on an archived list, which
 * isn't open to them and says nothing of its item. In every such case the durable Reservation
 * lingers (by design), so we prompt the gifter to resolve it: log the gift or
 * dismiss it, keeping their history accurate without ever mutating the owner's
 * item.
 */
export function needsConfirmation(r: ReservationStatusInfo): boolean {
  return !r.stillReserved || !r.listOpen;
}

/**
 * Why a reservation needs the gifter's confirmation, phrased for them. Returns
 * null while the reservation is still active (no note needed).
 */
export function reservationNote(r: ReservationStatusInfo): string | null {
  // Frozen: there's no live item to say anything of, only the list's state.
  if (r.listArchived) return 'This list was archived';
  // Any other list they can't open: say only that, never why (WIS-295).
  if (!r.listOpen) return 'This list is no longer available to you';
  if (r.stillReserved) return null;
  switch (r.itemStatus) {
    case 'deleted':
      return 'The owner removed this item';
    case 'completed':
      return 'The owner marked this received';
    case 'draft':
      return 'The owner moved this to draft';
    default:
      return 'No longer reserved to you';
  }
}

/**
 * Split reservations into the ones that need the gifter's confirmation and the
 * ones still actively reserved. Order within each group is preserved.
 */
export function partitionReservations<T extends ReservationStatusInfo>(
  list: T[]
): { needsConfirm: T[]; active: T[] } {
  const needsConfirm: T[] = [];
  const active: T[] = [];
  for (const r of list) {
    if (needsConfirmation(r)) needsConfirm.push(r);
    else active.push(r);
  }
  return { needsConfirm, active };
}

/** What `groupByOccasion` reads of a reservation: its list, and that list's live occasion. */
export interface OccasionGroupable {
  wishlistId: string;
  wishlistName: string;
  /**
   * The list's occasion as the API last gave it: `null` (or absent) for a list
   * with none, and for one the gifter can no longer see.
   */
  wishlistOccasion?: Occasion | null;
}

/** The key of the group of reservations with nothing coming up ("No date"). */
export const NO_DATE_GROUP = 'no-date';

/** A list's reservations under its upcoming occasion. */
export interface DatedGroup<T> {
  /** The list and its occasion: the same from one read to the next while the occasion is. */
  key: string;
  occasion: Occasion;
  /** The list's name, as the group's first reservation has it. */
  wishlistName: string;
  reservations: T[];
}

/** A list's reservations under its upcoming occasion, or the "No date" rest. */
export type OccasionGroup<T> =
  | DatedGroup<T>
  | { key: typeof NO_DATE_GROUP; occasion: null; wishlistName: null; reservations: T[] };

/**
 * Groups the gifts still to give by when they're needed: one group per list
 * with an occasion coming up, the nearest first (`occasionSortKey`; lists on
 * the same day by name), then one "No date" group for the rest, which have no
 * occasion, one that has passed, or one hidden from the gifter. Reservations
 * keep their order within a group, and no group is empty.
 *
 * A group is a list *and* its occasion. Every card on a list has the same one,
 * except a card whose action is in flight when a read lands: it keeps the copy
 * the page had (`mergeRefreshedList`'s `held`), so it stays under the date it
 * was shown with while its siblings move to the new one, each under its own.
 *
 * `today` is the viewer's local date (`useLocalToday`); until it's known
 * (`null`), everything is in the "No date" group, in its order.
 */
export function groupByOccasion<T extends OccasionGroupable>(
  list: readonly T[],
  today: string | null
): OccasionGroup<T>[] {
  const dated = new Map<string, { group: DatedGroup<T>; sortKey: number }>();
  const undated: T[] = [];
  for (const r of list) {
    const occasion = r.wishlistOccasion ?? null;
    const sortKey = today ? occasionSortKey(occasion, today) : NO_UPCOMING_OCCASION;
    if (!occasion || sortKey === NO_UPCOMING_OCCASION) {
      undated.push(r);
      continue;
    }
    const key = [r.wishlistId, occasion.kind, occasion.date, occasion.recurrence].join(' ');
    const entry = dated.get(key);
    if (entry) entry.group.reservations.push(r);
    else {
      const group = { key, occasion, wishlistName: r.wishlistName, reservations: [r] };
      dated.set(key, { group, sortKey });
    }
  }

  const groups: OccasionGroup<T>[] = Array.from(dated.values())
    .sort(
      (a, b) =>
        a.sortKey - b.sortKey ||
        a.group.wishlistName.localeCompare(b.group.wishlistName) ||
        (a.group.key < b.group.key ? -1 : a.group.key > b.group.key ? 1 : 0)
    )
    .map(({ group }) => group);
  if (undated.length > 0) {
    groups.push({ key: NO_DATE_GROUP, occasion: null, wishlistName: null, reservations: undated });
  }
  return groups;
}

/**
 * The main action on a card that needs the gifter's confirmation, picked from
 * what happened to it (WIS-263): `'gave'` (Mark as given, as "I gave it") when
 * the gift most likely went ahead, `'dismiss'` (Dismiss, with "I gave it
 * anyway" beside it) when it most likely didn't.
 *
 * - The owner marked it received: they've had it, so most likely from the gifter.
 * - Removed, moved to draft, or reserved by someone else now: most likely not.
 * - Frozen on an archived list: nothing says it didn't go ahead, so it's
 *   still the gift they reserved.
 * - Frozen on a list they can't open for any other reason (WIS-295): most
 *   often they left or were removed, which frees the booking, so most likely
 *   not. It says nothing of the item, so it can't tell.
 */
export function changedCardPrimary(r: ReservationStatusInfo): 'gave' | 'dismiss' {
  if (r.listArchived) return 'gave';
  if (!r.listOpen) return 'dismiss';
  if (r.stillReserved) return 'gave';
  return r.itemStatus === 'completed' ? 'gave' : 'dismiss';
}

/** A price in cents, in a currency of any case. */
interface PriceLike {
  value: number;
  currency: string;
}

/**
 * The sum of `prices` in `currency` (D9), for the Reserved page's "≈ €520 to
 * give": `approx` when any of them was converted at the day's rate. `null`
 * when nothing is priced, or when a price can't be converted (no rates yet,
 * or none for its currency), since a total that left one out would be wrong.
 */
export function totalInCurrency(
  prices: readonly (PriceLike | null)[],
  currency: string,
  rates: Record<string, number> | null
): { price: PriceLike; approx: boolean } | null {
  const target = normalizeCurrency(currency);
  let sum = 0;
  let approx = false;
  let any = false;
  for (const p of prices) {
    if (!p) continue;
    any = true;
    if (normalizeCurrency(p.currency) === target) {
      sum += p.value;
      continue;
    }
    const converted = rates ? convertPrice(p, target, rates) : null;
    if (!converted) return null;
    sum += converted.value;
    approx = true;
  }
  return any ? { price: { value: Math.round(sum), currency: target }, approx } : null;
}
