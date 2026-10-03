'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { withRequestTimeout } from '@/lib/utils/requestTimeout';

/**
 * How long the dashboard waits for its count of changed reservations before it
 * gives up and leaves the row out: a few reads on a cold server take a few
 * seconds, and nothing waits on this one.
 */
export const SUMMARY_TIMEOUT_MS = 10_000;

/**
 * How many of the signed-in account's own reservations need their confirmation
 * (`GET /api/users/me/reservations/summary`, the Booked page's "Needs your
 * confirmation" counted), for the dashboard's "Needs you". `null` until it's
 * read, and when the read fails or takes longer than `SUMMARY_TIMEOUT_MS`: the
 * row is then left out, never shown as 0. Read again when another account
 * signs in, and an answer for the previous one is dropped.
 */
export function useChangedReservations(): number | null {
  const { data: session, status } = useSession();
  const userId = status === 'authenticated' ? (session?.user?.id ?? null) : null;
  const [read, setRead] = useState<{ userId: string; changed: number } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let current = true;
    withRequestTimeout(async (signal) => {
      const res = await fetch('/api/users/me/reservations/summary', {
        cache: 'no-store',
        signal,
      });
      return res.json();
    }, SUMMARY_TIMEOUT_MS)
      .then((result) => {
        if (!current) return;
        const changed = result?.success ? result.data?.changed : undefined;
        if (typeof changed !== 'number') throw new Error('Unreadable summary');
        setRead({ userId, changed });
      })
      .catch(() => {
        // Left out: the row hides itself rather than claim there's nothing.
        if (current) setRead(null);
      });
    return () => {
      current = false;
    };
  }, [userId]);

  return read && read.userId === userId ? read.changed : null;
}
