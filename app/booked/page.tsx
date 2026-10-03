'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Icon from '@/components/Icon';
import OccasionLabel from '@/components/OccasionLabel';
import { useToast } from '@/components/ToastProvider';
import SnapshotThumb from '@/components/SnapshotThumb';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useBusyIds } from '@/lib/hooks/useBusyIds';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import { signInPath } from '@/lib/utils/callbackUrl';
import { formatPriceFromObject } from '@/lib/utils/currency';
import { createListChangeLog, mergeRefreshedList } from '@/lib/utils/listRefresh';
import type { Occasion } from '@/lib/utils/occasion';
import { withRequestTimeout } from '@/lib/utils/requestTimeout';
import {
  groupByOccasion,
  partitionReservations,
  reservationNote,
  type OccasionGroup,
} from '@/lib/utils/reservations';

interface Price {
  value: number;
  currency: string;
}

interface Reservation {
  _id: string;
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
  stillReserved: boolean;
}

interface Gift {
  _id: string;
  itemName: string;
  itemImage: string | null;
  itemPrice: Price | null;
  recipientUsername: string | null;
  wishlistName: string | null;
  wishlistId: string | null;
  /** As a reservation's: `null` for a list that's gone or the gifter can no longer see. */
  wishlistSlug: string | null;
  giftedAt: string;
}

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
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [loading, setLoading] = useState(true);
  // Reservations and gift-log entries whose action is still in flight, per id.
  const { busy, run, running } = useBusyIds();
  const [giftConfirm, setGiftConfirm] = useState<string | null>(null);
  const [dismissConfirm, setDismissConfirm] = useState<string | null>(null);
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
    setDeleteGiftConfirm(null);
    setLoading(true);
  }, [userId, changes]);

  // Reads both lists. An account's first load (`quiet` false) shows the
  // skeleton until it lands, and says so if it fails. A later read updates the
  // cards in place, and one that fails keeps them, silently. Every read is
  // merged with what the page did while it was on its way (a gift, dismissal or
  // delete it may predate) and leaves a card whose action is in flight alone.
  // One outdated by a newer read, or by another account signing in, is ignored.
  const load = useCallback(
    (quiet: boolean) => {
      const sentAt = changes.stamp();
      readInFlight.current = sentAt;
      void Promise.all([
        readList<Reservation>('/api/users/me/reservations'),
        readList<Gift>('/api/users/me/gifts'),
      ]).then(([readReservations, readGifts]) => {
        if (readInFlight.current === sentAt) readInFlight.current = null;
        if (!readReservations && !readGifts) {
          if (quiet || changes.outdated(sentAt)) return;
          showToast('Failed to load your reservations', 'error');
          setLoading(false);
          return;
        }
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
        if (quiet) return;
        if (!readReservations || !readGifts) showToast('Failed to load some data', 'error');
        setLoading(false);
      });
    },
    [changes, running, showToast]
  );

  // Load, then read both lists again whenever the user comes back to the tab,
  // for reservations made, gifted or released, and gifts logged or deleted, in
  // another tab or on another device. Coming back to a tab fires both events,
  // and one read is enough: a return while a read is still on its way sends
  // none.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const refresh = () => {
      if (readInFlight.current === null) load(true);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    load(false);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [status, userId, load]);

  // Adds the entry "Mark as gifted" got back, in the history's newest-first
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
  // earlier "Mark as gifted" whose answer was lost, and its gift-history entry
  // should show, not look lost until a reload.
  function reservationGone(id: string) {
    dropReservation(id);
    showToast('This reservation no longer exists', 'info');
    load(true);
  }

  function giftGone(id: string) {
    dropGift(id);
    showToast('This gift is no longer in your history', 'info');
    load(true);
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
          Gifts you’ve claimed across everyone’s wishlists. When you’ve given one, mark it as gifted
          to keep it in your gift history.
        </p>

        {loading ? (
          <div className="mt-8">
            <div className="skeleton mb-4 ml-1 h-6 w-24 rounded-md" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
                >
                  <div className="flex gap-3 p-3">
                    <div className="skeleton h-16 w-16 flex-shrink-0 rounded-xl" />
                    <div className="flex flex-1 flex-col gap-2 pt-1">
                      <div className="skeleton h-4 w-4/5 rounded-md" />
                      <div className="skeleton h-3 w-1/3 rounded-md" />
                      <div className="skeleton h-3 w-1/2 rounded-md" />
                    </div>
                  </div>
                  <div className="flex gap-2 border-t border-border p-3">
                    <div className="skeleton h-9 flex-1 rounded-xl" />
                    <div className="skeleton h-9 w-20 rounded-xl" />
                  </div>
                </div>
              ))}
            </div>
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
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          {needsConfirm.map((r) => (
                            <ReservationCard
                              key={r._id}
                              r={r}
                              busy={busy(r._id)}
                              highlight
                              onGift={() => setGiftConfirm(r._id)}
                              onDismiss={() => setDismissConfirm(r._id)}
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
                                  onDismiss={() => setDismissConfirm(r._id)}
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
                            {g.itemPrice && <>{formatPriceFromObject(g.itemPrice)} · </>}
                            {g.recipientUsername ? `to @${g.recipientUsername}` : 'gift'}
                            {g.wishlistName ? ` · ${g.wishlistName}` : ''}
                            {' · '}
                            {new Date(g.giftedAt).toLocaleDateString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </p>
                        </div>
                        <button
                          disabled={busy(g._id)}
                          onClick={() => setDeleteGiftConfirm(g._id)}
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-red-600 disabled:opacity-50"
                          aria-label="Delete from gift history"
                          title="Delete from gift history"
                        >
                          <Icon name="trash" size={16} />
                        </button>
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
          title="Mark as gifted?"
          message="This adds the item to your gift history. It won’t change the owner’s list — they’ll mark it received themselves. You can remove it from your history later."
          confirmText="Mark as gifted"
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

function ReservationCard({
  r,
  busy,
  highlight = false,
  onGift,
  onDismiss,
}: {
  r: Reservation;
  busy: boolean;
  highlight?: boolean;
  onGift: () => void;
  onDismiss: () => void;
}) {
  const note = reservationNote(r);
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl border bg-surface shadow-sm ${
        highlight ? 'border-amber-500/50 ring-1 ring-amber-500/30' : 'border-border'
      }`}
    >
      <div className="flex gap-3 p-3">
        <SnapshotThumb src={r.itemImage} alt={r.itemName} seed={r._id} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-foreground">{r.itemName}</p>
          {r.itemPrice && (
            <p className="text-sm font-medium text-muted-foreground">
              {formatPriceFromObject(r.itemPrice)}
            </p>
          )}
          <Link
            href={`/wishlists/${r.wishlistSlug ?? r.wishlistId}`}
            className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:underline dark:text-primary-300"
          >
            <Icon name="gift" size={12} />
            {r.wishlistName}
          </Link>
          {note && (
            <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
              <Icon name="info" size={11} />
              {note}
            </p>
          )}
        </div>
      </div>
      <div className="flex gap-2 border-t border-border p-3">
        <button
          disabled={busy}
          onClick={onGift}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary-600 text-[13px] font-semibold text-white transition-colors hover:bg-primary-500 disabled:opacity-50"
        >
          <Icon name="check" size={15} />
          Mark as gifted
        </button>
        <button
          disabled={busy}
          onClick={onDismiss}
          className="flex h-9 items-center justify-center gap-1.5 rounded-xl bg-surface-2 px-3 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          title="Remove from reservations"
        >
          Dismiss
        </button>
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="mb-4 flex items-center gap-2 px-1 text-lg font-semibold tracking-tight text-foreground">
      {title}
      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
        {count}
      </span>
    </h2>
  );
}

function EmptyState({ icon, title, body }: { icon: 'gift'; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center rounded-3xl border border-dashed border-border-strong py-16 text-center">
      <span className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-3xl bg-primary-500/12 text-accent dark:text-primary-300">
        <Icon name={icon} size={30} />
      </span>
      <h3 className="text-xl font-semibold text-foreground">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm px-4 text-[15px] text-muted-foreground">{body}</p>
    </div>
  );
}
