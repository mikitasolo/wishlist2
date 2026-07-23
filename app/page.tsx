'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession, signIn } from 'next-auth/react';
import AuthButton from '@/components/AuthButton';
import AppHeader from '@/components/AppHeader';
import UserSearch from '@/components/UserSearch';
import CreateWishlistModal from '@/components/CreateWishlistModal';
import WishlistCard from '@/components/WishlistCard';
import BannerImage from '@/components/BannerImage';
import Select from '@/components/Select';
import FollowListModal, { type FollowTab } from '@/components/FollowListModal';
import Button from '@/components/Button';
import Icon, { IconName } from '@/components/Icon';
import { SkeletonGrid } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { coverGradient } from '@/lib/utils/cover';
import { getVisibility, visibilityMeta } from '@/lib/utils/visibility';
import { IWishlist } from '@/models/Wishlist';

type Wishlist = IWishlist & {
  ownerUsername?: string | null;
  itemCount?: number;
  isMember?: boolean;
};

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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [reservedCount, setReservedCount] = useState(0);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [meId, setMeId] = useState<string | null>(null);
  const [followModal, setFollowModal] = useState<FollowTab | null>(null);
  const [featuredBusy, setFeaturedBusy] = useState(false);

  useEffect(() => {
    async function fetchWishlists() {
      if (status === 'loading') return;
      if (status !== 'authenticated') {
        setLoading(false);
        return;
      }
      try {
        const response = await fetch('/api/wishlists', { cache: 'no-store' });
        const result = await response.json();
        if (result.success) {
          setOwned(result.data?.owned || []);
          setMember(result.data?.member || []);
        } else {
          showToast('Failed to load wishlists', 'error');
        }
      } catch (error) {
        console.error('Error fetching wishlists:', error);
        showToast('Failed to load wishlists', 'error');
      } finally {
        setLoading(false);
      }
    }
    fetchWishlists();
  }, [status, showToast]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/users/me/booked', { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setReservedCount(
            (res.data as { giftedAt: string | null }[]).filter((i) => !i.giftedAt).length
          );
        }
      })
      .catch(() => {});

    fetch('/api/users/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setMeId(res.data._id ?? null);
          setFollowerCount(res.data.followerCount ?? 0);
          setFollowingCount(res.data.followingCount ?? 0);
        }
      })
      .catch(() => {});
  }, [status]);

  const activeOwned = useMemo(() => owned.filter((w) => !w.archived), [owned]);
  const archivedOwned = useMemo(() => owned.filter((w) => w.archived), [owned]);
  const totalItems = useMemo(
    () => activeOwned.reduce((n, w) => n + (w.itemCount ?? 0), 0),
    [activeOwned]
  );
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

          <div className="relative mb-16 overflow-hidden rounded-3xl p-10 text-center text-white shadow-lg sm:p-14">
            <div
              className="absolute inset-0 -z-10"
              style={{ background: 'linear-gradient(135deg, #5e5ce6, #8a5cff 55%, #ff5c8a)' }}
            />
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
              Find people and view their public wishlists.
            </p>
            <div className="mx-auto mt-6 max-w-md">
              <UserSearch />
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ---- Authenticated dashboard ---------------------------------------
  const hasAny = owned.length > 0 || member.length > 0;

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
            <p className="mt-2 text-lg text-muted-foreground">
              {loading
                ? 'Loading your wishlists…'
                : hasAny
                  ? `${owned.length + member.length} ${owned.length + member.length === 1 ? 'list' : 'lists'} · ${totalItems} ${totalItems === 1 ? 'item' : 'items'} in your lists`
                  : 'Let’s create your first wishlist.'}
            </p>
            {profileUsername && (
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                <button
                  type="button"
                  onClick={() => meId && setFollowModal('followers')}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span className="font-semibold text-foreground">{followerCount}</span> followers
                </button>
                <button
                  type="button"
                  onClick={() => meId && setFollowModal('following')}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span className="font-semibold text-foreground">{followingCount}</span> following
                </button>
              </div>
            )}
          </div>
        </header>

        <CreateWishlistModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />

        {loading ? (
          <>
            {/* Bento skeleton */}
            <div className="mb-12 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div className="skeleton col-span-2 min-h-[260px] rounded-3xl lg:row-span-2 lg:min-h-[300px]" />
              <div className="skeleton col-span-2 h-[142px] rounded-3xl" />
              <div className="skeleton h-[142px] rounded-3xl" />
              <div className="skeleton h-[142px] rounded-3xl" />
            </div>
            {/* Section skeleton */}
            <div className="skeleton mb-5 h-6 w-40 rounded-md" />
            <SkeletonGrid count={4} variant="wishlist" />
          </>
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
                    <div
                      className="relative flex aspect-[16/9] flex-col justify-end bg-surface-2 p-6"
                      style={{ background: featured.bannerUrl ? undefined : coverGradient(featured._id.toString()) }}
                    >
                      {featured.bannerUrl && <BannerImage src={featured.bannerUrl} alt="" priority sizes="(max-width: 1024px) 100vw, 640px" />}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" />
                      <span className="relative text-xs font-bold uppercase tracking-widest text-white/85">
                        Featured
                      </span>
                      <h2 className="relative mt-1.5 text-2xl font-semibold text-white sm:text-3xl">
                        {featured.name}
                      </h2>
                    </div>
                    <div className="flex items-center justify-between p-5">
                      <span className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Icon name={visibilityMeta[getVisibility(featured)].icon} size={15} />
                        {visibilityMeta[getVisibility(featured)].label} · {featured.itemCount ?? 0}{' '}
                        items
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
                  {activeOwned.map((w) => (
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
          followerCount={followerCount}
          followingCount={followingCount}
          onClose={() => setFollowModal(null)}
        />
      )}
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  href,
  iconWrapClassName = 'bg-surface-2 text-muted-foreground',
  iconStyle,
}: {
  icon: IconName;
  label: string;
  value: number;
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
      <div className="mt-auto pt-3">
        <div className="flex items-end justify-between gap-2">
          <span className="text-3xl font-semibold tracking-tight text-foreground">{value}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary-600 px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-[0_8px_22px_-10px_rgba(94,92,230,0.9)]">
            View
            <span className="transition-transform group-hover:translate-x-0.5">→</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
