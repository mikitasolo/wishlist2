'use client';

import { track } from '@/lib/analytics';
import { withWelcomeMarker } from '@/lib/utils/memberWelcome';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import { useRefreshOnReturn } from '@/lib/hooks/useLiveRead';
import { useToast } from '@/components/ToastProvider';
import { useUndoableAction } from '@/lib/hooks/useUndoableAction';
import { restoreRemoved } from '@/lib/utils/deferredCommit';
import type { PendingInvite } from '@/components/InviteCard';
import { useBusyIds } from '@/lib/hooks/useBusyIds';
import { createAcceptRedirect } from '@/lib/utils/acceptRedirect';
import { acceptedInviteToast, alreadyAnsweredInviteToast } from '@/lib/utils/confirmationCopy';
import { createMutationTracker } from '@/lib/utils/mutationTracker';
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
 * them. Activity pins them above its feed with `InviteCard`; a new surface that
 * offers them (the dashboard's "Needs you", WIS-252) uses this hook the same way.
 *
 * Kept fresh without polling: read on sign-in and whenever another account
 * signs in, then again on every return (`useRefreshOnReturn`) and `invites-changed` event. A read sent
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
  const { data: session, status } = useKnownSession();
  const userId = session?.user?.id;
  const router = useRouter();
  const { showToast } = useToast();
  const offerUndo = useUndoableAction();
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  // Invites whose answer is still in flight, per invite.
  const { busy, run, running } = useBusyIds();
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

  const refresh = useCallback(() => load(true), [load]);
  useEffect(() => {
    if (status !== 'authenticated') return;
    const tracker = answerTracker.current;
    load(false);
    tracker.setReread(refresh);
    window.addEventListener('invites-changed', refresh);
    return () => {
      tracker.setReread(null);
      window.removeEventListener('invites-changed', refresh);
    };
  }, [status, userId, load, refresh]);
  useRefreshOnReturn(refresh, { enabled: status === 'authenticated' });

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

  // Decline waits out an Undo window before it's sent (WIS-387): the card goes
  // at once, and Undo brings it back with nothing sent. The window is held as an
  // answer in flight, so a read meanwhile (a focus, another surface's
  // `invites-changed`) can't bring the card back; the other surfaces hear of it
  // only once it's sent. Sent for the account that declined, never for one
  // that has signed in since.
  function declineLater(invite: PendingInvite) {
    // An answer to it already on its way decides it.
    if (running(invite._id)) return;
    const declinedFor = account.current;
    let index = -1;
    setInvites((prev) => {
      const at = prev.findIndex((i) => i._id === invite._id);
      if (at !== -1) index = at;
      return at === -1 ? prev : prev.filter((i) => i._id !== invite._id);
    });
    const putBack = () => {
      if (account.current !== declinedFor) return;
      setInvites((prev) => restoreRemoved(prev, invite, Math.max(index, 0)));
    };
    // The window counts as an answer in flight until the answer itself takes
    // over (tracked in `answer`, from the same tick) or it's undone.
    let endWindow!: () => void;
    void answerTracker.current.track(() => new Promise<void>((resolve) => (endWindow = resolve)));
    offerUndo({
      message: 'Invitation declined',
      commit: async ({ keepalive }) => {
        endWindow();
        if (account.current !== declinedFor) return;
        await run(invite._id, async () => {
          const outcome = await answer(invite, 'decline', keepalive);
          if (outcome === 'failed') putBack();
        });
      },
      onUndo: () => {
        endWindow();
        putBack();
      },
    });
  }

  function respond(invite: PendingInvite, action: InviteAction) {
    if (action === 'decline') {
      declineLater(invite);
      return Promise.resolve();
    }
    return run(invite._id, () => answer(invite, action).then(() => undefined));
  }

  // Sends one answer and says what came of it: 'failed' when the invite is
  // still pending for all we know (the card should stay), 'done' otherwise.
  async function answer(
    invite: PendingInvite,
    action: InviteAction,
    keepalive = false
  ): Promise<'done' | 'failed'> {
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
              keepalive,
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
      if (account.current !== answeredFor) return 'done';
      // The invite went away while the page was open: an owner cancelled it,
      // its list was deleted or archived, or we left or lost our role there.
      // Every retry would 404 the same way, so drop the
      // card. Any other failure keeps it, so the user can retry.
      if (res.status === 404) {
        dropInvite(invite._id);
        showToast('This invitation is no longer available', 'info');
        notJoined();
        return 'done';
      }
      // Already answered, from another tab or device (WIS-100). Nothing to
      // retry, so the card goes, and the toast says what the answer was, with
      // the list's link when the route gave one (an accept, on a list they can
      // still open). Nothing navigates: this click didn't join anything.
      const earlier = res.status === 409 ? result.data?.status : undefined;
      if (earlier === 'accepted' || earlier === 'declined') {
        dropInvite(invite._id);
        answered.current?.(invite, earlier);
        window.dispatchEvent(new Event('notifications-changed'));
        const ref = result.data.wishlistSlug ?? result.data.wishlistId;
        showToast(
          alreadyAnsweredInviteToast(earlier, invite.wishlistName),
          'info',
          earlier === 'accepted' && ref
            ? { action: { label: 'Open list', href: `/wishlists/${ref}` } }
            : undefined
        );
        notJoined();
        return 'done';
      }
      if (result.success) {
        dropInvite(invite._id);
        answered.current?.(invite, action === 'accept' ? 'accepted' : 'declined');
        // Answering marked the invite's notification read: Activity's badge
        // re-counts.
        window.dispatchEvent(new Event('notifications-changed'));
        if (action === 'accept') {
          track('invite_accepted', { role: invite.role });
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
          // A new member's list opens with the one-shot welcome marker (WIS-262).
          const listPath = `/wishlists/${result.data.wishlistSlug ?? result.data.wishlistId}`;
          const path = landings.joined(
            invite._id,
            invite.role === 'member' ? withWelcomeMarker(listPath) : listPath
          );
          if (path) router.push(path);
        }
        // A decline's Undo toast has said it already.
        return 'done';
      }
      showToast(result.error || 'Something went wrong', 'error');
      notJoined();
      return 'failed';
    } catch (err) {
      if (account.current !== answeredFor) return 'done';
      showToast(err instanceof RequestTimeoutError ? err.message : 'Something went wrong', 'error');
      notJoined();
      return 'failed';
    }
  }

  return { invites, loading, loadFailed, retry, busy, respond };
}
