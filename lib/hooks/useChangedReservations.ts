'use client';

import { useEffect, useState } from 'react';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
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
 * again whenever the window comes back into focus (an owner may have received
 * an item meanwhile), and a read that fails then keeps the count already shown.
 * Read afresh when another account signs in, and an answer for the previous one
 * is dropped.
 */
export function useChangedReservations(): number | null {
  const { data: session, status } = useKnownSession();
  const userId = status === 'authenticated' ? (session?.user?.id ?? null) : null;
  const [read, setRead] = useState<{ userId: string; changed: number } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let current = true;
    // The latest read sent: an earlier one landing after it is dropped.
    let latest = 0;
    const load = () => {
      const sent = ++latest;
      withRequestTimeout(async (signal) => {
        const res = await fetch('/api/users/me/reservations/summary', {
          cache: 'no-store',
          signal,
        });
        return res.json();
      }, SUMMARY_TIMEOUT_MS)
        .then((result) => {
          if (!current || sent !== latest) return;
          const changed = result?.success ? result.data?.changed : undefined;
          if (typeof changed !== 'number') return;
          setRead({ userId, changed });
        })
        // Left as it was: the row hides itself until a read succeeds, rather
        // than claim there's nothing, and one already shown stays.
        .catch(() => {});
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      current = false;
      window.removeEventListener('focus', load);
    };
  }, [userId]);

  return read && read.userId === userId ? read.changed : null;
}
