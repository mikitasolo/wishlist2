'use client';

import { track } from '@/lib/analytics';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import { sharedRead, useLiveRead, type StampedRead } from '@/lib/hooks/useLiveRead';
import { useToast } from '@/components/ToastProvider';
import { useBusyIds } from '@/lib/hooks/useBusyIds';
import { useDiscreetMode } from '@/lib/hooks/useDiscreetMode';
import { useUndoableAction } from '@/lib/hooks/useUndoableAction';
import { createListChangeLog, mergeRefreshedList } from '@/lib/utils/listRefresh';
import { createMutationTracker } from '@/lib/utils/mutationTracker';
import {
  REQUEST_TIMEOUT_MESSAGE,
  RequestTimeoutError,
  withRequestTimeout,
} from '@/lib/utils/requestTimeout';
import { needsConfirmation } from '@/lib/utils/reservations';
import {
  createSubmissionKeys,
  IDEMPOTENCY_HEADER,
  type SubmissionKeys,
} from '@/lib/utils/submissionKey';
import { cardMotionFor, prefersReducedMotion, waitForMotion } from '@/lib/utils/motion';
import type { Gift, Reservation } from './types';
import type { ContributingGroupGift } from '@/lib/utils/groupGiftSummary';

/**
 * The item route's answers refusing a Release's unbook, which retrying won't
 * change: the item is no longer booked by the gifter (someone else's now, an
 * owner's status change, deleted), they're no longer a member, or the list has
 * been archived. A 429, a 5xx or a network failure is worth retrying instead.
 */
const RELEASE_REFUSED = new Set([400, 403, 404, 409]);

/**
 * What the page says when a Release finds the card out of date: true of every
 * refusal (the item isn't theirs any more, or the list isn't available to them),
 * and never why. The read it sends then shows the card's own note.
 */
const RELEASE_REFUSED_MESSAGE = 'This gift can’t be released from its list any more.';

/** A group gift action refused without the route's own reason (WIS-363). */
const GROUP_GIFT_OUT_OF_DATE = 'This group gift has changed. Here’s how it is now.';

/**
 * The Undo toast after Leave group gift (WIS-387), saying what leaving did
 * where it did more than take their share off: an organizer hands the gift on,
 * or, as its last one, ends it (what the confirmation used to warn of).
 */
export function leftGroupGiftMessage(gift: ContributingGroupGift): string {
  if (!gift.organizer) return 'You left the group gift';
  const next = gift.contributors.find((c) => !c.you);
  return next
    ? `You left the group gift. ${next.name} becomes the organizer.`
    : 'You left the group gift. It ends, and others on the list can reserve the item.';
}

/** The gift history's order, as `GET /api/users/me/gifts` gives it: newest first. */
const newestFirst = (a: Gift, b: Gift) => Date.parse(b.giftedAt) - Date.parse(a.giftedAt);

/**
 * One of the page's lists, as the server has it, or `null` if reading it
 * failed. Bounded, so a read that stalls lets go of the page's next read
 * (see `read`) instead of holding it off for as long as the browser waits.
 */
async function readList<T>(url: string): Promise<T[] | null> {
  try {
    const json = await withRequestTimeout(async (signal) => {
      const res = await fetch(url, { cache: 'no-store', signal });
      return res.json();
    });
    return json.success ? json.data : null;
  } catch {
    return null;
  }
}

/** Both of the page's lists. */
interface ReservedLists {
  reservations: Reservation[];
  gifts: Gift[];
  /**
   * In a read's answer only: the list it couldn't read (its array is empty
   * and means nothing). Never on the lists shown.
   */
  missing?: 'reservations' | 'gifts';
}

/** Before the first read: nothing known (see `loading`). */
const NO_LISTS: ReservedLists = { reservations: [], gifts: [] };

/** Numbers each mount of the page, whose reads only it shares (see `read`). */
let mounts = 0;

/**
 * The Reserved page's data and everything it does to it: both lists, their
 * refresh and merge, the confirmation each Mark as given opens, and the actions
 * themselves (Mark as given, Dismiss, Release, group gift Mark as given and
 * Leave, delete from history). Dismiss, Release, Leave and delete from history
 * take the card off at once with an Undo toast and send their request once
 * the Undo window has passed (WIS-387, see `deferCardAction`). The sections
 * only render what it hands them.
 */
