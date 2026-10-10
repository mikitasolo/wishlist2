'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import { useRefreshOnReturn } from '@/lib/hooks/useLiveRead';

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
 * account does, then again on every return (`useRefreshOnReturn`) and on `UNREAD_REFRESH_EVENTS`.
 * Visiting Activity marks everything read and fires `notifications-changed`,
 * so the badge clears there.
 *
 * Keyed on the user id, not just the session status (WIS-187): when another
 * account signs in from another tab, `status` stays `authenticated`, so the
 * read is redone for the new account, and the count is tagged with the account
 * it was read for, so the previous account's never shows for the new one, not
 * even from a read still on its way for it. Reads are numbered, and one that
 * lands after a newer one is dropped. A read that fails keeps the count: the
 * badge is best-effort. Through an `update()` (the session goes back through
 * `loading` but stays known) the count stays up until the next read.
 */
export function useUnreadNotifications(): number {
  const { data: session, status } = useKnownSession();
  const userId = session?.user?.id ?? null;
  const [unread, setUnread] = useState<{ account: string | null; count: number }>({
    account: null,
    count: 0,
  });
  // The number of the latest read sent, and of the latest that landed: a read
  // numbered at or below `landed` is outdated when it lands.
  const sent = useRef(0);
  const landed = useRef(0);
  // The account the reads are for.
  const account = useRef(userId);

  // Another account signed in: every read sent so far was for the previous one.
  useLayoutEffect(() => {
    account.current = userId;
    landed.current = sent.current;
  }, [userId]);

  const refresh = useCallback(async () => {
    const read = ++sent.current;
    const forAccount = account.current;
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      const json = await res.json();
      if (!json.success || read <= landed.current || account.current !== forAccount) return;
      landed.current = read;
      setUnread({ account: forAccount, count: json.unreadCount ?? 0 });
    } catch {
      /* best-effort: the count it has stays up */
    }
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const onRefresh = () => void refresh();
    onRefresh();
    for (const event of UNREAD_REFRESH_EVENTS) window.addEventListener(event, onRefresh);
    return () => {
      for (const event of UNREAD_REFRESH_EVENTS) window.removeEventListener(event, onRefresh);
    };
  }, [status, userId, refresh]);
  const refreshOnReturn = useCallback(() => void refresh(), [refresh]);
  useRefreshOnReturn(refreshOnReturn, status === 'authenticated');

  return userId !== null && unread.account === userId ? unread.count : 0;
}
