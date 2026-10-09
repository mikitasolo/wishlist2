/**
 * Discreet mode (WIS-46): a device-level switch that keeps reservations off
 * the screen, for when the person you're gifting glances at it. It is display
 * only: the data still arrives and nothing server-side changes, so every
 * surface applies it while it renders (never to what was fetched, so the
 * list's 5s poll can't bring the real state back).
 */
import type { ApiItem } from '@/types/api';

/** localStorage key of the switch ("1" = on; absent = off, the default). */
export const DISCREET_STORAGE_KEY = 'discreet-mode';

/** Whether a stored value means on. */
export function parseDiscreet(stored: string | null | undefined): boolean {
  return stored === '1';
}

/**
 * The item as discreet mode draws it: a reserved item is plain available (no
 * badge, tone, dimming or sort position of its own), and nothing says who
 * reserved it, that it was given or that it's a group gift. Any other item is
 * returned as is.
 */
export function withoutReservation<T extends Pick<ApiItem, 'status' | 'bookedBy'>>(item: T): T {
  if (item.status !== 'booked') return item;
  return {
    ...item,
    status: 'available',
    bookedBy: null,
    givenByMe: undefined,
    groupGift: undefined,
  };
}
