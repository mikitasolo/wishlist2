// Client-safe classification of a gifter's reservations for the "Reserved by
// you" page. The API (app/api/users/me/reservations) returns each reservation's
// live `itemStatus` and whether it's `stillReserved` by this gifter; these
// helpers turn that into UI grouping and copy.

import { NO_UPCOMING_OCCASION, occasionSortKey, type Occasion } from '@/lib/utils/occasion';

export interface ReservationStatusInfo {
  itemStatus: string;
  stillReserved: boolean;
}

/**
 * A reservation "needs confirmation" when the live item is no longer actively
 * reserved by the gifter — the owner completed / removed / drafted it, someone
 * else took it, or the gifter left or was removed from the wishlist. In every
 * such case the durable Reservation lingers (by design), so we prompt the
 * gifter to resolve it: log the gift or dismiss it, keeping their history
 * accurate without ever mutating the owner's item.
 */
export function needsConfirmation(r: ReservationStatusInfo): boolean {
  return !r.stillReserved;
}

/**
 * Why a reservation detached from its item, phrased for the gifter. Returns
 * null while the reservation is still active (no note needed).
 */
export function reservationNote(r: ReservationStatusInfo): string | null {
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
