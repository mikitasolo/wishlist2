'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession, signIn } from 'next-auth/react';
import AuthButton from '@/components/AuthButton';
import AppHeader from '@/components/AppHeader';
import GlobalSearch from '@/components/GlobalSearch';
import CreateWishlistModal from '@/components/CreateWishlistModal';
import CurrencyPrompt from '@/components/CurrencyPrompt';
import WishlistCard from '@/components/WishlistCard';
import Cover from '@/components/Cover';
import OccasionLabel, { OCCASION_ON_COVER } from '@/components/OccasionLabel';
import Select from '@/components/Select';
import FollowListModal, { type FollowTab } from '@/components/FollowListModal';
import Button from '@/components/Button';
import Icon, { IconName } from '@/components/Icon';
import LoadError from '@/components/LoadError';
import { SkeletonGrid } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import { sortByUpcomingOccasion } from '@/lib/utils/occasion';
import { plural, pluralNoun } from '@/lib/utils/plural';
import { getVisibility, visibilityMeta } from '@/lib/utils/visibility';
import { formatItemCount, formatOwnerExtras, sumItemCounts } from '@/lib/utils/itemCounts';
import { IWishlist } from '@/models/Wishlist';

type Wishlist = IWishlist & {
  ownerUsername?: string | null;
  itemCount?: number;
  // Only on your own lists (`/api/wishlists`): see lib/utils/itemCounts.ts.
  draftCount?: number;
  proposalCount?: number;
  isMember?: boolean;
};

/** A count on the dashboard: read, still being read, or couldn't be read. */
type Count = number | 'loading' | 'failed';

const features: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'list',
    title: 'Create wishlists',
    body: 'Organize your wishes into lists for any occasion — birthdays, holidays, the new place.',
  },
  {
    icon: 'users',
    title: 'Share & collaborate',
    body: 'Invite people to view your lists and let them propose items you might love.',
  },
  {
    icon: 'sparkles',
    title: 'Keep it a surprise',
    body: 'Friends quietly reserve gifts — you never see what’s been claimed on your own list.',
  },
];

