'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useToast } from '@/components/ToastProvider';
import type { PendingInvite } from '@/components/InviteCard';
import { useBusyIds } from '@/lib/hooks/useBusyIds';
import { createAcceptRedirect } from '@/lib/utils/acceptRedirect';
import { acceptedInviteToast } from '@/lib/utils/confirmationCopy';
import { createMutationTracker } from '@/lib/utils/itemListMerge';
import { RequestTimeoutError, withRequestTimeout } from '@/lib/utils/requestTimeout';
import type { InviteAnswer } from '@/lib/utils/notifications';

export type InviteAction = 'accept' | 'decline';

interface PendingInvitesOptions {
  /**
   * An invite was answered, and the answer landed: the server has recorded it
   * on the invite's notification (`recordInviteAnswer`), so a feed on the same
   * page can show that row as the answer without reading it again.
   */
  onAnswered?: (invite: PendingInvite, answer: InviteAnswer) => void;
}

/**
 * The signed-in account's pending invitations (`GET /api/users/me/invites`, the
 * source of truth: an invite's notification is best-effort), and answering
 * them. Activity pins them above its feed with `InviteCard`; any other surface
 * that offers them (the dashboard's "Needs you") uses this hook the same way.
 *
 * Kept fresh without polling: read on sign-in and whenever another account
 * signs in, then again on every focus and `invites-changed` event. A read sent
 * while an answer was in flight, or before one landed, may predate it, so it
 * would bring back the card that answer just took off, or take off the card
 * still waiting on it. Such a read is dropped, and the list is read again once
 * no answer is in flight (`createMutationTracker`). Each answer is bounded by
 * `withRequestTimeout`, so one that stalls can't hold every read off.
 *
 * The first read of an account reports `loading`, and `loadFailed` if it
 * fails (shown in place, with `retry`, never as "no invitations"). A later read
 * that fails keeps the cards.
 */
export function usePendingInvites({ onAnswered }: PendingInvitesOptions = {}) {
  const { data: session, status } = useSession();
  const userId = session?.user?.id;
  const router = useRouter();
  const { showToast } = useToast();
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  // Invites whose answer is still in flight, per invite.
  const { busy, run } = useBusyIds();
  // One tracker per account, so an answer the previous account still has on
  // its way can't hold up this one's reads.
  const answerTracker = useRef(createMutationTracker());
  // The stamp of the latest list request sent.
  const latestSent = useRef(0);
  // List requests sent at or before this stamp are outdated: a newer one has
  // already landed, or they were sent for the previous account.
  const outdatedUpTo = useRef(0);
  // The account whose invites these are.
  const account = useRef(userId);
  // Which accept gets to open its list when several are in flight: the last one
  // clicked, among those still able to succeed (WIS-121).
  const acceptRedirect = useRef(createAcceptRedirect());
  const answered = useRef(onAnswered);
  useEffect(() => {
    answered.current = onAnswered;
  }, [onAnswered]);

  // Another account signed in (from another tab): `status` stays
  // 'authenticated', so key on the user id. A layout effect, so the previous
  // account's cards are gone before the browser paints, and nothing still on its
  // way for that account, a list or an answer, can land on the new one's page.
  // The busy ids stay: an answer still in flight frees its own card's id when it
  // settles, and the new account has no card with that id.
  useLayoutEffect(() => {
    account.current = userId;
    answerTracker.current = createMutationTracker();
    acceptRedirect.current.reset();
    outdatedUpTo.current = answerTracker.current.stamp();
    setInvites((prev) => (prev.length ? [] : prev));
    setLoading(true);
    setLoadFailed(false);
  }, [userId]);

  // A refetch (`quiet`) updates the cards in place, and a failed one keeps them.
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

  // Try again, after the first load failed: loading again, then a fresh read.
  const retry = useCallback(() => {
    setLoadFailed(false);
    setLoading(true);
    load(false);
  }, [load]);

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

  // Leaving the page forgets the accepts still in flight, so one landing (or
  // failing) after the user went elsewhere never pulls them onto a list.
  useEffect(() => {
    const landings = acceptRedirect.current;
    return () => landings.reset();
  }, []);

  // Take an invite off, and let anything else that reads invites re-check.
  function dropInvite(inviteId: string) {
    setInvites((prev) => prev.filter((i) => i._id !== inviteId));
    window.dispatchEvent(new Event('invites-changed'));
  }

  function respond(invite: PendingInvite, action: InviteAction) {
    return run(invite._id, async () => {
      const answeredFor = account.current;
      const landings = acceptRedirect.current;
      if (action === 'accept') landings.clicked(invite._id);
      // An accept that didn't succeed leaves the redirect to the last accept
      // clicked before it, which may already have succeeded and been waiting on
      // this one.
      const notJoined = () => {
        if (action !== 'accept') return;
        const path = landings.failed(invite._id);
        if (path) router.push(path);
      };
      const tracker = answerTracker.current;
      try {
        const { res, result } = await tracker.track(async () => {
          try {
            return await withRequestTimeout(async (signal) => {
              const res = await fetch(`/api/invites/${invite._id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
                signal,
              });
              // Parsed first, so a 404 that isn't the route's own JSON answer
              // (an HTML page from the platform) lands in the catch below and
              // keeps the card.
              return { res, result: await res.json() };
            });
          } catch (err) {
            // Given up on, but the server may still have taken the answer: read
            // the list again once no answer is in flight, to show what it has.
            // Asked for while this one is still tracked, so it's one read
            // however many reads were dropped meanwhile.
            if (err instanceof RequestTimeoutError) tracker.rereadWhenIdle();
            throw err;
          }
        });
        // Another account signed in while this answer was on its way. What came
        // of it (the list's name, the redirect, an error) belongs to the account
        // that gave it, here and in the catch below.
        if (account.current !== answeredFor) return;
        // The invite went away while the page was open: an owner cancelled it,
        // its list was deleted, we left or lost our role there, or another tab
        // already answered it. Every retry would 404 the same way, so drop the
        // card. Any other failure keeps it, so the user can retry.
        if (res.status === 404) {
          dropInvite(invite._id);
          showToast('This invitation is no longer available', 'info');
          notJoined();
          return;
        }
        if (result.success) {
          dropInvite(invite._id);
          answered.current?.(invite, action === 'accept' ? 'accepted' : 'declined');
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
            // Only the last accept clicked opens its list: one clicked earlier
            // just says it joined.
            const path = landings.joined(
              invite._id,
              `/wishlists/${result.data.wishlistSlug ?? result.data.wishlistId}`
            );
            if (path) router.push(path);
          } else {
            showToast('Invitation declined', 'info');
          }
        } else {
          showToast(result.error || 'Something went wrong', 'error');
          notJoined();
        }
      } catch (err) {
        if (account.current !== answeredFor) return;
        showToast(
          err instanceof RequestTimeoutError ? err.message : 'Something went wrong',
          'error'
        );
        notJoined();
      }
    });
  }

  return { invites, loading, loadFailed, retry, busy, respond };
}
