'use client';

import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import FollowListModal from '@/components/FollowListModal';
import Icon from '@/components/Icon';
import InviteCard, { type PendingInvite } from '@/components/InviteCard';
import LoadError from '@/components/LoadError';
import { Skeleton } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { useBusyIds } from '@/lib/hooks/useBusyIds';
import { usePendingInvites } from '@/lib/hooks/usePendingInvites';
import { signInPath } from '@/lib/utils/callbackUrl';
import { RequestTimeoutError, withRequestTimeout } from '@/lib/utils/requestTimeout';
import {
  type InviteAnswer,
  type NotificationView,
  followBackTarget,
  isGroupFollow,
  notificationIcon,
  notificationLink,
  notificationParts,
  showsActor,
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

/**
 * Who did it, where the row names someone (`showsActor`): their avatar. Every
 * other row (a proposal, which is anonymous; a demotion or removal, which never
 * say which owner did it) shows its type's icon, whatever the row holds.
 */
function RowLeading({ n }: { n: NotificationView }) {
  if (showsActor(n.type) && n.actorUsername) {
    return <Avatar name={n.actorUsername} src={n.actorImage} size="md" />;
  }
  return (
    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">
      <Icon name={notificationIcon(n)} size={18} />
    </span>
  );
}

// The row's own target (a link, or the button that opens the followers list)
// is stretched over the whole row, so the row is one big target, while an
// action in it (Follow back) sits above that and stays its own button.
const STRETCHED = 'text-left after:absolute after:inset-0 after:rounded-2xl';

export default function ActivityPage() {
  const { data: session, status } = useSession();
  const viewerUsername = session?.user?.username ?? null;
  const viewerId = session?.user?.id ?? null;
  const router = useRouter();
  const { showToast } = useToast();
  const invitesHeadingId = useId();
  const [items, setItems] = useState<NotificationView[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  // The feed couldn't be read: said in place, with Try again (`attempt`),
  // never as "You're all caught up".
  const [feedFailed, setFeedFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [followersOpen, setFollowersOpen] = useState(false);
  // Follow backs in flight, per person.
  const { busy: followBusy, run: runFollow } = useBusyIds();

  // An answered invite's row reads as the answer, as the server now has it
  // (`recordInviteAnswer`), without reading the feed again.
  const onAnswered = useCallback((invite: PendingInvite, answer: InviteAnswer) => {
    setItems((prev) =>
      prev.map((n) =>
        n.type === 'wishlist_invite' && n.wishlistId === invite.wishlistId && !n.inviteAnswer
          ? { ...n, inviteAnswer: answer, read: true }
          : n
      )
    );
  }, []);
  // Pinned above the feed, from the invites read: an invite's notification is
  // best-effort, so the invites themselves are the source of truth.
  const {
    invites,
    loading: invitesLoading,
    loadFailed: invitesFailed,
    retry: retryInvites,
    busy: answerBusy,
    respond,
  } = usePendingInvites({ onAnswered });

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(signInPath('/notifications'));
  }, [status, router]);

  useEffect(() => {
    // A read outdated by another (Try again, another account) is dropped.
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
          setFeedFailed(true);
          setFeedLoading(false);
        }
        return;
      }
      if (!current) return;
      setItems(feed.data);
      setFeedFailed(false);
      setFeedLoading(false);
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
  }, [status, viewerId, attempt]);

  const retryFeed = useCallback(() => {
    setFeedFailed(false);
    setFeedLoading(true);
    setAttempt((n) => n + 1);
  }, []);

  function followBack(n: NotificationView, actorId: string) {
    return runFollow(actorId, async () => {
      try {
        const result = await withRequestTimeout(async (signal) => {
          const res = await fetch(`/api/users/${actorId}/follow`, { method: 'POST', signal });
          return res.json();
        });
        if (!result.success) {
          showToast(result.error || 'Something went wrong', 'error');
          return;
        }
        // Every row from them stops offering it.
        setItems((prev) =>
          prev.map((row) => (row.actorId === actorId ? { ...row, followingActor: true } : row))
        );
        showToast(`You’re now following @${n.actorUsername}`, 'success');
      } catch (err) {
        showToast(
          err instanceof RequestTimeoutError ? err.message : 'Something went wrong',
          'error'
        );
      }
    });
  }

  function renderRow(n: NotificationView) {
    const rowClass = `relative flex items-center gap-3 rounded-2xl border p-4 ${
      n.read ? 'border-border bg-surface' : 'border-primary-500/40 bg-primary-500/5'
    }`;
    const body = (
      <>
        <RowLeading n={n} />
        <span className="min-w-0 flex-1">
          <span className="block text-body text-foreground">
            <NotificationLine n={n} />
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {relativeTime(n.createdAt)}
          </span>
        </span>
      </>
    );

    // Several followers: the list of them, in place (or, with no account id to
    // read it by, on the profile).
    const group = isGroupFollow(n) && viewerId;
    const href = group ? null : notificationLink(n, viewerUsername);
    let target: ReactNode;
    if (group) {
      target = (
        <button
          type="button"
          onClick={() => setFollowersOpen(true)}
          className={`flex min-w-0 flex-1 items-center gap-3 ${STRETCHED}`}
        >
          {body}
        </button>
      );
    } else if (href) {
      target = (
        <Link href={href} className={`flex min-w-0 flex-1 items-center gap-3 ${STRETCHED}`}>
          {body}
        </Link>
      );
    } else {
      // No link: a removal, a declined invite, or a pending one (answered on
      // its card above), whose list they may not see.
      target = <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>;
    }

    const followTo = followBackTarget(n);
    return (
      <li key={n._id}>
        <div className={`${rowClass} ${group || href ? 'transition-colors hover:bg-muted' : ''}`}>
          {target}
          {followTo && (
            <Button
              size="sm"
              variant="soft"
              className="relative z-10 flex-shrink-0"
              onClick={() => followBack(n, followTo)}
              disabled={followBusy(followTo)}
            >
              Follow back
            </Button>
          )}
          {!n.read && (
            <span
              className="h-2 w-2 flex-shrink-0 rounded-full bg-primary-500"
              aria-label="Unread"
            />
          )}
        </div>
      </li>
    );
  }

  const loading = feedLoading || invitesLoading;

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Activity</h1>
        <p className="mt-1 text-muted-foreground">
          Updates about your lists and people you follow.
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
        ) : (
          <div className="mt-8 space-y-8">
            {invitesFailed && (
              <LoadError title="Couldn’t load your invitations" onRetry={retryInvites} />
            )}
            {invites.length > 0 && (
              <section aria-labelledby={invitesHeadingId}>
                <h2 id={invitesHeadingId} className="text-base font-semibold text-foreground">
                  Invitations
                </h2>
                <ul className="mt-3 space-y-3">
                  {invites.map((invite) => (
                    <li key={invite._id}>
                      <InviteCard
                        invite={invite}
                        busy={answerBusy(invite._id)}
                        onAccept={() => respond(invite, 'accept')}
                        onDecline={() => respond(invite, 'decline')}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {feedFailed ? (
              <LoadError title="Couldn’t load notifications" onRetry={retryFeed} />
            ) : items.length > 0 ? (
              <ul className="space-y-2">{items.map(renderRow)}</ul>
            ) : (
              // Caught up only once both reads have said so.
              invites.length === 0 &&
              !invitesFailed && (
                <EmptyState
                  icon="bell"
                  title="You’re all caught up"
                  body="When someone follows you, invites you to a wishlist, or acts on a proposal, it’ll show up here."
                />
              )
            )}
          </div>
        )}
      </main>
      {followersOpen && viewerId && (
        <FollowListModal
          userId={viewerId}
          initialTab="followers"
          onClose={() => setFollowersOpen(false)}
        />
      )}
    </div>
  );
}
