'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import AuthButton from '@/components/AuthButton';
import AppHeader from '@/components/AppHeader';
import WishlistCard from '@/components/WishlistCard';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import ShareButton from '@/components/ShareButton';
import FollowListModal, { type FollowTab } from '@/components/FollowListModal';
import { SkeletonGrid } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { IWishlist } from '@/models/Wishlist';

interface WishlistWithMembership extends IWishlist {
  isMember?: boolean;
  ownerUsername?: string | null;
  itemCount?: number;
}

interface Profile {
  _id: string;
  username: string;
  image?: string | null;
  bio?: string | null;
  isSelf: boolean;
  isFollowing: boolean;
  followsYou: boolean;
  isFriend: boolean;
  followerCount: number;
  followingCount: number;
}

export default function UserProfile() {
  const { data: session, status } = useSession();
  const params = useParams();
  const router = useRouter();
  const { showToast } = useToast();
  const username = typeof params?.username === 'string' ? params.username : null;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [wishlists, setWishlists] = useState<WishlistWithMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [restricted, setRestricted] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [followModal, setFollowModal] = useState<FollowTab | null>(null);

  useEffect(() => {
    async function load() {
      if (!username) return;

      try {
        setLoading(true);
        setRestricted(false);

        const userResponse = await fetch(`/api/users/by-username/${encodeURIComponent(username)}`, {
          cache: 'no-store',
        });
        if (!userResponse.ok) {
          if (userResponse.status === 404) {
            showToast('User not found', 'error');
            router.push('/');
            return;
          }
          throw new Error('Failed to fetch user');
        }
        const userResult = await userResponse.json();
        if (!userResult.success) throw new Error('Failed to fetch user');
        setProfile(userResult.data);

        const wishlistsResponse = await fetch(`/api/users/${userResult.data._id}/wishlists`, {
          cache: 'no-store',
        });
        if (wishlistsResponse.status === 403) {
          setRestricted(true);
          setWishlists([]);
          return;
        }
        if (!wishlistsResponse.ok) throw new Error('Failed to fetch wishlists');
        const wishlistsResult = await wishlistsResponse.json();
        if (wishlistsResult.success) setWishlists(wishlistsResult.data || []);
        else showToast('Failed to load wishlists', 'error');
      } catch (error) {
        console.error('Error fetching profile:', error);
        showToast('Failed to load profile', 'error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [username, session?.user?.username, router, showToast]);

  async function toggleFollow() {
    if (!profile || followBusy) return;
    if (!session?.user) {
      showToast('Sign in to follow people', 'info');
      return;
    }
    setFollowBusy(true);
    const next = !profile.isFollowing;
    // Optimistic update
    setProfile((p) =>
      p
        ? {
            ...p,
            isFollowing: next,
            isFriend: next && p.followsYou,
            followerCount: p.followerCount + (next ? 1 : -1),
          }
        : p
    );
    try {
      const res = await fetch(`/api/users/${profile._id}/follow`, {
        method: next ? 'POST' : 'DELETE',
      });
      const result = await res.json();
      if (!result.success) throw new Error();
    } catch {
      // Revert on failure
      setProfile((p) =>
        p
          ? {
              ...p,
              isFollowing: !next,
              isFriend: !next && p.followsYou,
              followerCount: p.followerCount + (next ? -1 : 1),
            }
          : p
      );
      showToast('Something went wrong', 'error');
    } finally {
      setFollowBusy(false);
    }
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen">
        <AppHeader actions={<AuthButton />} />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="skeleton h-16 w-16 rounded-full" />
              <div className="space-y-2">
                <div className="skeleton h-7 w-48 rounded-md" />
                <div className="skeleton h-4 w-40 rounded-md" />
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <div className="skeleton h-10 w-24 rounded-full" />
              <div className="skeleton h-10 w-28 rounded-full" />
            </div>
          </div>
          <SkeletonGrid count={8} variant="wishlist" />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {/* Profile header */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar name={profile?.username || 'User'} src={profile?.image} size="lg" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  @{profile?.username || 'user'}
                </h1>
                {profile?.isFriend && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary-500/12 px-2.5 py-1 text-xs font-semibold text-accent dark:text-primary-300">
                    <Icon name="users" size={12} />
                    Friends
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
                <button
                  type="button"
                  onClick={() => setFollowModal('followers')}
                  className="transition-colors hover:text-foreground"
                >
                  <span className="font-semibold text-foreground">
                    {profile?.followerCount ?? 0}
                  </span>{' '}
                  followers
                </button>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  onClick={() => setFollowModal('following')}
                  className="transition-colors hover:text-foreground"
                >
                  <span className="font-semibold text-foreground">
                    {profile?.followingCount ?? 0}
                  </span>{' '}
                  following
                </button>
                {profile?.followsYou && !profile.isFriend ? <span>· Follows you</span> : null}
              </div>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <ShareButton className="h-10 rounded-full px-4" />
            {profile?.isSelf && (
              <Link
                href="/settings"
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-border-strong bg-surface px-5 text-sm font-semibold text-foreground shadow-xs transition-colors hover:bg-surface-hover"
              >
                <Icon name="settings" size={16} />
                Edit profile
              </Link>
            )}
            {profile && !profile.isSelf && (
              <button
                onClick={toggleFollow}
                disabled={followBusy}
                className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-5 text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-50 ${
                  profile.isFollowing
                    ? 'border border-border-strong bg-surface text-foreground hover:bg-surface-hover'
                    : 'bg-primary-600 text-white shadow-[0_8px_22px_-10px_rgba(94,92,230,0.9)] hover:bg-primary-500'
                }`}
              >
                {profile.isFollowing ? (
                  'Following'
                ) : (
                  <>
                    <Icon name="plus" size={16} />
                    {profile.followsYou ? 'Follow back' : 'Follow'}
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Bio */}
        {profile?.bio && (
          <p className="mb-8 max-w-2xl whitespace-pre-line break-words text-[15px] leading-relaxed text-muted-foreground">
            {profile.bio}
          </p>
        )}

        {/* Content */}
        {restricted ? (
          <div className="flex flex-col items-center rounded-3xl border border-dashed border-border-strong py-16 text-center sm:py-20">
            <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Icon name="lock" size={28} />
            </span>
            <h3 className="text-lg font-semibold text-foreground sm:text-xl">
              Wishlists are private
            </h3>
            <p className="mx-auto mt-1.5 max-w-sm px-4 text-sm text-muted-foreground">
              @{profile?.username} only shares their wishlists with friends. Follow each other to
              connect.
            </p>
          </div>
        ) : wishlists.length === 0 ? (
          <div className="flex flex-col items-center rounded-3xl border border-dashed border-border-strong py-16 text-center sm:py-20">
            <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Icon name="list" size={28} />
            </span>
            <h3 className="text-lg font-semibold text-foreground sm:text-xl">
              No wishlists to show
            </h3>
            <p className="mx-auto mt-1.5 max-w-sm px-4 text-sm text-muted-foreground">
              This person has no wishlists you can view right now.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
            {wishlists.map((wishlist) => (
              <WishlistCard key={wishlist._id.toString()} wishlist={wishlist} showOwner />
            ))}
          </div>
        )}
      </main>

      {followModal && profile && (
        <FollowListModal
          userId={profile._id}
          initialTab={followModal}
          followerCount={profile.followerCount}
          followingCount={profile.followingCount}
          onClose={() => setFollowModal(null)}
        />
      )}
    </div>
  );
}
