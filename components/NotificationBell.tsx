'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import Icon from '@/components/Icon';

/**
 * Header bell with an unread-count badge, linking to the notifications page.
 * Freshness without polling: refresh on mount, on tab focus, and when a page
 * dispatches a `notifications-changed` event (e.g. after marking all read).
 */
export default function NotificationBell() {
  const { status } = useSession();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications', { cache: 'no-store' });
      const json = await res.json();
      if (json.success) setUnread(json.unreadCount ?? 0);
    } catch {
      /* best-effort — the badge is not critical */
    }
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') {
      setUnread(0);
      return;
    }
    refresh();
    const onRefresh = () => refresh();
    window.addEventListener('focus', onRefresh);
    window.addEventListener('notifications-changed', onRefresh);
    return () => {
      window.removeEventListener('focus', onRefresh);
      window.removeEventListener('notifications-changed', onRefresh);
    };
  }, [status, refresh]);

  if (status !== 'authenticated') return null;

  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `Notifications — ${unread} unread` : 'Notifications'}
      title="Notifications"
      className="relative flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground shadow-xs transition-colors hover:bg-surface-hover hover:text-foreground"
    >
      <Icon name="bell" size={20} />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-surface">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}
