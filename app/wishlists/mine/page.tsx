'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import WishlistCard from '@/components/WishlistCard';
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
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Your wishlists</h1>
        <p className="mt-1 text-muted-foreground">Wishlists you own.</p>

        {loading ? (
          <div className="mt-8">
            <SkeletonGrid count={8} variant="wishlist" />
          </div>
        ) : owned.length === 0 ? (
          <div className="mt-8 flex flex-col items-center rounded-3xl border border-dashed border-border-strong py-20 text-center">
            <span className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-3xl bg-primary-500/12 text-accent dark:text-primary-300">
              <Icon name="list" size={30} />
            </span>
            <h3 className="text-xl font-semibold text-foreground">No wishlists yet</h3>
            <p className="mx-auto mt-2 max-w-sm px-4 text-body text-muted-foreground">
              Create a wishlist from the header to start collecting things you love.
            </p>
          </div>
        ) : (
          <div className="mt-8 space-y-10">
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
    </div>
  );
}
