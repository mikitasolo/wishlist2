'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import LoadError from '@/components/LoadError';
import { useToast } from '@/components/ToastProvider';
import { useBusyIds } from '@/lib/hooks/useBusyIds';
import { signInPath } from '@/lib/utils/callbackUrl';
import { createMutationTracker } from '@/lib/utils/itemListMerge';
import { acceptedInviteToast } from '@/lib/utils/confirmationCopy';

interface Invite {
  _id: string;
  role: 'owner' | 'member';
  wishlistId: string;
  wishlistName: string;
  wishlistSlug: string | null;
  invitedByUsername: string | null;
  invitedByImage: string | null;
}

export default function InvitesPage() {
  const { data: session, status } = useSession();
  const userId = session?.user?.id;
  const router = useRouter();
  const { showToast } = useToast();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  // The account's first load failed: said in place, with Try again, never as
  // "No pending invitations". A refetch that lands replaces it with the list.
  const [loadFailed, setLoadFailed] = useState(false);
  // Invites whose answer is still in flight, per invite.
  const { busy, run } = useBusyIds();
  // The answers as a refetch sees them. A list read while one was in flight may
  // predate it, so it would bring back the card that answer just took off, or
  // take off the card still waiting on it. Such a read is dropped, and the list
  // is read again once no answer is in flight. One tracker per account, so an
  // answer the previous account still has on its way can't hold up this one's.
  const answerTracker = useRef(createMutationTracker());
  // The stamp of the latest list request sent.
  const latestSent = useRef(0);
  // List requests sent at or before this stamp are outdated: a newer one has
  // already landed, or they were sent for the previous account.
  const outdatedUpTo = useRef(0);
  // The account whose invites the page shows.
  const account = useRef(userId);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(signInPath('/invites'));
  }, [status, router]);

  // Another account signed in (from another tab): `status` stays
  // 'authenticated', so key on the user id. A layout effect, so the previous
  // account's cards are gone before the browser paints, and nothing still on its
  // way for that account, a list or an answer, can land on the new one's page.
  // The busy ids stay: an answer still in flight frees its own card's id when it
  // settles, and the new account has no card with that id.
  useLayoutEffect(() => {
    account.current = userId;
    answerTracker.current = createMutationTracker();
    outdatedUpTo.current = answerTracker.current.stamp();
    setInvites((prev) => (prev.length ? [] : prev));
    setLoading(true);
    setLoadFailed(false);
  }, [userId]);

  // The first load of an account shows the skeleton, and says so in its place
  // if it fails, with no toast. A refetch (`quiet`) updates the cards in place,
  // and a failed one keeps them.
  const load = useCallback((quiet: boolean) => {
    const tracker = answerTracker.current;
    const sentAt = tracker.stamp();
    latestSent.current = sentAt;
    fetch('/api/users/me/invites', { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (sentAt <= outdatedUpTo.current) return;
        if (!res.success) throw new Error(res.error);
        if (tracker.isStale(sentAt)) {
          // Read again, unless a read sent since the answers settled is
          // already on its way.
          if (tracker.isStale(latestSent.current)) tracker.rereadWhenIdle();
          return;
        }
        outdatedUpTo.current = sentAt;
        setInvites(res.data);
        setLoadFailed(false);
        setLoading(false);
      })
      .catch(() => {
        if (sentAt <= outdatedUpTo.current || quiet) return;
        setLoadFailed(true);
        setLoading(false);
      });
  }, []);

  // Try again, after the first load failed: the skeleton, then a fresh read.
  function retryLoad() {
    setLoadFailed(false);
    setLoading(true);
    load(false);
  }

  // Load, then re-check whenever the tab regains focus or something changes
  // invites, as the header's invitation dot does, so the two agree.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const tracker = answerTracker.current;
    const refresh = () => load(true);
    load(false);
    tracker.setReread(refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('invites-changed', refresh);
    return () => {
      tracker.setReread(null);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('invites-changed', refresh);
    };
  }, [status, userId, load]);

  // Take an invite off the page and let the header's invitation dot (and this
  // page's list) re-check immediately.
  function dropInvite(inviteId: string) {
    setInvites((prev) => prev.filter((i) => i._id !== inviteId));
    window.dispatchEvent(new Event('invites-changed'));
  }

  function respond(invite: Invite, action: 'accept' | 'decline') {
    return run(invite._id, async () => {
      const answeredFor = account.current;
      try {
        const { res, result } = await answerTracker.current.track(async () => {
          const res = await fetch(`/api/invites/${invite._id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action }),
          });
          // Parsed first, so a 404 that isn't the route's own JSON answer (an
          // HTML page from the platform) lands in the catch below and keeps the
          // card.
          return { res, result: await res.json() };
        });
        // Another account signed in while this answer was on its way. What came
        // of it (the list's name, the redirect, an error) belongs to the account
        // that gave it, here and in the catch below.
        if (account.current !== answeredFor) return;
        // The invite went away while this page was open: an owner cancelled it,
        // its list was deleted, we left or lost our role there, or another tab
        // already answered it. Every retry would 404 the same way, so drop the
        // card. Any other failure keeps it, so the user can retry.
        if (res.status === 404) {
          dropInvite(invite._id);
          showToast('This invitation is no longer available', 'info');
          return;
        }
        if (result.success) {
          dropInvite(invite._id);
          // Answering marked the invite's notification read: the bell re-counts.
          window.dispatchEvent(new Event('notifications-changed'));
          if (action === 'accept') {
            // An owner invite ends the reservations they held on the list, which
            // go from their Reserved page. They're the gifter, so the count is
            // theirs to see.
            showToast(
              acceptedInviteToast(
                invite.role,
                invite.wishlistName,
                result.data?.cancelledReservations
              ),
              'success'
            );
            router.push(`/wishlists/${result.data.wishlistSlug ?? result.data.wishlistId}`);
          } else {
            showToast('Invitation declined', 'info');
          }
        } else {
          showToast(result.error || 'Something went wrong', 'error');
        }
      } catch {
        if (account.current === answeredFor) showToast('Something went wrong', 'error');
      }
    });
  }

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Invitations</h1>
        <p className="mt-1 text-muted-foreground">Wishlists people have invited you to join.</p>

        {loading ? (
          <div className="mt-8 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton h-24 rounded-2xl" />
            ))}
          </div>
        ) : loadFailed ? (
          <div className="mt-8">
            <LoadError title="Couldn’t load your invitations" onRetry={retryLoad} />
          </div>
        ) : invites.length === 0 ? (
          <div className="mt-8 flex flex-col items-center rounded-3xl border border-dashed border-border-strong py-16 text-center sm:py-20">
            <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Icon name="inbox" size={28} />
            </span>
            <h3 className="text-lg font-semibold text-foreground sm:text-xl">
              No pending invitations
            </h3>
            <p className="mx-auto mt-1.5 max-w-sm px-4 text-sm text-muted-foreground">
              When someone invites you to a wishlist, it&apos;ll show up here.
            </p>
          </div>
        ) : (
          <ul className="mt-8 space-y-3">
            {invites.map((invite) => (
              <li
                key={invite._id}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    name={invite.invitedByUsername || 'user'}
                    src={invite.invitedByImage}
                    size="md"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{invite.wishlistName}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {invite.invitedByUsername ? `@${invite.invitedByUsername}` : 'Someone'}{' '}
                      invited you
                      {invite.role === 'owner' ? ' as a co-owner' : ''}
                    </p>
                    {/* Accepting co-ownership is destructive on the gifting side —
                        say so before they tap Accept, not after. */}
                    {invite.role === 'owner' && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        You’ll get full control and the list will show on your profile. Owners never
                        see booking status, so anything you’ve booked here will be released.
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    onClick={() => respond(invite, 'decline')}
                    disabled={busy(invite._id)}
                    className="inline-flex h-9 items-center rounded-xl px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    Decline
                  </button>
                  <button
                    onClick={() => respond(invite, 'accept')}
                    disabled={busy(invite._id)}
                    className="inline-flex h-9 items-center rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white shadow-[0_8px_22px_-10px_rgba(94,92,230,0.9)] transition-colors hover:bg-primary-500 disabled:opacity-50"
                  >
                    Accept
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
