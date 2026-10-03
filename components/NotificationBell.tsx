'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import Icon from '@/components/Icon';
import { iconButtonClassName, ICON_BUTTON_ICON_SIZE } from '@/components/buttonStyles';

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
      className={`relative ${iconButtonClassName({ variant: 'chrome', size: 'md', shape: 'pill' })}`}
    >
      <Icon name="bell" size={ICON_BUTTON_ICON_SIZE} />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-badge font-semibold text-white ring-2 ring-surface">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}
