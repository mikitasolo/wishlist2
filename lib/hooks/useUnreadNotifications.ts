'use client';

import { useCallback, useEffect } from 'react';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import { useLiveRead } from '@/lib/hooks/useLiveRead';

/**
 * Window events that have the count read again, besides a return to the tab:
 * `notifications-changed` (Activity marked everything read, an invite's answer
 * marked its notification read) and `invites-changed` (an invite was answered
 * or went away, here or in another tab).
 */
export const UNREAD_REFRESH_EVENTS = ['notifications-changed', 'invites-changed'] as const;

/**
 * How many of the signed-in account's notifications are unread: the count
 * Activity's badge shows, in the phone's tab bar and in the header's link
 * (WIS-302). `AppHeader` calls it once and hands the count to both, so there is
 * one reader per page, not one per badge.
 *
 * Kept fresh without polling: read when someone signs in and whenever another
 * account does, then again on every return (`useLiveRead`, no timer) and on
 * `UNREAD_REFRESH_EVENTS`.
 * Visiting Activity marks everything read and fires `notifications-changed`,
 * so the badge clears there.
 *
 * Keyed on the user id, not just the session status (WIS-187): when another
 * account signs in from another tab, `status` stays `authenticated`, so the
 * read is redone for the new account, and the previous account's count goes
 * in that render (`resetOnNewRead`), never shown for the new one, not even
 * from a read still on its way for it. A read that lands after a newer one is
 * dropped. A read that fails keeps the count: the
 * badge is best-effort. Through an `update()` (the session goes back through
 * `loading` but stays known) the count stays up until the next read.
 */
export function useUnreadNotifications(): number {
  const { data: session, status } = useKnownSession();
  const userId = session?.user?.id ?? null;
  const enabled = status === 'authenticated';

  // Keyed on the account. An answer that isn't a success is neither a count
  // nor a failure: the count stays.
  const read = useCallback(
    async (stamp: () => number) => {
      if (!userId) return null;
      const sentAt = stamp();
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      const json = await res.json();
      return json.success ? { data: (json.unreadCount ?? 0) as number, sentAt } : null;
    },
    [userId]
  );
  // Best-effort: a failed read keeps the count it has (initially none).
  const { data: count, refresh } = useLiveRead<number>({
    enabled: enabled && userId !== null,
    initialData: 0,
    read,
    resetOnNewRead: true,
  });

  useEffect(() => {
    if (!enabled) return;
    const onRefresh = () => void refresh(true);
    for (const event of UNREAD_REFRESH_EVENTS) window.addEventListener(event, onRefresh);
    return () => {
      for (const event of UNREAD_REFRESH_EVENTS) window.removeEventListener(event, onRefresh);
    };
  }, [enabled, refresh]);

  return userId !== null ? count : 0;
}
