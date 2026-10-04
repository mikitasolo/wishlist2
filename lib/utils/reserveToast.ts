/** Copy and first-time flag for the toast that confirms a reservation (WIS-260). */

export const RESERVE_TOAST_SEEN_KEY = 'reserveToastSeen';

/** Where the gifter finds what they've reserved. */
export const RESERVED_PATH = '/booked';

export const RESERVE_VIEW_LABEL = 'View';

/**
 * The short toast, shown after the first time. Only the gifter ever sees it,
 * and it names no one who reserved anything.
 */
export const RESERVE_TOAST_SHORT = "Reserved — it's in Reserved by you";

/**
 * The longer first-time toast: what reserving means. `ownerUsernames` are the
 * list's owners' public usernames: one owner is named, several (or none we can
 * name) are "the owners".
 */
export function reserveToastLong(ownerUsernames: readonly string[]): string {
  const names = ownerUsernames.filter(Boolean);
  const who = names.length === 1 ? `@${names[0]}` : 'the owners';
  return `Reserved. ${who} won't see it; others on the list see it's taken.`;
}

/**
 * The toast text for this reservation. The long one is used once per browser:
 * reading it also marks it seen. Storage can throw (private windows), in which
 * case the short copy is used rather than nagging every time.
 */
export function takeReserveToastCopy(ownerUsernames: readonly string[]): string {
  try {
    if (window.localStorage.getItem(RESERVE_TOAST_SEEN_KEY) === null) {
      window.localStorage.setItem(RESERVE_TOAST_SEEN_KEY, '1');
      return reserveToastLong(ownerUsernames);
    }
  } catch {
    /* no storage: the short copy */
  }
  return RESERVE_TOAST_SHORT;
}
