'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Icon from '@/components/Icon';
import Badge from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import LoadError from '@/components/LoadError';
import { Skeleton } from '@/components/Skeleton';
import OccasionLabel from '@/components/OccasionLabel';
import { useToast } from '@/components/ToastProvider';
import SnapshotThumb from '@/components/SnapshotThumb';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useBusyIds } from '@/lib/hooks/useBusyIds';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import { signInPath } from '@/lib/utils/callbackUrl';
import { formatPrice } from '@/lib/utils/currency';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';
import { createListChangeLog, mergeRefreshedList } from '@/lib/utils/listRefresh';
import type { Occasion } from '@/lib/utils/occasion';
import { withRequestTimeout } from '@/lib/utils/requestTimeout';
import { TONE_CLASSES } from '@/lib/utils/statusTones';
import {
  groupByOccasion,
  needsConfirmation,
  partitionReservations,
  reservationNote,
  type OccasionGroup,
} from '@/lib/utils/reservations';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';

interface Price {
  value: number;
  currency: string;
}

interface Reservation {
  _id: string;
  /** The reserved item's id, which Release sends the list's own unbook to. */
  itemId: string;
  itemName: string;
  itemImage: string | null;
  itemPrice: Price | null;
  wishlistName: string;
  wishlistId: string;
  /**
   * The live list's slug, `null` for a list that's gone or that the gifter can
   * no longer see (or a legacy one with none): the card links it by id then.
   */
  wishlistSlug: string | null;
  /** The live list's occasion, `null` for none or a list the gifter can no longer see. */
  wishlistOccasion: Occasion | null;
  itemStatus: string;
  /** The live item is still booked by the gifter. */
  stillReserved: boolean;
  /**
   * The gifter can still open the list (never why not). Still reserved on a
   * list they can open, the card is under "To give" and offers Release;
   * otherwise it needs their confirmation, and offers Dismiss. A card whose
   * list isn't open names it without a link.
   */
  listOpen: boolean;
}

interface Gift {
  _id: string;
  itemName: string;
  itemImage: string | null;
  itemPrice: Price | null;
  recipientUsername: string | null;
  wishlistName: string | null;
  wishlistId: string | null;
  giftedAt: string;
}

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

/** The gift history's order, as `GET /api/users/me/gifts` gives it: newest first. */
const newestFirst = (a: Gift, b: Gift) => Date.parse(b.giftedAt) - Date.parse(a.giftedAt);

