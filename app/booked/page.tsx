'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Icon from '@/components/Icon';
import { useToast } from '@/components/ToastProvider';
import BannerImage from '@/components/BannerImage';
import ConfirmDialog from '@/components/ConfirmDialog';
import { formatPriceFromObject } from '@/lib/utils/currency';
import { coverGradient } from '@/lib/utils/cover';
import { partitionReservations, reservationNote } from '@/lib/utils/reservations';

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
  wishlistSlug: string | null;
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
  wishlistSlug: string | null;
  giftedAt: string;
}

export default function BookedPage() {
  const { status } = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [giftConfirm, setGiftConfirm] = useState<string | null>(null);
  const [dismissConfirm, setDismissConfirm] = useState<string | null>(null);
  const [deleteGiftConfirm, setDeleteGiftConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
  }, [status, router]);

  useEffect(() => {
    async function load() {
      try {
        const [rRes, gRes] = await Promise.all([
          fetch('/api/users/me/reservations', { cache: 'no-store' }),
          fetch('/api/users/me/gifts', { cache: 'no-store' }),
        ]);
        const rJson = await rRes.json();
        const gJson = await gRes.json();
        if (rJson.success) setReservations(rJson.data);
        if (gJson.success) setGifts(gJson.data);
        if (!rJson.success || !gJson.success) showToast('Failed to load some data', 'error');
      } catch {
        showToast('Failed to load your reservations', 'error');
      } finally {
        setLoading(false);
      }
    }
    if (status === 'authenticated') load();
  }, [status, showToast]);

  async function refreshGifts() {
    try {
      const res = await fetch('/api/users/me/gifts', { cache: 'no-store' });
      const json = await res.json();
      if (json.success) setGifts(json.data);
    } catch {
      /* ignore */
    }
  }

  async function markGifted(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/reservations/${id}/gift`, { method: 'POST' });
      const result = await res.json();
      if (result.success) {
        setReservations((prev) => prev.filter((r) => r._id !== id));
        await refreshGifts();
        showToast('Added to your gift history', 'success');
      } else {
        showToast(result.error || 'Something went wrong', 'error');
      }
    } catch {
      showToast('Something went wrong', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/reservations/${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.success) {
        setReservations((prev) => prev.filter((r) => r._id !== id));
        showToast('Removed from your reservations', 'success');
      } else {
        showToast(result.error || 'Something went wrong', 'error');
      }
    } catch {
      showToast('Something went wrong', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function deleteGift(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/gifts/${id}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.success) {
        setGifts((prev) => prev.filter((g) => g._id !== id));
        showToast('Removed from your gift history', 'success');
      } else {
        showToast(result.error || 'Something went wrong', 'error');
      }
    } catch {
      showToast('Something went wrong', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Reserved by you</h1>
        <p className="mt-1 text-muted-foreground">
          Gifts you’ve claimed across everyone’s wishlists. When you’ve given one, mark it as gifted
          to keep it in your gift history.
        </p>

        {loading ? (
          <div className="mt-8">
            <div className="skeleton mb-4 ml-1 h-6 w-24 rounded-md" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {needsConfirm.map((r) => (
                            <ReservationCard
                              key={r._id}
                              r={r}
                              busy={busy === r._id}
                              highlight
                              onGift={() => setGiftConfirm(r._id)}
                              onDismiss={() => setDismissConfirm(r._id)}
                            />
                          ))}
                        </div>
                      </section>
                    )}

                    {/* Active reservations */}
                    <section>
                      <SectionHeading title="To give" count={active.length} />
                      {active.length === 0 ? (
                        <p className="px-1 text-sm text-muted-foreground">
                          Nothing actively reserved right now.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {active.map((r) => (
                            <ReservationCard
                              key={r._id}
                              r={r}
                              busy={busy === r._id}
                              onGift={() => setGiftConfirm(r._id)}
                              onDismiss={() => setDismissConfirm(r._id)}
                            />
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
                        <Thumb src={g.itemImage} alt={g.itemName} seed={g._id} small />
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
                          disabled={busy === g._id}
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
        <Thumb src={r.itemImage} alt={r.itemName} seed={r._id} />
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

function Thumb({
  src,
  alt,
  seed,
  small = false,
}: {
  src: string | null;
  alt: string;
  seed: string;
  small?: boolean;
}) {
  const size = small ? 'h-11 w-11' : 'h-16 w-16';
  return (
    <div
      className={`relative ${size} flex-shrink-0 overflow-hidden rounded-xl bg-surface-2`}
      style={{ background: src ? undefined : coverGradient(seed) }}
    >
      {src && <BannerImage src={src} alt={alt} sizes="64px" />}
    </div>
  );
}
