'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import WishlistCard from '@/components/WishlistCard';
import Icon from '@/components/Icon';
import { SkeletonGrid } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { signInPath } from '@/lib/utils/callbackUrl';
import { IWishlist } from '@/models/Wishlist';

type Wishlist = IWishlist & {
  ownerUsername?: string | null;
  itemCount?: number;
  isMember?: boolean;
};

export default function SharedWishlistsPage() {
  const { status } = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const [member, setMember] = useState<Wishlist[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(signInPath('/wishlists/shared'));
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/wishlists', { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setMember(res.data?.member || []);
        else showToast('Failed to load wishlists', 'error');
      })
      .catch(() => showToast('Failed to load wishlists', 'error'))
      .finally(() => setLoading(false));
  }, [status, showToast]);

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Shared with you</h1>
        <p className="mt-1 text-muted-foreground">Wishlists other people have invited you to.</p>

        {loading ? (
          <div className="mt-8">
            <SkeletonGrid count={8} variant="wishlist" />
          </div>
        ) : member.length === 0 ? (
          <div className="mt-8 flex flex-col items-center rounded-3xl border border-dashed border-border-strong py-20 text-center">
            <span className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-3xl bg-surface-2 text-muted-foreground">
              <Icon name="users" size={30} />
            </span>
            <h3 className="text-xl font-semibold text-foreground">Nothing shared yet</h3>
            <p className="mx-auto mt-2 max-w-sm px-4 text-[15px] text-muted-foreground">
              When someone invites you to their wishlist, it’ll show up here.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {member.map((w) => (
              <WishlistCard key={w._id.toString()} wishlist={w} showOwner />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
