'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import OwnHandle from '@/components/OwnHandle';
import WishlistList from '@/components/WishlistList';
import EmptyState from '@/components/EmptyState';
import LoadError from '@/components/LoadError';
import { WishlistListSkeleton } from '@/components/Skeleton';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import { signInPath } from '@/lib/utils/callbackUrl';
import { sortByUpcomingOccasion } from '@/lib/utils/occasion';
import { IWishlist } from '@/models/Wishlist';

type Wishlist = IWishlist & {
  ownerUsername?: string | null;
  itemCount?: number;
  /** The items you've reserved on it (`/api/wishlists`). */
  reservedByYou?: number;
  isMember?: boolean;
};

export default function SharedWishlistsPage() {
  const { data: session, status } = useKnownSession();
  const username = session?.user?.username ?? null;
  const router = useRouter();
  const [member, setMember] = useState<Wishlist[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed first read is not an empty one: it gets LoadError, never the empty state.
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(signInPath('/wishlists/shared'));
  }, [status, router]);

  const load = useCallback(() => {
    fetch('/api/wishlists', { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (!res.success) throw new Error('read failed');
        setMember(res.data?.member || []);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (status === 'authenticated') load();
  }, [status, load]);

  const retryLoad = () => {
    setLoadFailed(false);
    setLoading(true);
    load();
  };

  // The lists with an occasion coming up go first, nearest first, by your own
  // local date; the rest keep the API's order (newest first), which is also
  // the order until that date is known.
  const today = useLocalToday();
  const byOccasion = useMemo(() => sortByUpcomingOccasion(member, today), [member, today]);

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Shared with you</h1>
        <p className="mt-1 text-muted-foreground">Wishlists other people have invited you to.</p>

        {loading ? (
          <div className="mt-8">
            <WishlistListSkeleton count={8} showOwner />
          </div>
        ) : loadFailed ? (
          <div className="mt-8">
            <LoadError title="Couldn’t load your shared wishlists" onRetry={retryLoad} />
          </div>
        ) : member.length === 0 ? (
          <EmptyState
            className="mt-8"
            tone="muted"
            icon="users"
            title="Nothing shared yet"
            body={
              username ? (
                <>
                  Joining someone’s list? They invite you by username:{' '}
                  <OwnHandle username={username} />
                </>
              ) : (
                'When someone invites you to their wishlist, it’ll show up here.'
              )
            }
          />
        ) : (
          <div className="mt-8">
            {/* Every list here is one you're a member of: the page says so, so no Member badge. */}
            <WishlistList wishlists={byOccasion} shared />
          </div>
        )}
      </main>
    </div>
  );
}