function greetingWord(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Home() {
  const { data: session, status } = useSession();
  const { showToast } = useToast();
  const [owned, setOwned] = useState<Wishlist[]>([]);
  const [member, setMember] = useState<Wishlist[]>([]);
  const [loading, setLoading] = useState(true);
  // The lists couldn't be read the first time: said in place, with Try again
  // (`attempt`), never as "No wishlists yet". Once they've been shown
  // (`listsShown`), a read that fails (the session refreshed) keeps them.
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const listsShown = useRef(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [reservedCount, setReservedCount] = useState<Count>('loading');
  const [followerCount, setFollowerCount] = useState<Count>('loading');
  const [followingCount, setFollowingCount] = useState<Count>('loading');
  const [meId, setMeId] = useState<string | null>(null);
  const [followModal, setFollowModal] = useState<FollowTab | null>(null);
  const [featuredBusy, setFeaturedBusy] = useState(false);

  useEffect(() => {
    if (status === 'loading') return;
    if (status !== 'authenticated') {
      // Signed out: whoever signs in next starts with a first load of their own.
      listsShown.current = false;
      setOwned([]);
      setMember([]);
      setLoadFailed(false);
      setLoading(false);
      return;
    }
    // A read outdated by another (the session changed, Try again) is dropped.
    let current = true;
    async function fetchWishlists() {
      try {
        const response = await fetch('/api/wishlists', { cache: 'no-store' });
        const result = await response.json();
        if (!current) return;
        if (!result.success) throw new Error(result.error || 'Failed to load wishlists');
        setOwned(result.data?.owned || []);
        setMember(result.data?.member || []);
        listsShown.current = true;
      } catch (error) {
        if (!current) return;
        console.error('Error fetching wishlists:', error);
        if (listsShown.current) showToast('Failed to load wishlists', 'error');
        else setLoadFailed(true);
      } finally {
        if (current) setLoading(false);
      }
    }
    fetchWishlists();
    return () => {
      current = false;
    };
  }, [status, showToast, attempt]);

  const retryLoad = useCallback(() => {
    setLoadFailed(false);
    setLoading(true);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      // Whoever signs in next has counts of their own to read.
      setReservedCount('loading');
      setFollowerCount('loading');
      setFollowingCount('loading');
      setMeId(null);
    }
    if (status !== 'authenticated') return;
    // An answer outdated by a newer read (Try again) is dropped.
    let current = true;
    // A count that can't be read shows a dash, never a 0 that isn't true. One
    // already shown stays when a later read fails. The lists' Try again
    // (`attempt`) reads the counts again too: whatever failed them likely
    // failed both.
    const unread = (count: Count): Count => (count === 'loading' ? 'failed' : count);
    // Just the count: the full list (`/api/users/me/reservations`) is the
    // Booked page's, and costs far more to build.
    fetch('/api/users/me/reservations/count', { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (!current) return;
        if (!res.success || typeof res.data?.count !== 'number') throw new Error();
        setReservedCount(res.data.count);
      })
      .catch(() => {
        if (current) setReservedCount(unread);
      });

    fetch('/api/users/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (!current) return;
        if (!res.success) throw new Error();
        setMeId(res.data._id ?? null);
        setFollowerCount(res.data.followerCount ?? 0);
        setFollowingCount(res.data.followingCount ?? 0);
      })
      .catch(() => {
        if (!current) return;
        setFollowerCount(unread);
        setFollowingCount(unread);
      });
    return () => {
      current = false;
    };
  }, [status, attempt]);

  const activeOwned = useMemo(() => owned.filter((w) => !w.archived), [owned]);
  // The grids of your own lists (Your wishlists, Archived) put the ones with an
  // occasion coming up first, nearest first; the rest keep the API's order
  // (newest first). The Featured pick and its menu, and the shared lists, keep
  // theirs.
  const today = useLocalToday();
  const ownedByOccasion = useMemo(
    () => sortByUpcomingOccasion(activeOwned, today),
    [activeOwned, today]
  );
  const archivedOwned = useMemo(
    () =>
      sortByUpcomingOccasion(
        owned.filter((w) => w.archived),
        today
      ),
    [owned, today]
  );
  // Your active lists' items, counted as every screen counts them: "N items"
  // is their published items, with the drafts and proposals to review beside
  // it. The greeting and the tiles both read these, so they can't disagree.
  const ownCounts = useMemo(
    () =>
      sumItemCounts(
        activeOwned.map((w) => ({
          items: w.itemCount,
          drafts: w.draftCount,
          proposals: w.proposalCount,
        }))
      ),
    [activeOwned]
  );
  const totalItems = ownCounts.items;
  // Featured = the owner-pinned list, else the one with the most items,
  // falling back to a shared list when you own none.
  const featured = useMemo(() => {
    const pinned = activeOwned.find((w) => w.featured);
    if (pinned) return pinned;
    const byItems = [...activeOwned].sort((a, b) => (b.itemCount ?? 0) - (a.itemCount ?? 0))[0];
    return byItems ?? member[0];
  }, [activeOwned, member]);
  // Currently pinned list id ('' ⇒ automatic / most items)
  const pinnedId = useMemo(
    () => activeOwned.find((w) => w.featured)?._id?.toString() ?? '',
    [activeOwned]
  );

  const changeFeatured = useCallback(
    async (value: string) => {
      setFeaturedBusy(true);
      try {
        // '' ⇒ reset to automatic: unpin whichever list is currently featured
        const targetId = value || pinnedId;
        if (!targetId) return;
        const res = await fetch(`/api/wishlists/${targetId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ featured: value !== '' }),
        });
        const result = await res.json();
        if (result.success) {
          setOwned((prev) =>
            prev.map((w) => ({ ...w, featured: value !== '' && w._id.toString() === value }))
          );
        } else {
          showToast(result.error || 'Failed to update featured wishlist', 'error');
        }
      } catch {
        showToast('Failed to update featured wishlist', 'error');
      } finally {
        setFeaturedBusy(false);
      }
    },
    [pinnedId, showToast]
  );

  const profileUsername = (session?.user as { username?: string })?.username || null;
  const name = profileUsername || (session?.user?.email || '').split('@')[0] || 'there';

  // ---- Auth still resolving: neutral loader --------------------------
  if (status === 'loading') {
    return (
      <div className="min-h-screen">
        <AppHeader actions={<AuthButton />} />
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="spinner h-8 w-8 text-primary-600" />
        </div>
      </div>
    );
  }

  // ---- Unauthenticated landing ---------------------------------------
  if (!session?.user) {
    return (
      <div className="min-h-screen">
        <AppHeader actions={<AuthButton />} />
        <main className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
          <div className="mb-16 text-center sm:mb-24">
            <span className="mb-7 inline-flex h-16 w-16 items-center justify-center rounded-[20px] bg-gradient-to-br from-primary-500 via-primary-600 to-primary-700 text-white shadow-[0_12px_30px_-8px_rgba(94,92,230,0.7)]">
              <Icon name="gift" size={34} />
            </span>
            <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-6xl">
              Everything you wish for, in one place.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">
              Build beautiful wishlists, share them with the people who matter, and make gift-giving
              effortless.
            </p>
            <div className="mt-9 flex justify-center">
              <Button size="lg" onClick={() => signIn()}>
                <Icon name="sparkles" size={18} />
                Get started — it’s free
              </Button>
            </div>
          </div>

          <div className="mb-16 grid grid-cols-1 gap-5 sm:mb-24 md:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-3xl border border-border bg-surface p-7 shadow-md transition-all hover:shadow-lg"
              >
                <span className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-500/12 text-accent dark:text-primary-300">
                  <Icon name={f.icon} size={24} />
                </span>
                <h3 className="mb-2 text-lg font-semibold text-foreground">{f.title}</h3>
                <p className="text-[15px] leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>

          <div
            className="mb-16 overflow-hidden rounded-3xl p-10 text-center text-white shadow-lg sm:p-14"
            style={{ background: 'linear-gradient(135deg, #5e5ce6, #8a5cff 55%, #ff5c8a)' }}
          >
            <h3 className="text-2xl font-semibold sm:text-3xl">No passwords. Just a magic link.</h3>
            <p className="mx-auto mt-3 max-w-xl text-white/85">
              Enter your email and we’ll send you a secure sign-in link. Your account is created
              automatically.
            </p>
            <button
              onClick={() => signIn()}
              className="mt-7 inline-flex h-12 items-center rounded-full bg-white px-7 font-semibold text-primary-700 shadow-md transition-transform hover:-translate-y-px"
            >
              Sign in / Sign up
            </button>
          </div>

          <div className="rounded-3xl border border-border bg-surface p-7 shadow-md sm:p-10">
            <h3 className="text-center text-xl font-semibold text-foreground">
              Find someone’s wishlist
            </h3>
            <p className="mx-auto mt-2 max-w-md text-center text-[15px] text-muted-foreground">
              Search for people and their public wishlists.
            </p>
            <div className="mx-auto mt-6 max-w-md">
              <GlobalSearch variant="inline" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ---- Authenticated dashboard ---------------------------------------
  const hasAny = owned.length > 0 || member.length > 0;
  // The same numbers as the tiles below: your active lists and their items.
  // With none (only shared or archived lists) there's nothing to count.
  const summary = loading
    ? 'Loading your wishlists…'
    : activeOwned.length > 0
      ? `${plural(activeOwned.length, 'list')} · ${formatItemCount(totalItems)} in your lists`
      : owned.length > 0
        ? 'Let’s create a new wishlist.'
        : 'Let’s create your first wishlist.';

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {/* Greeting hero */}
        <header className="mb-8 flex flex-col gap-5 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              <span className="text-muted-foreground">{greetingWord()},</span> {name}
            </h1>
            {/* Nothing to say about lists that couldn't be read: the panel below says why. */}
            {!loadFailed && <p className="mt-2 text-lg text-muted-foreground">{summary}</p>}
            {profileUsername && (
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                <button
                  type="button"
                  onClick={() => meId && setFollowModal('followers')}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <CountValue
                    count={followerCount}
                    className="font-semibold text-foreground"
                    placeholderClassName="h-3.5 w-4 rounded align-[-0.125em]"
                  />{' '}
                  {countNoun(followerCount, 'follower')}
                </button>
                <button
                  type="button"
                  onClick={() => meId && setFollowModal('following')}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <CountValue
                    count={followingCount}
                    className="font-semibold text-foreground"
                    placeholderClassName="h-3.5 w-4 rounded align-[-0.125em]"
                  />{' '}
                  {countNoun(followingCount, 'following')}
                </button>
              </div>
            )}
          </div>
        </header>

        <CurrencyPrompt />

        <CreateWishlistModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />

        {loading ? (
          <>
            {/* Bento skeleton: featured card (col-span-2, row-span-2) + 4 stat tiles,
                the first row a line taller for the Items tile's drafts line */}
            <div className="mb-12 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div className="skeleton col-span-2 min-h-[260px] rounded-3xl lg:row-span-2 lg:min-h-[300px]" />
              <div className="skeleton h-[181px] rounded-3xl" />
              <div className="skeleton h-[181px] rounded-3xl" />
              <div className="skeleton h-[160px] rounded-3xl" />
              <div className="skeleton h-[160px] rounded-3xl" />
            </div>
            {/* Section skeleton */}
            <div className="skeleton mb-5 h-6 w-40 rounded-md" />
            <SkeletonGrid count={4} variant="wishlist" />
          </>
        ) : loadFailed ? (
          <LoadError title="Couldn’t load your wishlists" onRetry={retryLoad} />
        ) : !hasAny ? (
          <div className="flex flex-col items-center rounded-3xl border border-dashed border-border-strong bg-surface/50 py-20 text-center">
            <span className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-3xl bg-primary-500/12 text-accent dark:text-primary-300">
              <Icon name="gift" size={30} />
            </span>
            <h3 className="text-xl font-semibold text-foreground">No wishlists yet</h3>
            <p className="mx-auto mt-2 max-w-sm px-4 text-[15px] text-muted-foreground">
              Create your first wishlist to start collecting the things you love and share it with
              friends and family.
            </p>
            <div className="mt-7">
              <Button onClick={() => setShowCreateModal(true)}>
                <Icon name="plus" size={18} />
                Create wishlist
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Bento overview */}
            <section aria-label="Overview" className="mb-12">
              {activeOwned.length > 0 && (
                <div className="mb-4 flex items-center justify-end gap-2">
                  <span className="text-[13px] font-medium text-muted-foreground">Featured</span>
                  <Select
                    value={pinnedId}
                    onChange={changeFeatured}
                    disabled={featuredBusy}
                    ariaLabel="Featured wishlist"
                    menuAlign="right"
                    triggerClassName="max-w-[15rem]"
                    options={[
                      { value: '', label: 'Automatic (most items)' },
                      ...activeOwned.map((w) => ({ value: w._id.toString(), label: w.name })),
                    ]}
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {featured && (
                  <Link
                    href={`/wishlists/${featured.slug ?? featured._id}`}
                    className="group col-span-2 flex flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-md transition-all hover:shadow-lg lg:row-span-2"
                  >
                    <Cover
                      src={featured.bannerUrl}
                      seed={featured._id.toString()}
                      priority
                      sizes="(max-width: 1024px) 100vw, 640px"
                      className="relative flex aspect-[16/9] flex-col justify-end bg-surface-2 p-6"
                    >
                      <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" />
                      {featured.occasion ? (
                        <OccasionLabel
                          occasion={featured.occasion}
                          className={`absolute left-6 top-6 ${OCCASION_ON_COVER}`}
                        />
                      ) : null}
                      <span className="relative text-xs font-bold uppercase tracking-widest text-white/85">
                        Featured
                      </span>
                      <h2 className="relative mt-1.5 text-2xl font-semibold text-white sm:text-3xl">
                        {featured.name}
                      </h2>
                    </Cover>
                    <div className="flex items-center justify-between p-5">
                      <span className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Icon name={visibilityMeta[getVisibility(featured)].icon} size={15} />
                        {visibilityMeta[getVisibility(featured)].label} ·{' '}
                        {formatItemCount(featured.itemCount ?? 0)}
                      </span>
                      <span className="inline-flex h-9 items-center rounded-full bg-primary-600 px-4 text-[13px] font-semibold text-white transition-transform group-hover:-translate-y-px">
                        Open
                      </span>
                    </div>
                  </Link>
                )}

                <StatTile
                  icon="list"
                  label="Your wishlists"
                  value={activeOwned.length}
                  href="/wishlists/mine"
                />
                <StatTile
                  icon="package"
                  label="Items in your lists"
                  value={totalItems}
                  detail={formatOwnerExtras(ownCounts)}
                  href="/items"
                  iconWrapClassName="bg-primary-500/12 text-accent dark:text-primary-300"
                />
                <StatTile
                  icon="users"
                  label="Shared with you"
                  value={member.length}
                  href="/wishlists/shared"
                />
                <StatTile
                  icon="check-circle"
                  label="Reserved by you"
                  value={reservedCount}
                  href="/booked"
                  iconWrapClassName=""
                  iconStyle={{
                    background: 'color-mix(in srgb, var(--accent2) 15%, transparent)',
                    color: 'var(--accent2)',
                  }}
                />
              </div>
            </section>

            {/* Your wishlists */}
            {activeOwned.length > 0 && (
              <section className="mb-12">
                <h2 className="mb-5 px-1 text-xl font-semibold tracking-tight text-foreground">
                  Your wishlists
                </h2>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {ownedByOccasion.map((w) => (
                    <WishlistCard key={w._id.toString()} wishlist={w} />
                  ))}
                </div>
              </section>
            )}

            {/* Shared with you */}
            {member.length > 0 && (
              <section className="mb-12">
                <h2 className="mb-5 px-1 text-xl font-semibold tracking-tight text-foreground">
                  Shared with you
                </h2>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {member.map((w) => (
                    <WishlistCard key={w._id.toString()} wishlist={w} showOwner />
                  ))}
                </div>
              </section>
            )}

            {/* Archived */}
            {archivedOwned.length > 0 && (
              <section className="mb-4">
                <h2 className="mb-5 flex items-center gap-2 px-1 text-xl font-semibold tracking-tight text-muted-foreground">
                  <Icon name="package" size={18} />
                  Archived
                </h2>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {archivedOwned.map((w) => (
                    <WishlistCard key={w._id.toString()} wishlist={w} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {followModal && meId && (
        <FollowListModal
          userId={meId}
          initialTab={followModal}
          followerCount={typeof followerCount === 'number' ? followerCount : 0}
          followingCount={typeof followingCount === 'number' ? followingCount : 0}
          onClose={() => setFollowModal(null)}
        />
      )}
    </div>
  );
}

/** The noun beside a count, plural until the count is known to be 1. */
function countNoun(count: Count, one: string): string {
  return pluralNoun(typeof count === 'number' ? count : 2, one);
}

/**
 * A count, or what stands in for it until it's known: a placeholder while it's
 * read, and a dash if it couldn't be. Never a 0 that may not be true.
 */
function CountValue({
  count,
  className,
  placeholderClassName,
}: {
  count: Count;
  className: string;
  /** The placeholder's size, about the count's own. */
  placeholderClassName: string;
}) {
  if (typeof count === 'number') return <span className={className}>{count}</span>;
  if (count === 'loading') {
    return (
      <span className={`skeleton inline-block ${placeholderClassName}`}>
        <span className="sr-only">Loading</span>
      </span>
    );
  }
  return (
    <span className={className}>
      <span aria-hidden="true">–</span>
      <span className="sr-only">Couldn’t load</span>
    </span>
  );
}

function StatTile({
  icon,
  label,
  value,
  detail,
  href,
  iconWrapClassName = 'bg-surface-2 text-muted-foreground',
  iconStyle,
}: {
  icon: IconName;
  label: string;
  value: Count;
  /**
   * A muted line under the label, e.g. the drafts and proposals beside an item
   * count. A tile given one keeps its line when it's null, so the tile is the
   * same height either way (and the loading skeleton's).
   */
  detail?: string | null;
  href: string;
  iconWrapClassName?: string;
  iconStyle?: React.CSSProperties;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-3xl border border-border bg-surface p-5 shadow-md transition-all hover:shadow-lg"
    >
      <span
        className={`mb-3.5 inline-flex h-9 w-9 items-center justify-center rounded-xl ${iconWrapClassName}`}
        style={iconStyle}
      >
        <Icon name={icon} size={19} />
      </span>
      <span className="text-[13px] font-semibold text-muted-foreground">{label}</span>
      {detail !== undefined && (
        <span className="mt-0.5 text-[13px] text-muted-foreground">{detail ?? '\u00a0'}</span>
      )}
      <div className="mt-auto pt-3">
        <div className="flex items-end justify-between gap-2">
          <CountValue
            count={value}
            className="text-3xl font-semibold tracking-tight text-foreground"
            placeholderClassName="h-8 w-10 rounded-lg"
          />
          <span className="inline-flex items-center gap-1 rounded-full bg-primary-600 px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-[0_8px_22px_-10px_rgba(94,92,230,0.9)]">
            View
            <span className="transition-transform group-hover:translate-x-0.5">→</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
