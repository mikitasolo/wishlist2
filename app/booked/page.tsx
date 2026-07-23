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

interface BookedItem {
  _id: string;
  name: string;
  imageUrl: string | null;
  price: { value: number; currency: string } | null;
  link: string | null;
  giftedAt: string | null;
  wishlistId: string;
  wishlistSlug: string | null;
  wishlistName: string;
}

export default function BookedPage() {
  const { status } = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const [items, setItems] = useState<BookedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [giftConfirm, setGiftConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
  }, [status, router]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/users/me/booked', { cache: 'no-store' });
        const result = await res.json();
        if (result.success) setItems(result.data);
        else showToast('Failed to load your reservations', 'error');
      } catch {
        showToast('Failed to load your reservations', 'error');
      } finally {
        setLoading(false);
      }
    }
    if (status === 'authenticated') load();
  }, [status, showToast]);

  async function setGifted(id: string, gifted: boolean) {
    setBusy(id);
    try {
      const res = await fetch(`/api/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gifted }),
      });
      const result = await res.json();
      if (result.success) {
        setItems((prev) =>
          prev.map((it) =>
            it._id === id ? { ...it, giftedAt: gifted ? new Date().toISOString() : null } : it
          )
        );
        showToast(gifted ? 'Marked as gifted' : 'Moved back to “To give”', 'success');
      } else {
        showToast(result.error || 'Something went wrong', 'error');
      }
    } catch {
      showToast('Something went wrong', 'error');
    } finally {
      setBusy(null);
    }
  }

  const active = items.filter((i) => !i.giftedAt);
  const gifted = items.filter((i) => i.giftedAt);

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Reserved by you</h1>
        <p className="mt-1 text-muted-foreground">
          Gifts you’ve claimed across everyone’s wishlists. Marking one as gifted completes it on
          the owner’s list and moves it to your “Gifted” archive — you can undo it anytime.
        </p>

        {loading ? (
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton h-24 rounded-2xl" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="mt-8 flex flex-col items-center rounded-3xl border border-dashed border-border-strong py-20 text-center">
            <span className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-3xl bg-primary-500/12 text-accent dark:text-primary-300">
              <Icon name="check-circle" size={30} />
            </span>
            <h3 className="text-xl font-semibold text-foreground">Nothing reserved yet</h3>
            <p className="mx-auto mt-2 max-w-sm px-4 text-[15px] text-muted-foreground">
              When you reserve a gift on someone’s wishlist, it’ll show up here so you can keep
              track.
            </p>
          </div>
        ) : (
          <div className="mt-8 space-y-10">
            {active.length > 0 && (
              <Section
                title="To give"
                items={active}
                busy={busy}
                onGift={(id) => setGiftConfirm(id)}
              />
            )}
            {gifted.length > 0 && (
              <Section
                title="Gifted"
                items={gifted}
                busy={busy}
                onUndo={(id) => setGifted(id, false)}
                muted
              />
            )}
          </div>
        )}
      </main>

      {giftConfirm && (
        <ConfirmDialog
          isOpen
          title="Mark as gifted?"
          message="This completes the item on the owner’s list and unassigns it from you. It moves to your “Gifted” archive — you can undo it anytime."
          confirmText="Mark as gifted"
          cancelText="Cancel"
          type="info"
          onConfirm={() => {
            setGifted(giftConfirm, true);
            setGiftConfirm(null);
          }}
          onCancel={() => setGiftConfirm(null)}
        />
      )}
    </div>
  );
}

function BookedThumb({ src, alt, seed }: { src: string | null; alt: string; seed: string }) {
  return (
    <div
      className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl bg-surface-2"
      style={{ background: src ? undefined : coverGradient(seed) }}
    >
      {src && <BannerImage src={src} alt={alt} sizes="64px" />}
    </div>
  );
}

function Section({
  title,
  items,
  busy,
  onGift,
  onUndo,
  muted = false,
}: {
  title: string;
  items: BookedItem[];
  busy: string | null;
  onGift?: (id: string) => void;
  onUndo?: (id: string) => void;
  muted?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 px-1 text-lg font-semibold tracking-tight text-foreground">
        {title}
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
          {items.length}
        </span>
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <div
            key={it._id}
            className={`flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm ${
              muted ? 'opacity-80' : ''
            }`}
          >
            <div className="flex gap-3 p-3">
              <BookedThumb src={it.imageUrl} alt={it.name} seed={it._id} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-foreground">{it.name}</p>
                {it.price && (
                  <p className="text-sm font-medium text-muted-foreground">
                    {formatPriceFromObject(it.price)}
                  </p>
                )}
                <Link
                  href={`/wishlists/${it.wishlistSlug ?? it.wishlistId}`}
                  className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-300 hover:underline"
                >
                  <Icon name="gift" size={12} />
                  {it.wishlistName}
                </Link>
              </div>
            </div>
            <div className="flex gap-2 border-t border-border p-3">
              {it.link && (
                <a
                  href={it.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-surface-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted"
                >
                  <Icon name="external-link" size={15} />
                  View
                </a>
              )}
              {onGift && (
                <button
                  disabled={busy === it._id}
                  onClick={() => onGift(it._id)}
                  className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary-600 text-[13px] font-semibold text-white transition-colors hover:bg-primary-500 disabled:opacity-50"
                >
                  <Icon name="check" size={15} />
                  Mark as gifted
                </button>
              )}
              {onUndo && (
                <button
                  disabled={busy === it._id}
                  onClick={() => onUndo(it._id)}
                  className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-surface-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  Undo
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
