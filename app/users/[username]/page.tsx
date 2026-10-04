'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import Link from 'next/link';
import AuthButton from '@/components/AuthButton';
import AppHeader from '@/components/AppHeader';
import WishlistCard, { type WishlistSummary } from '@/components/WishlistCard';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import ShareButton from '@/components/ShareButton';
import FollowListModal, { type FollowTab } from '@/components/FollowListModal';
import CreateWishlistModal from '@/components/CreateWishlistModal';
import Button from '@/components/Button';
import ConfirmDialog from '@/components/ConfirmDialog';
import GlobalSearch from '@/components/GlobalSearch';
import Badge from '@/components/Badge';
import LoadError from '@/components/LoadError';
import EmptyState from '@/components/EmptyState';
import { buttonClassName, CONTROL_ICON_SIZE } from '@/components/buttonStyles';
import { Skeleton, SkeletonGrid, WISHLIST_GRID_CLASSES } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { pluralNoun } from '@/lib/utils/plural';
import { readResource } from '@/lib/utils/resourceRead';
import { FOLLOWERS_PARAM } from '@/lib/utils/profileLinks';
import { sortByUpcomingOccasion } from '@/lib/utils/occasion';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import { profileCoOwnerLabel, visitorLine } from '@/lib/utils/profileLists';

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
  const { data: session, status } = useKnownSession();
  const params = useParams();
  const { showToast } = useToast();
  const username = typeof params?.username === 'string' ? params.username : null;

  const [profile, setProfile] = useState<Profile | null>(null);
  const [wishlists, setWishlists] = useState<WishlistSummary[]>([]);
  // On your own profile only: how many of your lists a signed-out visitor
  // could open. The API sends it to no one else.
  const [visitorCount, setVisitorCount] = useState<number | null>(null);
  // The nearest occasion first, in the viewer's local date; until that's
  // known, the API's order (newest first), which doesn't depend on it.
  const today = useLocalToday();
  const sortedWishlists = useMemo(
    () => sortByUpcomingOccasion(wishlists, today),
    [wishlists, today]
  );
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
  const [confirmUnfollow, setConfirmUnfollow] = useState(false);
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
        setVisitorCount(null);
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
        setVisitorCount(
          user.isSelf && typeof wishlistsResult.visitorCount === 'number'
            ? wishlistsResult.visitorCount
            : null
        );
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
      // Back to this profile once they're in, like the other signed-out prompts.
      signIn(undefined, { redirectTo: window.location.href });
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

  // Unfollowing a friend (a mutual follow) ends friends-only access both ways,
  // so it asks first; unfollowing anyone else is one tap.
  function onFollowClick() {
    if (profile?.isFollowing && profile.isFriend) setConfirmUnfollow(true);
    else toggleFollow();
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen">
        <AppHeader actions={<AuthButton />} />
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Skeleton className="h-16 w-16 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-9 w-48 sm:h-10" />
                <Skeleton className="h-4 w-40" />
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-3">
              <Skeleton className="h-9 w-24 rounded-full" />
              <Skeleton className="h-9 w-28 rounded-full" />
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
            <EmptyState
              framed={false}
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
            </EmptyState>
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

  // "Visitors see 3 of your 5 lists", on your own profile only.
  const visitorNote = profile?.isSelf ? visitorLine(visitorCount, wishlists.length) : null;

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
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
                  <Badge tone="info" icon="users">
                    Friends
                  </Badge>
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
          <div className="flex flex-shrink-0 items-center gap-3">
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
                onClick={onFollowClick}
                disabled={followBusy}
                className="group"
                aria-label={
                  profile.isFollowing
                    ? `Unfollow @${profile.username}`
                    : `${profile.followsYou ? 'Follow back' : 'Follow'} @${profile.username}`
                }
              >
                {profile.isFollowing ? (
                  // Both words share one cell, so the button keeps its width.
                  <span className="inline-grid">
                    <span className="col-start-1 row-start-1 group-hover:invisible group-focus-visible:invisible">
                      Following
                    </span>
                    <span
                      aria-hidden
                      className="invisible col-start-1 row-start-1 group-hover:visible group-focus-visible:visible"
                    >
                      Unfollow
                    </span>
                  </span>
                ) : profile.followsYou ? (
                  'Follow back'
                ) : (
                  'Follow'
                )}
              </Button>
            )}
            <ShareButton
              url={profile ? `/users/${encodeURIComponent(profile.username)}` : undefined}
              title={profile ? `@${profile.username}` : undefined}
            />
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
          <EmptyState
            tone="muted"
            icon="lock"
            title="Wishlists are friends only"
            body={
              profile?.isFollowing
                ? `Only @${profile.username}’s friends can see their wishlists. You’ll see them once they follow you back.`
                : `Only @${profile?.username}’s friends can see their wishlists. Follow each other to become friends.`
            }
          />
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
          <EmptyState
            tone="muted"
            icon="list"
            {...(profile?.isSelf
              ? {
                  title: 'You haven’t made a wishlist yet',
                  actions: (
                    <Button icon="plus" onClick={() => setShowCreate(true)}>
                      New list
                    </Button>
                  ),
                }
              : {
                  title: 'No wishlists to show',
                  body: `${profile ? `@${profile.username}` : 'This person'} hasn’t shared any wishlists with you yet.`,
                })}
          />
        ) : (
          <>
            {visitorNote ? (
              <p className="mb-4 text-sm text-muted-foreground">{visitorNote}</p>
            ) : null}
            <div className={WISHLIST_GRID_CLASSES}>
              {sortedWishlists.map((wishlist) => (
                <WishlistCard
                  key={wishlist._id.toString()}
                  wishlist={wishlist}
                  ownerNote={profile ? profileCoOwnerLabel(wishlist, profile._id) : null}
                />
              ))}
            </div>
          </>
        )}
      </main>

      {profile?.isSelf && (
        <CreateWishlistModal isOpen={showCreate} onClose={() => setShowCreate(false)} />
      )}
      <ConfirmDialog
        isOpen={confirmUnfollow}
        title={`Unfollow @${profile?.username}?`}
        message="You’ll stop being friends, so lists either of you share with friends only won’t be shared between you."
        confirmText="Unfollow"
        icon="user-minus"
        onCancel={() => setConfirmUnfollow(false)}
        onConfirm={() => {
          setConfirmUnfollow(false);
          return toggleFollow();
        }}
      />

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
