'use client';

import { CreateWishlistModal } from '@/components/lazyModals';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import { useLiveRead } from '@/lib/hooks/useLiveRead';
import { useDiscreetMode } from '@/lib/hooks/useDiscreetMode';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import FollowListModal from '@/components/FollowListModal';
import Icon from '@/components/Icon';
import InviteCard, { InviteCardSkeleton, type PendingInvite } from '@/components/InviteCard';
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
  type RecordedInviteAnswer,
  followBackTarget,
  groupByLocalDay,
  isGroupFollow,
  notificationIcon,
  notificationLink,
  notificationParts,
  hiddenByDiscreetMode,
  showsActor,
  withInviteAnswers,
} from '@/lib/utils/notifications';

/**
 * A notification's line, with any list's name in semibold. No spoiler mode
 * hides what a group gift row says (a reservation), as it renders.
 */
function NotificationLine({ n }: { n: NotificationView }) {
  const { discreet } = useDiscreetMode();
  return (
    <>
      {notificationParts(n, { discreet }).map((part, i) =>
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
  const { discreet } = useDiscreetMode();
  // No spoiler mode: a group gift row shows no face either (WIS-364), nor a
  // reminder about what you reserved (WIS-384).
  const hidden = discreet && hiddenByDiscreetMode(n.type);
  if (showsActor(n.type) && n.actorUsername && !hidden) {
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

/** The feed as last read: its rows, and the stamp its request went out with. */
interface Feed {
  rows: NotificationView[];
  unreadCount: number;
  sentAt: number;
}

/** Before the first read: no rows known (see `feedLoaded`). */
const NO_FEED: Feed = { rows: [], unreadCount: 0, sentAt: 0 };

export default function ActivityPage() {
  const { data: session, status } = useKnownSession();
  const { discreet } = useDiscreetMode();
  const viewerUsername = session?.user?.username ?? null;
  const viewerId = session?.user?.id ?? null;
  const router = useRouter();
  const { showToast } = useToast();
  const invitesHeadingId = useId();
  const feedHeadingId = useId();
  const today = useLocalToday();
  const [followersOpen, setFollowersOpen] = useState(false);
  // A friend's ask for a wishlist (WIS-324) is answered by making one.
  const [createOpen, setCreateOpen] = useState(false);
  // Follow backs in flight, per person.
  const { busy: followBusy, run: runFollow } = useBusyIds();
  // The account the feed is for: a follow back started for another (one that
  // signed out from another tab) changes nothing here.
  const account = useRef(viewerId);
  // The stamp of the latest feed read sent (see `answers`).
  const feedSent = useRef(0);
  // Rows that were unread when read on this visit (state, as rows render from it). The page marks everything read
  // as it opens, so a later read (focus) says `read`; the rows keep standing out
  // until the visit ends.
  const [unreadThisVisit, setUnreadThisVisit] = useState<ReadonlySet<string>>(() => new Set());
  // The invites answered on this page, each with the last feed read sent before
  // it landed. The rows of such a read (the one shown, or one still on its way)
  // would show the row as a pending invite, so the answer is put on them as
  // they render (`items`).
  const [answers, setAnswers] = useState<(RecordedInviteAnswer & { readsBefore: number })[]>([]);

  // An answered invite's row reads as the answer, as the server now has it
  // (`recordInviteAnswer`), without waiting for the feed to be read again.
  const onAnswered = useCallback((invite: PendingInvite, answer: InviteAnswer) => {
    const recorded = {
      wishlistId: invite.wishlistId,
      answer,
      since: invite.createdAt ?? null,
      readsBefore: feedSent.current,
    };
    setAnswers((prev) => [...prev, recorded]);
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
  // Try again on the invitations alone: the feed stays up meanwhile.
  const [retryingInvites, setRetryingInvites] = useState(false);
  useEffect(() => {
    if (!invitesLoading) setRetryingInvites(false);
  }, [invitesLoading]);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(signInPath('/notifications'));
  }, [status, router]);

  // Another account signed in (from another tab): what this visit kept for the
  // previous account goes before the browser paints (its rows go with the read
  // keyed on the account, below).
  useLayoutEffect(() => {
    account.current = viewerId;
    setAnswers((prev) => (prev.length ? [] : prev));
    setUnreadThisVisit((prev) => (prev.size ? new Set() : prev));
    setFollowersOpen(false);
  }, [viewerId]);

  // The feed (`useLiveRead`): the first read of an account shows the skeleton,
  // and says so in its place if it fails (`feedFailed`, never the empty state).
  // Read again whenever the viewer comes back to the tab in a focused window
  // (or the browser back online there), never for a tab shown in a window
  // they aren't in, and when invites change (an answer here or in another tab,
  // a card gone), as the invitations above do, so a row and its card agree;
  // such a read updates the rows in place, and a failed one keeps them. No
  // timed poll (WIS-376): every feed read with something unread marks it all
  // read (below), so a poll would clear the badge for rows nobody looked at.
  // Keyed on the account: the previous one's rows go in the render that sees
  // the new one, and nothing still on its way for it lands.
  const readFeed = useCallback(
    async (stamp: () => number) => {
      if (!viewerId) return null;
      const sentAt = stamp();
      feedSent.current = sentAt;
      const res = await fetch('/api/notifications?actors=1', { cache: 'no-store' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load notifications');
      const feed: Feed = { rows: json.data, unreadCount: json.unreadCount ?? 0, sentAt };
      return { data: feed, sentAt };
    },
    [viewerId]
  );
  const {
    data: feed,
    setData: setFeed,
    loaded: feedLoaded,
    failed: feedFailed,
    refresh: reloadFeed,
  } = useLiveRead<Feed>({
    enabled: status === 'authenticated' && viewerId !== null,
    initialData: NO_FEED,
    read: readFeed,
    resetOnNewRead: true,
  });
  const feedLoading = !feedLoaded && !feedFailed;
  // The rows, with the answers given here since their read was sent.
  const items = useMemo(
    () =>
      withInviteAnswers(
        feed.rows,
        answers.filter((a) => feed.sentAt <= a.readsBefore)
      ),
    [feed, answers]
  );

  useEffect(() => {
    if (status !== 'authenticated') return;
    const refreshFeed = () => void reloadFeed(true);
    window.addEventListener('invites-changed', refreshFeed);
    return () => window.removeEventListener('invites-changed', refreshFeed);
  }, [status, reloadFeed]);

  // Each read that lands: its unread rows stay marked for the visit, and
  // visiting the page clears the unread badge. If that fails, the badge stays,
  // and the next visit clears it: the feed itself is on screen.
  const feedHandled = useRef(0);
  useEffect(() => {
    if (!feedLoaded || feed.sentAt === feedHandled.current) return;
    feedHandled.current = feed.sentAt;
    const fresh = feed.rows.filter((n) => !n.read).map((n) => n._id);
    if (fresh.length) setUnreadThisVisit((prev) => new Set([...prev, ...fresh]));
    if (feed.unreadCount > 0) {
      fetch('/api/notifications', { method: 'PATCH' })
        .then(() => window.dispatchEvent(new Event('notifications-changed')))
        .catch(() => {
          /* see above */
        });
    }
  }, [feed, feedLoaded]);

  const retryFeed = useCallback(() => void reloadFeed(), [reloadFeed]);

  const retryInvitesInPlace = useCallback(() => {
    setRetryingInvites(true);
    retryInvites();
  }, [retryInvites]);

  function followBack(n: NotificationView, actorId: string) {
    const forAccount = account.current;
    return runFollow(actorId, async () => {
      try {
        const result = await withRequestTimeout(async (signal) => {
          const res = await fetch(`/api/users/${actorId}/follow`, { method: 'POST', signal });
          return res.json();
        });
        // Another account signed in meanwhile: this was the previous one's.
        if (account.current !== forAccount) return;
        if (!result.success) {
          showToast(result.error || 'Something went wrong', 'error');
          return;
        }
        // Every row from them stops offering it.
        setFeed((prev) => ({
          ...prev,
          rows: prev.rows.map((row) =>
            row.actorId === actorId ? { ...row, followingActor: true } : row
          ),
        }));
        showToast(`You’re now following @${n.actorUsername}`, 'success');
      } catch (err) {
        if (account.current !== forAccount) return;
        showToast(
          err instanceof RequestTimeoutError ? err.message : 'Something went wrong',
          'error'
        );
      }
    });
  }

  function renderRow(n: NotificationView) {
    const isUnread = !n.read || unreadThisVisit.has(n._id);
    const rowClass = `relative flex items-center gap-3 rounded-2xl border p-4 ${
      !isUnread
        ? 'border-border bg-surface'
        : 'border-primary-500/40 border-l-4 border-l-primary-500 bg-primary-500/10'
    }`;
    const body = (
      <>
        <RowLeading n={n} />
        <span className="min-w-0 flex-1">
          <span className={`block text-body text-foreground ${isUnread ? 'font-medium' : ''}`}>
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
    // No spoiler mode: a row about a reservation (a group gift, a reminder of
    // what you reserved) doesn’t point anywhere either.
    const href =
      group || (discreet && hiddenByDiscreetMode(n.type))
        ? null
        : notificationLink(n, viewerUsername);
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
          {n.type === 'wishlist_ask' && (
            <Button
              size="sm"
              variant="soft"
              className="relative z-10 flex-shrink-0"
              onClick={() => setCreateOpen(true)}
            >
              Create a list
            </Button>
          )}
          {isUnread && (
            <span
              className="h-2 w-2 flex-shrink-0 rounded-full bg-primary-500"
              aria-label="Unread"
            />
          )}
        </div>
      </li>
    );
  }

  // The skeleton until both first reads have settled; Try again on the
  // invitations alone keeps the feed up, with their card's shape in their place.
  const loading = feedLoading || (invitesLoading && !retryingInvites);

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
            {invitesLoading ? (
              <InviteCardSkeleton />
            ) : (
              invitesFailed && (
                <LoadError title="Couldn’t load your invitations" onRetry={retryInvitesInPlace} />
              )
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
              <section aria-labelledby={feedHeadingId}>
                <h2 id={feedHeadingId} className="text-base font-semibold text-foreground">
                  Notifications
                </h2>
                {today ? (
                  <div className="mt-3 space-y-5">
                    {groupByLocalDay(items, today).map((group) => (
                      <div key={group.key}>
                        <h3 className="text-sm font-medium text-muted-foreground">{group.label}</h3>
                        <ul className="mt-2 space-y-2">{group.rows.map(renderRow)}</ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ul className="mt-3 space-y-2">{items.map(renderRow)}</ul>
                )}
              </section>
            ) : (
              // Empty only once both reads have said so.
              invites.length === 0 &&
              !invitesLoading &&
              !invitesFailed && (
                <EmptyState
                  icon="bell"
                  title="Nothing here yet"
                  body="When someone follows you, invites you to a wishlist, or acts on a proposal, it’ll show up here."
                ></EmptyState>
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
      {createOpen && <CreateWishlistModal isOpen onClose={() => setCreateOpen(false)} />}
    </div>
  );
}
