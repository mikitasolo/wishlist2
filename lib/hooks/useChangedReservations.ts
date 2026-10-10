'use client';

import { useCallback } from 'react';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import { useLiveRead } from '@/lib/hooks/useLiveRead';
import { withRequestTimeout } from '@/lib/utils/requestTimeout';

/**
 * How long the dashboard waits for its count of changed reservations before it
 * gives up on that read: a few reads on a cold server take a few seconds, and
 * nothing waits on this one.
 */
export const SUMMARY_TIMEOUT_MS = 10_000;

/**
 * How many of the signed-in account's own reservations need their confirmation
 * (`GET /api/users/me/reservations/summary`, the Booked page's "Needs your
 * confirmation" counted), for the dashboard's "Needs you".
 *
 * `null` until it's first read, and while the first read fails or takes longer
 * than `SUMMARY_TIMEOUT_MS`: the row is then left out, never shown as 0. Read
 * again whenever the viewer comes back (`useLiveRead`, no timer: an owner may
 * have received an item meanwhile), and a read that fails then keeps the count already shown.
 * Read afresh when another account signs in, and an answer for the previous one
 * is dropped.
 */
export function useChangedReservations(): number | null {
  const { data: session, status } = useKnownSession();
  const userId = status === 'authenticated' ? (session?.user?.id ?? null) : null;

  // Keyed on the account (a new one is a new read, and the last one's count
  // goes at once). An answer that isn't a count is neither shown nor a failure:
  // the row stays as it was.
  const read = useCallback(
    async (stamp: () => number) => {
      if (!userId) return null;
      const sentAt = stamp();
      const result = await withRequestTimeout(async (signal) => {
        const res = await fetch('/api/users/me/reservations/summary', {
          cache: 'no-store',
          signal,
        });
        return res.json();
      }, SUMMARY_TIMEOUT_MS);
      const changed = result?.success ? result.data?.changed : undefined;
      return typeof changed === 'number' ? { data: changed as number | null, sentAt } : null;
    },
    [userId]
  );

  // A failed read leaves the count as it was: the row hides itself until a
  // read succeeds, rather than claim there's nothing, and one already shown stays.
  const { data } = useLiveRead<number | null>({
    enabled: userId !== null,
    initialData: null,
    read,
    resetOnNewRead: true,
  });
  return userId ? data : null;
}
