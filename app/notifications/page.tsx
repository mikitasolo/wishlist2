'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Icon from '@/components/Icon';
import EmptyState from '@/components/EmptyState';
import LoadError from '@/components/LoadError';
import { Skeleton } from '@/components/Skeleton';
import { signInPath } from '@/lib/utils/callbackUrl';
import {
  type NotificationView,
  notificationParts,
  notificationLink,
  notificationIcon,
} from '@/lib/utils/notifications';

/** A notification's line, with any list's name in semibold. */
function NotificationLine({ n }: { n: NotificationView }) {
  return (
    <>
      {notificationParts(n).map((part, i) =>
        typeof part === 'string' ? (
          part
        ) : (
          <span key={i} className="font-semibold">
            {part.listName}
          </span>
        )
      )}
    </>
  );
}

/** Compact relative time, e.g. "just now", "3h ago", "2d ago". */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function NotificationsPage() {
  const { data: session, status } = useSession();
  const viewerUsername = session?.user?.username ?? null;
  const router = useRouter();
  const [items, setItems] = useState<NotificationView[]>([]);
  const [loading, setLoading] = useState(true);
  // The feed couldn't be read: said in place, with Try again (`attempt`),
  // never as "You're all caught up".
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(signInPath('/notifications'));
  }, [status, router]);

  useEffect(() => {
    // A read outdated by another (Try again, the session changed) is dropped.
    let current = true;
    async function load() {
      let feed: { data: NotificationView[]; unreadCount?: number };
      try {
        const res = await fetch('/api/notifications', { cache: 'no-store' });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Failed to load notifications');
        feed = json;
      } catch {
        if (current) {
          setLoadFailed(true);
          setLoading(false);
        }
        return;
      }
      if (!current) return;
      setItems(feed.data);
      setLoadFailed(false);
      setLoading(false);
      // Visiting the page clears the unread badge. If that fails, the badge
      // stays, and the next visit clears it: the feed itself is on screen.
      if ((feed.unreadCount ?? 0) > 0) {
        try {
          await fetch('/api/notifications', { method: 'PATCH' });
          window.dispatchEvent(new Event('notifications-changed'));
        } catch {
          /* see above */
        }
      }
    }
    if (status === 'authenticated') load();
    return () => {
      current = false;
    };
  }, [status, attempt]);

  const retryLoad = useCallback(() => {
    setLoadFailed(false);
    setLoading(true);
    setAttempt((n) => n + 1);
  }, []);

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Notifications</h1>
        <p className="mt-1 text-muted-foreground">
          Follows, invitations, changes to your role on a wishlist, and updates on items you
          proposed or were proposed to you.
        </p>

        {loading ? (
          <div className="mt-8 space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4"
              >
                <Skeleton className="h-10 w-10 flex-shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : loadFailed ? (
          <div className="mt-8">
            <LoadError title="Couldn’t load notifications" onRetry={retryLoad} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            className="mt-8"
            icon="bell"
            title="You’re all caught up"
            body="When someone follows you, invites you to a wishlist, or acts on a proposal, it’ll show up here."
          />
        ) : (
          <ul className="mt-8 space-y-2">
            {items.map((n) => {
              const href = notificationLink(n, viewerUsername);
              const className = `flex items-center gap-3 rounded-2xl border p-4 ${
                n.read ? 'border-border bg-surface' : 'border-primary-500/40 bg-primary-500/5'
              }`;
              const content = (
                <>
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">
                    <Icon name={notificationIcon(n)} size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body text-foreground">
                      <NotificationLine n={n} />
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {relativeTime(n.createdAt)}
                    </span>
                  </span>
                  {!n.read && (
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full bg-primary-500"
                      aria-label="Unread"
                    />
                  )}
                </>
              );
              return (
                <li key={n._id}>
                  {/* No link: a removal or a declined invite, whose list they may not see. */}
                  {href ? (
                    <Link href={href} className={`${className} transition-colors hover:bg-muted`}>
                      {content}
                    </Link>
                  ) : (
                    <div className={className}>{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
