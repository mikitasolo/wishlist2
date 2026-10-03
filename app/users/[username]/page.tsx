'use client';

import { useEffect, useState } from 'react';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import AuthButton from '@/components/AuthButton';
import AppHeader from '@/components/AppHeader';
import WishlistCard from '@/components/WishlistCard';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import ShareButton from '@/components/ShareButton';
import FollowListModal, { type FollowTab } from '@/components/FollowListModal';
import CreateWishlistModal from '@/components/CreateWishlistModal';
import Button from '@/components/Button';
import GlobalSearch from '@/components/GlobalSearch';
import LoadError from '@/components/LoadError';
import StatePanel from '@/components/StatePanel';
import { buttonClassName, CONTROL_ICON_SIZE } from '@/components/buttonStyles';
import { SkeletonGrid } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { pluralNoun } from '@/lib/utils/plural';
import { readResource } from '@/lib/utils/resourceRead';
import { IWishlist } from '@/models/Wishlist';
import { FOLLOWERS_PARAM } from '@/lib/utils/profileLinks';

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
  const { showToast } = useToast();
  const username = typeof params?.username === 'string' ? params.username : null;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [wishlists, setWishlists] = useState<WishlistWithMembership[]>([]);
  const [loading, setLoading] = useState(true);
  // The profile couldn't be shown: no one goes by this username (`missing`), or
  // reading it failed in a way Try again may fix (`failed`, `attempt`). Either
  // is said in place, at this URL, with no toast.
  const [profileLoad, setProfileLoad] = useState<'shown' | 'missing' | 'failed'>('shown');
  const [attempt, setAttempt] = useState(0);
  const [restricted, setRestricted] = useState(false);
  // The profile is shown, but its wishlists couldn't be read: said in their
  // place, with Try again, never as "No wishlists to show".
  const [listsFailed, setListsFailed] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const viewerId = session?.user?.id ?? null;

  // `?followers=1` (`followersHref`, which a follow notification links to)
  // opens the followers list as soon as the profile has loaded.
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [followModal, setFollowModal] = useState<FollowTab | null>(() =>
    searchParams.has(FOLLOWERS_PARAM) ? 'followers' : null
  );

  // Closing it takes the parameter off the URL, so a reload or a shared link
  // doesn't open it again. A history replace, not a navigation, which would
  // race with a click on someone in the list.
  function closeFollowModal() {
    setFollowModal(null);
    if (!searchParams.has(FOLLOWERS_PARAM)) return;
    const rest = new URLSearchParams(searchParams.toString());
    rest.delete(FOLLOWERS_PARAM);
    const query = rest.toString();
    window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname);
  }

  // What the profile shows depends on who's looking, so it waits for the
  // session's first read (`status`) rather than loading both before and after
  // it, and loads again only when the viewer changes: signing in or out, or
  // another account taking over the session.
  useEffect(() => {
    if (status === 'loading') return;
    // A load a newer one has replaced (the viewer changed meanwhile, Try again)
    // is dropped, so it can't put back what the previous viewer could see, or
    // let a late failure replace a profile a newer load has shown.
    let current = true;

    async function load() {
      if (!username) return;

      try {
        setLoading(true);
        setRestricted(false);
        setListsFailed(false);
        setProfileLoad('shown');

        const read = await readResource<Profile>(
          `/api/users/by-username/${encodeURIComponent(username)}`
        );
        if (!current) return;
        if (read.outcome !== 'loaded') {
          if (read.outcome === 'failed') console.error('Error fetching profile:', read.error);
          setProfile(null);
          setProfileLoad(read.outcome === 'refused' ? 'missing' : 'failed');
          return;
        }
        const user = read.data;
        setProfile(user);

        const wishlistsResponse = await fetch(`/api/users/${user._id}/wishlists`, {
          cache: 'no-store',
        });
        if (!current) return;
        if (wishlistsResponse.status === 403) {
          setRestricted(true);
          setWishlists([]);
          return;
        }
        if (!wishlistsResponse.ok) throw new Error('Failed to fetch wishlists');
        const wishlistsResult = await wishlistsResponse.json();
        if (!current) return;
        if (!wishlistsResult.success) throw new Error('Failed to fetch wishlists');
        setWishlists(wishlistsResult.data || []);
      } catch (error) {
        if (!current) return;
        console.error('Error fetching profile:', error);
        setWishlists([]);
        setListsFailed(true);
      } finally {
        if (current) setLoading(false);
      }
    }
    load();
    return () => {
      current = false;
    };
  }, [username, status, viewerId, attempt]);

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
              <div className="skeleton h-9 w-24 rounded-full" />
              <div className="skeleton h-9 w-28 rounded-full" />
            </div>
          </div>
          <SkeletonGrid count={8} variant="wishlist" />
        </main>
      </div>
    );
  }

  if (profileLoad !== 'shown') {
    return (
      <div className="min-h-screen">
        <AppHeader actions={<AuthButton />} />
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {profileLoad === 'missing' ? (
            <StatePanel
              icon="user"
              level={1}
              title={`No one goes by @${username}`}
              body="Check the spelling, or search for them."
              actions={
                <Link href="/" className={buttonClassName({ variant: 'secondary' })}>
                  {session?.user ? 'Back to your wishlists' : 'Go home'}
                </Link>
              }
            >
              <GlobalSearch variant="inline" />
            </StatePanel>
          ) : (
            <LoadError
              level={1}
              title="Couldn’t load this profile"
              onRetry={() => setAttempt((n) => n + 1)}
            />
          )}
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
                <h1 className="truncate text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  @{profile?.username || 'user'}
                </h1>
                {profile?.isFriend && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary-500/12 px-2.5 py-1 text-badge font-semibold text-accent dark:text-primary-300">
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
                  {pluralNoun(profile?.followerCount ?? 0, 'follower')}
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
                  {pluralNoun(profile?.followingCount ?? 0, 'following')}
                </button>
                {profile?.followsYou && !profile.isFriend ? <span>· Follows you</span> : null}
              </div>
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <ShareButton />
            {profile?.isSelf && (
              <Link
                href="/settings"
                className={buttonClassName({ variant: 'secondary', size: 'sm', shape: 'pill' })}
              >
                <Icon name="settings" size={CONTROL_ICON_SIZE.sm} />
                Edit profile
              </Link>
            )}
            {profile && !profile.isSelf && (
              <Button
                variant={profile.isFollowing ? 'secondary' : 'primary'}
                size="sm"
                shape="pill"
                icon={profile.isFollowing ? undefined : 'plus'}
                onClick={toggleFollow}
                disabled={followBusy}
              >
                {profile.isFollowing ? 'Following' : profile.followsYou ? 'Follow back' : 'Follow'}
              </Button>
            )}
          </div>
        </div>

        {/* Bio */}
        {profile?.bio && (
          <p className="mb-8 max-w-2xl whitespace-pre-line break-words text-body leading-relaxed text-muted-foreground">
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
        ) : listsFailed ? (
          <LoadError
            title={
              profile?.isSelf
                ? 'Couldn’t load your wishlists'
                : `Couldn’t load @${profile?.username}’s wishlists`
            }
            onRetry={() => setAttempt((n) => n + 1)}
          />
        ) : wishlists.length === 0 ? (
          <div className="flex flex-col items-center rounded-3xl border border-dashed border-border-strong py-16 text-center sm:py-20">
            <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Icon name="list" size={28} />
            </span>
            {profile?.isSelf ? (
              <>
                <h3 className="text-lg font-semibold text-foreground sm:text-xl">
                  You haven’t made a wishlist yet
                </h3>
                <div className="mt-6">
                  <Button onClick={() => setShowCreate(true)}>
                    <Icon name="plus" size={18} />
                    New list
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-foreground sm:text-xl">
                  No wishlists to show
                </h3>
                <p className="mx-auto mt-1.5 max-w-sm px-4 text-sm text-muted-foreground">
                  {profile ? `@${profile.username}` : 'This person'} hasn’t shared any wishlists
                  with you yet.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
            {wishlists.map((wishlist) => (
              <WishlistCard key={wishlist._id.toString()} wishlist={wishlist} showOwner />
            ))}
          </div>
        )}
      </main>

      {profile?.isSelf && (
        <CreateWishlistModal isOpen={showCreate} onClose={() => setShowCreate(false)} />
      )}

      {followModal && profile && (
        <FollowListModal
          userId={profile._id}
          initialTab={followModal}
          followerCount={profile.followerCount}
          followingCount={profile.followingCount}
          onClose={closeFollowModal}
        />
      )}
    </div>
  );
}
