'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Button from '@/components/Button';
import CreateWishlistModal from '@/components/CreateWishlistModal';
import WishlistCard from '@/components/WishlistCard';
import EmptyState from '@/components/EmptyState';
import Icon from '@/components/Icon';
import { SkeletonGrid } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import { signInPath } from '@/lib/utils/callbackUrl';
import { sortByUpcomingOccasion } from '@/lib/utils/occasion';
import { IWishlist } from '@/models/Wishlist';

type Wishlist = IWishlist & {
  ownerUsername?: string | null;
  itemCount?: number;
  isMember?: boolean;
};

export default function MyWishlistsPage() {
  const { status } = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const [owned, setOwned] = useState<Wishlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(signInPath('/wishlists/mine'));
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/wishlists', { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setOwned(res.data?.owned || []);
        else showToast('Failed to load wishlists', 'error');
      })
      .catch(() => showToast('Failed to load wishlists', 'error'))
      .finally(() => setLoading(false));
  }, [status, showToast]);

  // In each section, the lists with an occasion coming up go first, nearest
  // first; the rest keep the API's order (newest first).
  const today = useLocalToday();
  const active = useMemo(
    () =>
      sortByUpcomingOccasion(
        owned.filter((w) => !w.archived),
        today
      ),
    [owned, today]
  );
  const archived = useMemo(
    () =>
      sortByUpcomingOccasion(
        owned.filter((w) => w.archived),
        today
      ),
    [owned, today]
  );

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {/* New list is offered while the lists load too: it claims nothing about them. */}
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Your wishlists</h1>
          <Button
            variant="secondary"
            size="sm"
            shape="pill"
            icon="plus"
            onClick={() => setShowCreate(true)}
          >
            New list
          </Button>
        </div>
        <p className="mt-1 text-muted-foreground">Wishlists you own.</p>

        {loading ? (
          <div className="mt-8">
            <SkeletonGrid count={8} variant="wishlist" />
          </div>
        ) : owned.length === 0 ? (
          <EmptyState
            className="mt-8"
            icon="list"
            title="No wishlists yet"
            body="Create a wishlist to start collecting things you love."
            actions={
              <Button icon="plus" onClick={() => setShowCreate(true)}>
                New list
              </Button>
            }
          />
        ) : (
          <div className="mt-8 space-y-12">
            {active.length > 0 && (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {active.map((w) => (
                  <WishlistCard key={w._id.toString()} wishlist={w} />
                ))}
              </div>
            )}
            {archived.length > 0 && (
              <section>
                <h2 className="mb-5 flex items-center gap-2 px-1 text-xl font-semibold tracking-tight text-muted-foreground">
                  <Icon name="package" size={18} />
                  Archived
                </h2>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {archived.map((w) => (
                    <WishlistCard key={w._id.toString()} wishlist={w} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
      <CreateWishlistModal isOpen={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
