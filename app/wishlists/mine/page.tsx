'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Button from '@/components/Button';
import CreateWishlistModal from '@/components/CreateWishlistModal';
import WishlistList, { ArchivedLists } from '@/components/WishlistList';
import EmptyState from '@/components/EmptyState';
import { WishlistListSkeleton } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import { usePinToTop } from '@/lib/hooks/usePinToTop';
import { signInPath } from '@/lib/utils/callbackUrl';
import { sortByUpcomingOccasion } from '@/lib/utils/occasion';
import { pinnedFirst } from '@/lib/utils/pinnedLists';
import { IWishlist } from '@/models/Wishlist';

type Wishlist = IWishlist & {
  ownerUsername?: string | null;
  itemCount?: number;
  isMember?: boolean;
};

export default function MyWishlistsPage() {
  const { data: session, status } = useSession();
  const viewerId = session?.user?.id ?? null;
  const router = useRouter();
  const { showToast } = useToast();
  const [owned, setOwned] = useState<Wishlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  // Pin to top: per-owner, one at a time (`usePinToTop`).
  const { pinning, toggle: togglePin } = usePinToTop(setOwned);
  const pins = useMemo(() => ({ pinning, onToggle: togglePin }), [pinning, togglePin]);

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
  // first; the rest keep the API's order (newest first). Your pinned list goes
  // above them all, as on Home.
  const today = useLocalToday();
  const active = useMemo(
    () =>
      pinnedFirst(
        sortByUpcomingOccasion(
          owned.filter((w) => !w.archived),
          today
        )
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
            <WishlistListSkeleton count={8} />
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
              <WishlistList wishlists={active} viewerId={viewerId} pins={pins} />
            )}
            {/* Archived, folded away at the end: open when it's all there is. */}
            <ArchivedLists
              wishlists={archived}
              viewerId={viewerId}
              defaultOpen={active.length === 0}
            />
          </div>
        )}
      </main>
      <CreateWishlistModal isOpen={showCreate} onClose={() => setShowCreate(false)} />
    </div>
  );
}