/**
 * One of the page's lists, as the server has it, or `null` if reading it
 * failed. Bounded, so a read that stalls lets go of the page's next refresh
 * (see `load`) instead of holding it off for as long as the browser waits.
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

export default function BookedPage() {
  const { data: session, status } = useSession();
  const userId = session?.user?.id;
  const router = useRouter();
  const { showToast } = useToast();
  // The viewer's local date, which "To give" is grouped by: `null` until it's
  // known (see `useLocalToday`), and until then the cards aren't grouped.
  const today = useLocalToday();
  const locale = useViewerLocale();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [loading, setLoading] = useState(true);
  // The account's first load failed: said in place, with Try again, never as
  // "Nothing reserved yet". Until its lists have been shown (`shown`), every
  // read, a return to the tab's included, is a first load.
  const [loadFailed, setLoadFailed] = useState(false);
  const shown = useRef(false);
  // Reservations and gift-log entries whose action is still in flight, per id.
  const { busy, run, running } = useBusyIds();
  const [giftConfirm, setGiftConfirm] = useState<string | null>(null);
  const [dismissConfirm, setDismissConfirm] = useState<string | null>(null);
  const [releaseConfirm, setReleaseConfirm] = useState<string | null>(null);
  const [deleteGiftConfirm, setDeleteGiftConfirm] = useState<string | null>(null);
  // The page's own changes to both lists (their ids never clash), so a read of
  // them is merged with the changes made while it was on its way instead of
  // undoing them. See `load`.
  const [changes] = useState(createListChangeLog);
  // The stamp of the latest read sent, until it settles.
  const readInFlight = useRef<number | null>(null);
  // The account whose lists the page shows.
  const account = useRef(userId);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(signInPath('/booked'));
  }, [status, router]);

  // Another account signed in (from another tab): `status` stays
  // 'authenticated', so key on the user id. A layout effect, so the previous
  // account's cards are gone before the browser paints, and nothing still on its
  // way for that account, a read or an action's answer, lands on the new one's
  // page. A confirmation still open for one of its cards closes, so it can't
  // send that card's action as the new account. The busy ids stay: an action
  // still in flight frees its own card's id when it settles, and the new
  // account has no card with that id.
  useLayoutEffect(() => {
    account.current = userId;
    changes.reset();
    setReservations((prev) => (prev.length ? [] : prev));
    setGifts((prev) => (prev.length ? [] : prev));
    setGiftConfirm(null);
    setDismissConfirm(null);
    setReleaseConfirm(null);
    setDeleteGiftConfirm(null);
    setLoading(true);
    setLoadFailed(false);
    shown.current = false;
  }, [userId, changes]);

  // Reads both lists. Until the account's lists have been shown, a read is
  // their first load: the skeleton stands until it lands (`loading`), and it
  // shows both lists or neither, since one on its own would claim the other is
  // empty. If either fails, the page says so in their place, with Try again,
  // and no toast. A later read updates the cards in place, and one that fails
  // keeps them, silently (either list it did read still lands). Every read is
  // merged with what the page did while it was on its way (a gift, dismissal or
  // delete it may predate) and leaves a card whose action is in flight alone.
  // One outdated by a newer read, or by another account signing in, is ignored.
  const load = useCallback(() => {
    const sentAt = changes.stamp();
    readInFlight.current = sentAt;
    void Promise.all([
      readList<Reservation>('/api/users/me/reservations'),
      readList<Gift>('/api/users/me/gifts'),
    ]).then(([readReservations, readGifts]) => {
      if (readInFlight.current === sentAt) readInFlight.current = null;
      if (!shown.current && (!readReservations || !readGifts)) {
        if (changes.outdated(sentAt)) return;
        setLoadFailed(true);
        setLoading(false);
        return;
      }
      if (!readReservations && !readGifts) return;
      const since = changes.land(sentAt);
      if (!since) return;
      if (readReservations) {
        setReservations((prev) =>
          mergeRefreshedList(prev, readReservations, since, { held: running })
        );
      }
      if (readGifts) {
        setGifts((prev) =>
          mergeRefreshedList(prev, readGifts, since, { held: running, compare: newestFirst })
        );
      }
      shown.current = true;
      setLoadFailed(false);
      setLoading(false);
    });
  }, [changes, running]);

  // Try again, after the first load failed: the skeleton, then a fresh read,
  // unless a return to the tab has just sent one, which then decides.
  function retryLoad() {
    setLoadFailed(false);
    setLoading(true);
    if (readInFlight.current === null) load();
  }

  // Load, then read both lists again whenever the user comes back to the tab,
  // for reservations made, gifted or released, and gifts logged or deleted, in
  // another tab or on another device. Coming back to a tab fires both events,
  // and one read is enough: a return while a read is still on its way sends
  // none.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const refresh = () => {
      if (readInFlight.current === null) load();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    load();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [status, userId, load]);

  // Adds the entry "Mark as given" got back, in the history's newest-first
  // order. A read on its way meanwhile may predate it, so it's recorded for
  // that read to keep (see `load`).
  function addGift(entry: Gift) {
    changes.added(entry._id);
    setGifts((prev) => [entry, ...prev.filter((g) => g._id !== entry._id)].sort(newestFirst));
  }

  // Takes a card off the page. A read on its way meanwhile may predate that,
  // so it's recorded for that read to leave off (see `load`).
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
    load();
  }

  function giftGone(id: string) {
    dropGift(id);
    showToast('This gift is no longer in your history', 'info');
    load();
  }

  function markGifted(id: string) {
    return run(id, async () => {
      const actedFor = account.current;
      try {
        const res = await fetch(`/api/reservations/${id}/gift`, { method: 'POST' });
        // Parsed first, so a 404 that isn't the route's own JSON answer (an HTML
        // page from the platform) lands in the catch below and keeps the card.
        const result = await res.json();
        // Another account signed in while this was on its way. What came of it
        // belongs to the account that did it, here and in the catch below.
        if (account.current !== actedFor) return;
        if (res.status === 404) {
          reservationGone(id);
          return;
        }
        if (result.success) {
          dropReservation(id);
          addGift(result.data);
          showToast('Added to your gift history', 'success');
        } else {
          showToast(result.error || 'Something went wrong', 'error');
        }
      } catch {
        if (account.current === actedFor) showToast('Something went wrong', 'error');
      }
    });
  }

  function dismiss(id: string) {
    return run(id, async () => {
      const actedFor = account.current;
      try {
        const res = await fetch(`/api/reservations/${id}`, { method: 'DELETE' });
        // Parsed first, and dropped after another account signs in, as in markGifted.
        const result = await res.json();
        if (account.current !== actedFor) return;
        if (res.status === 404) {
          reservationGone(id);
          return;
        }
        if (result.success) {
          dropReservation(id);
          showToast('Removed from your reservations', 'success');
        } else {
          showToast(result.error || 'Something went wrong', 'error');
        }
      } catch {
        if (account.current === actedFor) showToast('Something went wrong', 'error');
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
    return run(id, async () => {
      const actedFor = account.current;
      try {
        const res = await fetch(`/api/items/${r.itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'available' }),
        });
        // Parsed first, and dropped after another account signs in, as in markGifted.
        const result = await res.json();
        if (account.current !== actedFor) return;
        if (result.success) {
          dropReservation(id);
          showToast('Released. Others on the list can reserve it now.', 'success');
        } else if (RELEASE_REFUSED.has(res.status)) {
          showToast(RELEASE_REFUSED_MESSAGE, 'info');
          load();
        } else {
          showToast(result.error || 'Something went wrong', 'error');
        }
      } catch {
        if (account.current === actedFor) showToast('Something went wrong', 'error');
      }
    });
  }

  function deleteGift(id: string) {
    return run(id, async () => {
      const actedFor = account.current;
      try {
        const res = await fetch(`/api/gifts/${id}`, { method: 'DELETE' });
        // Parsed first, and dropped after another account signs in, as in markGifted.
        const result = await res.json();
        if (account.current !== actedFor) return;
        if (res.status === 404) {
          giftGone(id);
          return;
        }
        if (result.success) {
          dropGift(id);
          showToast('Removed from your gift history', 'success');
        } else {
          showToast(result.error || 'Something went wrong', 'error');
        }
      } catch {
        if (account.current === actedFor) showToast('Something went wrong', 'error');
      }
    });
  }

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Reserved by you</h1>
        <p className="mt-1 text-muted-foreground">
          Gifts you’ve reserved across everyone’s wishlists. When you’ve given one, mark it as given
          to keep it in your gift history.
        </p>

        {loading ? (
          <div className="mt-8">
            <Skeleton className="mb-4 ml-1 h-6 w-24" />
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
                >
                  <div className="flex gap-3 p-3">
                    <Skeleton className="h-16 w-16 flex-shrink-0 rounded-xl" />
                    <div className="flex flex-1 flex-col gap-2 pt-1">
                      <Skeleton className="h-4 w-4/5" />
                      <Skeleton className="h-3 w-1/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                  <div className="flex gap-2 border-t border-border p-3">
                    <Skeleton className="h-9 flex-1 rounded-xl" />
                    <Skeleton className="h-9 w-20 rounded-xl" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : loadFailed ? (
          <div className="mt-8">
            <LoadError title="Couldn’t load your reservations" onRetry={retryLoad} />
          </div>
        ) : (
          <div className="mt-8 space-y-12">
            {reservations.length === 0 ? (
              <EmptyState
                icon="gift"
                title="Nothing reserved yet"
                body="When you reserve a gift on someone’s wishlist, it’ll show up here so you can keep track."
              />
            ) : (
              (() => {
                const { needsConfirm, active } = partitionReservations(reservations);
                // "To give", grouped by each list's upcoming occasion, afresh on
                // every render: a read or a card's action moves or drops cards
                // between groups. With no occasion coming up on any list there's
                // one group, and it needs no heading.
                const toGive = groupByOccasion(active, today);
                const headed = toGive.some((group) => group.occasion);
                return (
                  <>
                    {/* Detached reservations: the item changed after it was reserved,
                        so ask the gifter to resolve them. */}
                    {needsConfirm.length > 0 && (
                      <section>
                        <SectionHeading
                          title="Needs your confirmation"
                          count={needsConfirm.length}
                        />
                        <p className="-mt-2 mb-4 px-1 text-sm text-muted-foreground">
                          These changed after you reserved them. If you gave the gift, mark it so
                          it’s saved to your history — otherwise dismiss it. Either way, the owner’s
                          list isn’t affected.
                        </p>
                        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                          {needsConfirm.map((r) => (
                            <ReservationCard
                              key={r._id}
                              r={r}
                              busy={busy(r._id)}
                              highlight
                              onGift={() => setGiftConfirm(r._id)}
                              secondary={{
                                label: 'Dismiss',
                                title: 'Remove from reservations',
                                onClick: () => setDismissConfirm(r._id),
                              }}
                            />
                          ))}
                        </div>
                      </section>
                    )}

                    {/* Active reservations, by their list's upcoming occasion */}
                    <section>
                      <SectionHeading title="To give" count={active.length} />
                      {active.length === 0 ? (
                        <p className="px-1 text-sm text-muted-foreground">
                          Nothing actively reserved right now.
                        </p>
                      ) : (
                        <div className="space-y-8">
                          {toGive.map((group) => (
                            <ReservationGroup key={group.key} group={group} headed={headed}>
                              {group.reservations.map((r) => (
                                <ReservationCard
                                  key={r._id}
                                  r={r}
                                  busy={busy(r._id)}
                                  onGift={() => setGiftConfirm(r._id)}
                                  // Still reserved to them, on a list they can open:
                                  // Release frees it there too. Dismissing would
                                  // leave it reserved under their name, with
                                  // nothing tracking it.
                                  secondary={{
                                    label: 'Release',
                                    title: 'Release this gift so others can reserve it',
                                    onClick: () => setReleaseConfirm(r._id),
                                  }}
                                />
                              ))}
                            </ReservationGroup>
                          ))}
                        </div>
                      )}
                    </section>
                  </>
                );
              })()
            )}

            {/* Gift history */}
            {gifts.length > 0 && (
              <section>
                <SectionHeading title="Gift history" count={gifts.length} />
                <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
                  <ul className="divide-y divide-border">
                    {gifts.map((g) => (
                      <li key={g._id} className="flex items-center gap-3 p-3 sm:px-4">
                        <SnapshotThumb src={g.itemImage} alt={g.itemName} seed={g._id} small />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {g.itemName}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {/* What isn't known (a recipient, say) is left out, not stood in for. */}
                            {[
                              g.itemPrice ? formatPrice(g.itemPrice, locale) : null,
                              g.recipientUsername ? `to @${g.recipientUsername}` : null,
                              g.wishlistName,
                              new Date(g.giftedAt).toLocaleDateString(undefined, {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              }),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                        <IconButton
                          icon="trash"
                          label="Delete from gift history"
                          title="Delete from gift history"
                          variant="danger-ghost"
                          disabled={busy(g._id)}
                          onClick={() => setDeleteGiftConfirm(g._id)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {giftConfirm && (
        <ConfirmDialog
          isOpen
          title="Mark as given?"
          message="This adds the item to your gift history. It won’t change the owner’s list — they’ll mark it received themselves. You can remove it from your history later."
          confirmText="Mark as given"
          cancelText="Cancel"
          type="info"
          onConfirm={() => {
            markGifted(giftConfirm);
            setGiftConfirm(null);
          }}
          onCancel={() => setGiftConfirm(null)}
        />
      )}

      {dismissConfirm && (
        <ConfirmDialog
          isOpen
          title="Remove from reservations?"
          message="This removes it from your list without adding it to your gift history. It won’t change the owner’s list."
          confirmText="Remove"
          cancelText="Cancel"
          type="warning"
          onConfirm={() => {
            dismiss(dismissConfirm);
            setDismissConfirm(null);
          }}
          onCancel={() => setDismissConfirm(null)}
        />
      )}

      {releaseConfirm && (
        <ConfirmDialog
          isOpen
          title="Release this gift?"
          message="Others on the list will be able to reserve it."
          confirmText="Release"
          cancelText="Cancel"
          type="warning"
          onConfirm={() => {
            release(releaseConfirm);
            setReleaseConfirm(null);
          }}
          onCancel={() => setReleaseConfirm(null)}
        />
      )}

      {deleteGiftConfirm && (
        <ConfirmDialog
          isOpen
          title="Delete from gift history?"
          message="This permanently removes this entry from your gift history."
          confirmText="Delete"
          cancelText="Cancel"
          type="danger"
          onConfirm={() => {
            deleteGift(deleteGiftConfirm);
            setDeleteGiftConfirm(null);
          }}
          onCancel={() => setDeleteGiftConfirm(null)}
        />
      )}
    </div>
  );
}

/**
 * A reservation card's second action: Release on one still active, Dismiss on
 * one that needs confirmation.
 */
interface CardAction {
  label: 'Release' | 'Dismiss';
  title: string;
  onClick: () => void;
}

function ReservationCard({
  r,
  busy,
  highlight = false,
  onGift,
  secondary,
}: {
  r: Reservation;
  busy: boolean;
  highlight?: boolean;
  onGift: () => void;
  secondary: CardAction;
}) {
  const note = reservationNote(r);
  const locale = useViewerLocale();
  return (
    <div
      // The warning tone marks a card that needs the gifter's confirmation,
      // whatever happened to the item: it's not the item's status.
      className={`flex flex-col overflow-hidden rounded-2xl border bg-surface shadow-sm ${
        highlight ? TONE_CLASSES.warning.card : 'border-border'
      }`}
    >
      <div className="flex gap-3 p-3">
        <SnapshotThumb src={r.itemImage} alt={r.itemName} seed={r._id} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-foreground">{r.itemName}</p>
          {r.itemPrice && (
            <p className="text-sm font-medium text-muted-foreground">
              {formatPrice(r.itemPrice, locale)}
            </p>
          )}
          {r.listOpen ? (
            <Link
              href={`/wishlists/${r.wishlistSlug ?? r.wishlistId}`}
              className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline dark:text-primary-300"
            >
              <Icon name="gift" size={12} />
              {r.wishlistName}
            </Link>
          ) : (
            // A link would only lead to "not available": say so here instead,
            // unless the note already does (still reserved to them, it's the one
            // thing it says).
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Icon name="gift" size={12} />
              {r.stillReserved ? r.wishlistName : `${r.wishlistName} · no longer available to you`}
            </p>
          )}
          {note && (
            <p className="mt-1">
              <Badge tone="warning" size="sm" icon="info">
                {note}
              </Badge>
            </p>
          )}
        </div>
      </div>
      <div className="flex gap-2 border-t border-border p-3">
        <Button size="sm" icon="check" disabled={busy} onClick={onGift} className="flex-1">
          Mark as given
        </Button>
        <Button
          variant="cancel"
          size="sm"
          disabled={busy}
          onClick={secondary.onClick}
          title={secondary.title}
        >
          {secondary.label}
        </Button>
      </div>
    </div>
  );
}

/**
 * One group of "To give": a list's reservations under its upcoming occasion
 * ("Birthday · in 12 days", then the list's name), or the rest under "No date".
 */
function ReservationGroup({
  group,
  headed,
  children,
}: {
  group: OccasionGroup<Reservation>;
  headed: boolean;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headed ? headingId : undefined}>
      {headed && (
        <h3
          id={headingId}
          className="mb-3 flex min-w-0 items-center gap-2 px-1 text-sm font-semibold text-foreground"
        >
          {group.occasion ? (
            <>
              <OccasionLabel occasion={group.occasion} />{' '}
              <span className="truncate">{group.wishlistName}</span>
            </>
          ) : (
            'No date'
          )}
        </h3>
      )}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="mb-4 flex items-center gap-2 px-1 text-xl font-semibold tracking-tight text-foreground">
      {title}
      <Badge size="sm">{count}</Badge>
    </h2>
  );
}
