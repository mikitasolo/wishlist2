// Client-safe classification of a gifter's reservations for the "Reserved by
// you" page. The API (app/api/users/me/reservations) returns each reservation's
// live `itemStatus` and whether it's `stillReserved` by this gifter; these
// helpers turn that into UI grouping and copy.

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