export function useReservedData() {
  const { data: session, status } = useKnownSession();
  const userId = session?.user?.id;
  const { showToast } = useToast();
  const { discreet } = useDiscreetMode();
  // Reservations and gift-log entries whose action is still in flight, per id.
  const { busy, run, running } = useBusyIds();
  const offerUndo = useUndoableAction();
  // Cards taken off the page while their Undo is offered (WIS-387): still in
  // the lists, held (`run`) so a read leaves them alone, just not shown.
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  // Cards playing the Mark as given moment (WIS-407), each until it leaves. Read
  // when the answer lands, so discreet mode turned on meanwhile plays none.
  const [givenIds, setGivenIds] = useState<ReadonlySet<string>>(() => new Set());
  const discreetNow = useRef(discreet);
  useEffect(() => {
    discreetNow.current = discreet;
  }, [discreet]);
  const [giftConfirm, setGiftConfirm] = useState<string | null>(null);
  // A group gift card's organizer's Mark as given (WIS-363).
  const [groupGiveConfirm, setGroupGiveConfirm] = useState<string | null>(null);
  // The Idempotency-Key of each card's group Mark as given, kept until it
  // succeeds, so a retry after a timeout is answered as the first attempt was.
  const groupGiveKeys = useRef(new Map<string, SubmissionKeys>());
  // The page's own changes to both lists (their ids never clash), so a read of
  // them is merged with the changes made while it was on its way instead of
  // undoing them (`merge`). Reads are stamped on the same clock.
  const [changes] = useState(createListChangeLog);
  const [readOrder] = useState(() => createMutationTracker(changes.stamp));
  // Whether the account's lists have been shown: until then every read, a
  // return to the tab's included, is a first load, which shows both lists or
  // neither (one on its own would claim the other is empty).
  const listsShown = useRef(false);
  // Bumped by a read an action asks for (see `reloadLists`): such a read goes
  // out afresh, never joining one sent before the action's change.
  const readRound = useRef(0);
  // This mount: a read is shared only within it, never with one a previous
  // visit to the page left on its way.
  const [mount] = useState(() => ++mounts);
  // The account whose lists the page shows.
  const account = useRef(userId);

  // Another account signed in (from another tab): `status` stays
  // 'authenticated', so the read is keyed on the user id, and the previous
  // account's cards go in the render that sees the new one (`resetOnNewRead`);
  // nothing still on its way for that account, a read or an action's answer,
  // lands on the new one's page. A confirmation still open for one of its
  // cards closes, so it can't send that card's action as the new account. The
  // busy ids stay: an action still in flight frees its own card's id when it
  // settles, and the new account has no card with that id.
  useLayoutEffect(() => {
    account.current = userId;
    changes.reset();
    listsShown.current = false;
    setGiftConfirm(null);
    setGroupGiveConfirm(null);
  }, [userId, changes]);

  // Reads both lists (`useLiveRead`, no timer: what changes here is mostly the
  // viewer's own doing), first when the page opens, then whenever the user
  // comes back to the tab (or the browser back online), for reservations made,
  // gifted or released, and gifts logged or deleted, in another tab or on
  // another device. A return while a read is still on its way joins it
  // (`sharedRead`). Until the account's lists have been shown, a read is their
  // first load: the skeleton stands until it lands, and if either list fails
  // the page says so in their place, with Try again, and no toast. A later
  // read updates the cards in place, and one that fails keeps them, silently
  // (either list it did read still lands).
  const read = useCallback(
    async (stamp: () => number): Promise<StampedRead<ReservedLists> | null> => {
      if (!userId) return null;
      const answer = await sharedRead(
        `reserved:${mount}:${userId}:${readRound.current}`,
        stamp,
        () =>
          Promise.all([
            readList<Reservation>('/api/users/me/reservations'),
            readList<Gift>('/api/users/me/gifts'),
          ])
      );
      const [reservations, gifts] = answer.data;
      if (!reservations && !gifts) throw new Error('Couldn’t read the reserved lists');
      if (!listsShown.current && (!reservations || !gifts)) {
        throw new Error('Couldn’t read both reserved lists');
      }
      return {
        data: {
          reservations: reservations ?? [],
          gifts: gifts ?? [],
          missing: !reservations ? 'reservations' : !gifts ? 'gifts' : undefined,
        },
        sentAt: answer.sentAt,
      };
    },
    [userId, mount]
  );

  // Every read is merged with what the page did while it was on its way (a
  // gift, dismissal or delete it may predate) and leaves a card whose action is
  // in flight alone. One outdated by a newer read is ignored.
  const merge = useCallback(
    ({ data: answer, sentAt }: StampedRead<ReservedLists>) => {
      const since = changes.land(sentAt);
      if (!since) return null;
      listsShown.current = true;
      return (shown: ReservedLists): ReservedLists => ({
        reservations:
          answer.missing === 'reservations'
            ? shown.reservations
            : mergeRefreshedList(shown.reservations, answer.reservations, since, {
                held: running,
              }),
        gifts:
          answer.missing === 'gifts'
            ? shown.gifts
            : mergeRefreshedList(shown.gifts, answer.gifts, since, {
                held: running,
                compare: newestFirst,
              }),
      });
    },
    [changes, running]
  );

  const {
    data: lists,
    setData: setLists,
    loaded,
    failed: loadFailed,
    refresh,
  } = useLiveRead<ReservedLists>({
    enabled: status === 'authenticated' && !!userId,
    initialData: NO_LISTS,
    read,
    merge,
    mutations: readOrder,
    resetOnNewRead: true,
  });
  const loading = !loaded && !loadFailed;
  const { reservations, gifts } = lists;

  // Try again, after the first load failed: the skeleton, then a read, joining
  // one a return to the tab has just sent, which then decides.
  function retryLoad() {
    void refresh();
  }

  // Both lists read again after an action found the page out of date: a fresh
  // request, so it has the action's own change.
  const reloadLists = useCallback(() => {
    readRound.current += 1;
    void refresh(true);
  }, [refresh]);

  const setReservations = useCallback(
    (update: (prev: Reservation[]) => Reservation[]) =>
      setLists((prev) => ({ ...prev, reservations: update(prev.reservations) })),
    [setLists]
  );
  const setGifts = useCallback(
    (update: (prev: Gift[]) => Gift[]) =>
      setLists((prev) => ({ ...prev, gifts: update(prev.gifts) })),
    [setLists]
  );

  // Adds the entry "Mark as given" got back, in the history's newest-first
  // order. A read on its way meanwhile may predate it, so it's recorded for
  // that read to keep (see `merge`).
  function addGift(entry: Gift) {
    changes.added(entry._id);
    setGifts((prev) => [entry, ...prev.filter((g) => g._id !== entry._id)].sort(newestFirst));
  }

  // Takes a card off the page. A read on its way meanwhile may predate that,
  // so it's recorded for that read to leave off (see `merge`).
  function dropReservation(id: string) {
    changes.removed(id);
    setReservations((prev) => prev.filter((r) => r._id !== id));
  }

  function dropGift(id: string) {
    changes.removed(id);
    setGifts((prev) => prev.filter((g) => g._id !== id));
  }

  // The route's own 404: the record went away while this page was open. A
  // reservation was gifted, dismissed or unbooked in another tab or on another
  // device, or cleared when we became an owner of its list; a gift-history entry
  // was deleted elsewhere. Every retry would 404 the same way, so take the card
  // off the page. Any other failure keeps it, so the user can retry.
  //
  // The page is out of date, so both lists are read again too. A reservation
  // gone this way was most likely gifted, in another tab or by this tab's own
  // earlier "Mark as given" whose answer was lost, and its gift-history entry
  // should show, not look lost until a reload.
  function reservationGone(id: string) {
    dropReservation(id);
    showToast('This reservation no longer exists', 'info');
    reloadLists();
  }

  function giftGone(id: string) {
    dropGift(id);
    showToast('This gift is no longer in your history', 'info');
    reloadLists();
  }

  // One card action's request, bounded so a stalled one lets go of its card
  // (`run` holds it disabled until this settles) instead of waiting for the
  // browser to give up. The body is read inside the bound. A timeout lands in
  // the action's catch like any failure: it toasts and frees the card. The
  // server may still have done the write, which the next read shows.
  function send(url: string, init: RequestInit, keepalive = false) {
    return withRequestTimeout(async (signal) => {
      const res = await fetch(url, { ...init, signal, keepalive });
      return { res, result: await res.json() };
    });
  }

  function failureMessage(error: unknown) {
    return error instanceof RequestTimeoutError ? REQUEST_TIMEOUT_MESSAGE : 'Something went wrong';
  }

  // The Mark as given moment on a card whose gift the viewer has just marked
  // (WIS-407): its check mark and burst play, then the caller takes it off the
  // page. None in discreet mode or under reduced motion, which take it off at
  // once. The card stays held (`run`) while it plays.
  async function playGiven(id: string) {
    const moment = cardMotionFor('given', {
      isOwner: false,
      discreet: discreetNow.current,
      reducedMotion: prefersReducedMotion(),
    });
    if (!moment) return;
    setGivenIds((prev) => new Set(prev).add(id));
    await waitForMotion(moment);
    setGivenIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  // A card's Dismiss, Release, Leave or delete from history (WIS-387): the card
  // goes at once, with an Undo toast saying it's done, and `commit` sends the
  // request once the Undo window has passed (or the toast is dismissed, or the
  // page goes away). Undone, nothing is sent and the card comes back. The card
  // stays held (`run`) for the whole window and its request, so a read neither
  // brings it back nor drops it meanwhile; `commit` takes it off the lists
  // when the server has, and any other answer shows it again. A commit sent
  // after another account signed in still goes (the action was its account's),
  // but its answer is dropped, as every action's is.
  function deferCardAction(
    id: string,
    message: string,
    commit: (keepalive: boolean) => Promise<void>
  ) {
    return run(id, async () => {
      setHiddenIds((prev) => new Set(prev).add(id));
      const pending = offerUndo({ message, commit: ({ keepalive }) => commit(keepalive) });
      await pending.settled;
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
  }

  function markGifted(id: string) {
    return run(id, async () => {
      const actedFor = account.current;
      try {
        // Parsed with it, so a 404 that isn't the route's own JSON answer (an HTML
        // page from the platform) lands in the catch below and keeps the card.
        const { res, result } = await send(`/api/reservations/${id}/gift`, { method: 'POST' });
        // Another account signed in while this was on its way. What came of it
        // belongs to the account that did it, here and in the catch below.
        if (account.current !== actedFor) return;
        if (res.status === 404) {
          reservationGone(id);
          return;
        }
        if (result.success) {
          track('mark_given');
          showToast('Added to your gift history', 'success');
          await playGiven(id);
          // Signed in as someone else while it played: theirs is a fresh read.
          if (account.current !== actedFor) return;
          dropReservation(id);
          addGift(result.data);
        } else {
          showToast(result.error || 'Something went wrong', 'error');
        }
      } catch (error) {
        if (account.current === actedFor) showToast(failureMessage(error), 'error');
      }
    });
  }

  function dismiss(id: string) {
    const actedFor = account.current;
    return deferCardAction(id, 'Removed from your reservations', async (keepalive) => {
      try {
        // Parsed with it, and dropped after another account signs in, as in markGifted.
        const { res, result } = await send(
          `/api/reservations/${id}`,
          { method: 'DELETE' },
          keepalive
        );
        if (account.current !== actedFor) return;
        if (res.status === 404) {
          reservationGone(id);
          return;
        }
        if (result.success) {
          dropReservation(id);
        } else {
          showToast(result.error || 'Something went wrong', 'error');
        }
      } catch (error) {
        if (account.current === actedFor) showToast(failureMessage(error), 'error');
      }
    });
  }

  // Release, on a reservation still active: the list's own unbook
  // (`PATCH /api/items/[itemId]`), as Release on the list sends it, so the item is
  // freed for others and the route ends the Reservation exactly as an unbook
  // from the list does (`cancelUnbookedReservation`). The page has no way of
  // its own to free an item. A refusal means the card is out of date: it isn't
  // taken off (the Reservation is still there, and the route didn't touch it),
  // but both lists are read again, which shows it as it now is.
  function release(id: string) {
    const r = reservations.find((x) => x._id === id);
    // Taken off the page since the confirmation opened (by an action or a read
    // that has said so already): nothing to free.
    if (!r) return;
    // A read found it no longer active while the confirmation was open: say so,
    // as the route would have.
    if (needsConfirmation(r)) {
      showToast(RELEASE_REFUSED_MESSAGE, 'info');
      return;
    }
    const actedFor = account.current;
    return deferCardAction(
      id,
      'Released. Others on the list can reserve it now.',
      async (keepalive) => {
        try {
          // Parsed with it, and dropped after another account signs in, as in markGifted.
          const { res, result } = await send(
            `/api/items/${r.itemId}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'available' }),
            },
            keepalive
          );
          if (account.current !== actedFor) return;
          if (result.success) {
            dropReservation(id);
            track('release', { from: 'reserved_page' });
          } else if (RELEASE_REFUSED.has(res.status)) {
            showToast(RELEASE_REFUSED_MESSAGE, 'info');
            reloadLists();
          } else {
            showToast(result.error || 'Something went wrong', 'error');
          }
        } catch (error) {
          if (account.current === actedFor) showToast(failureMessage(error), 'error');
        }
      }
    );
  }

  // A group gift card's organizer marks the whole gift as given
  // (`POST /api/items/[itemId]/group-gift/given`): every contributor gets their
  // own gift-history entry with their share, and their cards go. Its answer is
  // the item, so both lists are read again for the new entry. A refusal (the
  // gift ended, or was handed on, meanwhile) says so and reads them again too.
  function giveGroupGift(id: string) {
    const r = reservations.find((x) => x._id === id);
    if (!r?.groupGift?.organizer) return;
    let keys = groupGiveKeys.current.get(id);
    if (!keys) {
      keys = createSubmissionKeys();
      groupGiveKeys.current.set(id, keys);
    }
    const idempotencyKey = keys.keyFor(id);
    return run(id, async () => {
      const actedFor = account.current;
      try {
        const { res, result } = await send(`/api/items/${r.itemId}/group-gift/given`, {
          method: 'POST',
          headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
        });
        if (account.current !== actedFor) return;
        if (result.success) {
          groupGiveKeys.current.delete(id);
          showToast('Marked as given', 'success');
          await playGiven(id);
          if (account.current !== actedFor) return;
          dropReservation(id);
          reloadLists();
        } else if (RELEASE_REFUSED.has(res.status)) {
          showToast((res.status === 409 && result.error) || GROUP_GIFT_OUT_OF_DATE, 'info');
          reloadLists();
        } else {
          showToast(result.error || 'Something went wrong', 'error');
        }
      } catch (error) {
        if (account.current === actedFor) showToast(failureMessage(error), 'error');
      }
    });
  }

  // Leave group gift, in place of Release on a group gift's card
  // (`DELETE /api/items/[itemId]/group-gift/me`): their Reservation goes, and an
  // organizer leaving hands the gift on (or ends it, as its last one).
  function leaveGroupGift(id: string) {
    const r = reservations.find((x) => x._id === id);
    if (!r?.groupGift) return;
    const actedFor = account.current;
    return deferCardAction(id, leftGroupGiftMessage(r.groupGift), async (keepalive) => {
      try {
        const { res, result } = await send(
          `/api/items/${r.itemId}/group-gift/me`,
          { method: 'DELETE' },
          keepalive
        );
        if (account.current !== actedFor) return;
        if (result.success) {
          dropReservation(id);
        } else if (RELEASE_REFUSED.has(res.status)) {
          showToast((res.status === 409 && result.error) || GROUP_GIFT_OUT_OF_DATE, 'info');
          reloadLists();
        } else {
          showToast(result.error || 'Something went wrong', 'error');
        }
      } catch (error) {
        if (account.current === actedFor) showToast(failureMessage(error), 'error');
      }
    });
  }

  function deleteGift(id: string) {
    const actedFor = account.current;
    return deferCardAction(id, 'Removed from your gift history', async (keepalive) => {
      try {
        // Parsed with it, and dropped after another account signs in, as in markGifted.
        const { res, result } = await send(`/api/gifts/${id}`, { method: 'DELETE' }, keepalive);
        if (account.current !== actedFor) return;
        if (res.status === 404) {
          giftGone(id);
          return;
        }
        if (result.success) {
          dropGift(id);
        } else {
          showToast(result.error || 'Something went wrong', 'error');
        }
      } catch (error) {
        if (account.current === actedFor) showToast(failureMessage(error), 'error');
      }
    });
  }

  return {
    // Without the cards whose Undo is on offer: they're gone as far as the
    // page shows, counts and sections included.
    reservations: hiddenIds.size ? reservations.filter((r) => !hiddenIds.has(r._id)) : reservations,
    gifts: hiddenIds.size ? gifts.filter((g) => !hiddenIds.has(g._id)) : gifts,
    loading,
    loadFailed,
    retryLoad,
    busy,
    givenIds,
    confirms: {
      gift: giftConfirm,
      setGift: setGiftConfirm,
      groupGive: groupGiveConfirm,
      setGroupGive: setGroupGiveConfirm,
    },
    actions: { markGifted, dismiss, release, giveGroupGift, leaveGroupGift, deleteGift },
  };
}
