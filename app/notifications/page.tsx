'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Icon from '@/components/Icon';
import { useToast } from '@/components/ToastProvider';
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
  const { showToast } = useToast();
  const [items, setItems] = useState<NotificationView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
  }, [status, router]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/notifications', { cache: 'no-store' });
        const json = await res.json();
        if (json.success) {
          setItems(json.data);
          // Visiting the page clears the unread badge.
          if ((json.unreadCount ?? 0) > 0) {
            await fetch('/api/notifications', { method: 'PATCH' });
            window.dispatchEvent(new Event('notifications-changed'));
          }
        } else {
          showToast('Failed to load notifications', 'error');
        }
      } catch {
        showToast('Failed to load notifications', 'error');
      } finally {
        setLoading(false);
      }
    }
    if (status === 'authenticated') load();
  }, [status, showToast]);

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
                <div className="skeleton h-10 w-10 flex-shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <div className="skeleton h-4 w-3/4 rounded-md" />
                  <div className="skeleton h-3 w-1/4 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="mt-8 flex flex-col items-center rounded-3xl border border-dashed border-border-strong py-16 text-center">
            <span className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-3xl bg-primary-500/12 text-accent dark:text-primary-300">
              <Icon name="bell" size={30} />
            </span>
            <h3 className="text-xl font-semibold text-foreground">You’re all caught up</h3>
            <p className="mx-auto mt-2 max-w-sm px-4 text-[15px] text-muted-foreground">
              When someone follows you, invites you to a wishlist, or acts on a proposal, it’ll show
              up here.
            </p>
          </div>
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
                    <span className="block text-[15px] text-foreground">
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
