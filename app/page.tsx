'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSession, signIn } from 'next-auth/react';
import AuthButton from '@/components/AuthButton';
import AppHeader from '@/components/AppHeader';
import GlobalSearch from '@/components/GlobalSearch';
import CreateWishlistModal from '@/components/CreateWishlistModal';
import ComingUp from '@/components/ComingUp';
import NeedsYou from '@/components/NeedsYou';
import WishlistList, { ArchivedLists } from '@/components/WishlistList';
import Button from '@/components/Button';
import { buttonClassName, CONTROL_ICON_SIZE } from '@/components/buttonStyles';
import Icon, { IconName } from '@/components/Icon';
import StarterCard from '@/components/StarterCard';
import UsernameNudge from '@/components/UsernameNudge';
import LoadError from '@/components/LoadError';
import { Skeleton, WishlistListSkeleton } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import { usePinToTop } from '@/lib/hooks/usePinToTop';
import { sortByUpcomingOccasion } from '@/lib/utils/occasion';
import { pinnedFirst } from '@/lib/utils/pinnedLists';
import { IWishlist } from '@/models/Wishlist';

type Wishlist = IWishlist & {
  ownerUsername?: string | null;
  itemCount?: number;
  // Only on your own lists (`/api/wishlists`): see lib/utils/itemCounts.ts.
  draftCount?: number;
  proposalCount?: number;
  // Only on a list shared with you: the items you've reserved on it.
  reservedByYou?: number;
  isMember?: boolean;
};

/**
 * How many lists a section of Home shows. One with more ends in "See all (n)",
 * to the section's own page (Your wishlists, Shared with you), which shows them
 * all: two rows of cards at the widest grid, a screen of rows on a phone.
 */
const HOME_SECTION_LIMIT = 8;

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
    body: 'Friends quietly reserve gifts — you never see what’s been reserved on your own list.',
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
  // The account whose lists these are. Another account signing in (from another
  // tab) leaves `status` 'authenticated', so the reads key on the user id too:
  // its first read is a first load, and the previous account's lists go, as
  // Needs you's reads (also keyed on the id) start over for it.
  const userId = session?.user?.id ?? null;
  const listsFor = useRef<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // Pin to top on your own lists: per-owner, one at a time (`usePinToTop`).
  const { pinning, toggle: togglePin } = usePinToTop(setOwned);

  useEffect(() => {
    if (status === 'loading') return;
    if (status !== 'authenticated') {
      // Signed out: whoever signs in next starts with a first load of their own.
      listsFor.current = null;
      listsShown.current = false;
      setOwned([]);
      setMember([]);
      setLoadFailed(false);
      setLoading(false);
      return;
    }
    if (listsFor.current !== userId) {
      listsFor.current = userId;
      listsShown.current = false;
      setOwned([]);
      setMember([]);
      setLoadFailed(false);
      setLoading(true);
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
  }, [status, userId, showToast, attempt]);

  const retryLoad = useCallback(() => {
    setLoadFailed(false);
    setLoading(true);
    setAttempt((n) => n + 1);
  }, []);

  const activeOwned = useMemo(() => owned.filter((w) => !w.archived), [owned]);
  // The sections of lists (Your wishlists, Shared with you, Archived) put the
  // ones with an occasion coming up first, nearest first; the rest keep the
  // API's order (newest first). Your pinned list goes above them all.
  const today = useLocalToday();
  const ownedInOrder = useMemo(
    () => pinnedFirst(sortByUpcomingOccasion(activeOwned, today)),
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
  const sharedByOccasion = useMemo(() => sortByUpcomingOccasion(member, today), [member, today]);
  const pins = useMemo(() => ({ pinning, onToggle: togglePin }), [pinning, togglePin]);

  const profileUsername = (session?.user as { username?: string })?.username || null;
  const name = profileUsername || (session?.user?.email || '').split('@')[0] || 'there';

  // ---- Auth still resolving: the dashboard's skeleton ----------------
  if (status === 'loading') {
    return (
      <div className="min-h-screen">
        <AppHeader actions={<AuthButton />} />
        <main aria-hidden="true" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
          <GreetingRowSkeleton />
          <DashboardSkeleton />
        </main>
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
              <Icon name="gift" size={28} />
            </span>
            <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-6xl">
              Everything you wish for, in one place.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl">
              Build beautiful wishlists, share them with the people who matter, and make gift-giving
              effortless.
            </p>
            <div className="mt-9 flex justify-center">
              <Button size="xl" icon="sparkles" onClick={() => signIn()}>
                Get started — it’s free
              </Button>
            </div>
          </div>

          <div className="mb-16 grid grid-cols-1 gap-5 sm:mb-24 md:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-3xl border border-border bg-surface p-7 shadow-md"
              >
                <span className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-500/12 text-accent">
                  <Icon name={f.icon} size={18} />
                </span>
                <h3 className="mb-2 text-lg font-semibold text-foreground">{f.title}</h3>
                <p className="text-body leading-relaxed text-muted-foreground">{f.body}</p>
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
            <p className="mx-auto mt-2 max-w-md text-center text-body text-muted-foreground">
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

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {/* The greeting, with New list: offered while the lists load too, as
            it claims nothing about them. No counts: the sections below say
            what there is, and followers are on the profile. */}
        <header className={GREETING_ROW}>
          <h1 className="min-w-0 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            <span className="text-muted-foreground">{greetingWord()},</span> {name}
          </h1>
          <Button
            size="sm"
            shape="pill"
            icon="plus"
            onClick={() => setShowCreateModal(true)}
            className="sm:mb-1"
          >
            New list
          </Button>
        </header>

        <CreateWishlistModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />

        <div className="space-y-12">
          {/* What's waiting on you: hidden when nothing is. Your proposals to
              review come from your lists, so they wait for them. */}
          <UsernameNudge userId={session.user.id} username={profileUsername} />
          <NeedsYou ownLists={loading || loadFailed ? null : ownedInOrder} />

          {loading ? (
            <DashboardSkeleton />
          ) : loadFailed ? (
            <LoadError title="Couldn’t load your wishlists" onRetry={retryLoad} />
          ) : !hasAny ? (
            <StarterCard username={profileUsername} onCreate={() => setShowCreateModal(true)} />
          ) : (
            <>
              <ComingUp own={activeOwned} shared={member} viewerId={session.user.id} />

              {/* Your wishlists */}
              {activeOwned.length > 0 && (
                <section>
                  {/* All items: every item across your lists (`/items`). On
                      the narrowest phones it goes under the heading rather
                      than break it. */}
                  <div className={SECTION_HEADING_ROW}>
                    <h2 className="whitespace-nowrap text-xl font-semibold tracking-tight text-foreground">
                      Your wishlists
                    </h2>
                    <Link
                      href="/items"
                      className="whitespace-nowrap text-sm font-medium text-accent hover:underline"
                    >
                      All items
                    </Link>
                  </div>
                  <WishlistList
                    wishlists={ownedInOrder.slice(0, HOME_SECTION_LIMIT)}
                    viewerId={session.user.id}
                    pins={pins}
                  />
                  <SeeAll href="/wishlists/mine" count={ownedInOrder.length} />
                </section>
              )}

              {/* Shared with you */}
              {member.length > 0 && (
                <section>
                  <h2 className="mb-5 px-1 text-xl font-semibold tracking-tight text-foreground">
                    Shared with you
                  </h2>
                  {/* The section says you're a member: no badge to repeat it. */}
                  <WishlistList wishlists={sharedByOccasion.slice(0, HOME_SECTION_LIMIT)} shared />
                  <SeeAll href="/wishlists/shared" count={sharedByOccasion.length} />
                </section>
              )}

              {/* Archived, folded away at the end: open when there's nothing above it. */}
              <ArchivedLists
                wishlists={archivedOwned}
                viewerId={session.user.id}
                defaultOpen={activeOwned.length === 0 && member.length === 0}
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/** The greeting and New list: one row, the button at its end, from a phone up. */
const GREETING_ROW = 'mb-8 flex items-end justify-between gap-4 sm:mb-10';

/** A section's heading line, with a link beside it (Your wishlists' All items). */
const SECTION_HEADING_ROW = 'mb-5 flex min-w-0 flex-wrap items-baseline gap-x-3 px-1';

/** The greeting row while the session loads: the heading's line and New list. */
function GreetingRowSkeleton() {
  return (
    <div className={GREETING_ROW}>
      <Skeleton className="h-9 w-72 max-w-full sm:h-10" />
      <Skeleton className="h-9 w-[6.75rem] flex-shrink-0 rounded-full sm:mb-1" />
    </div>
  );
}

/**
 * The dashboard's lists while they're read, box for box as they will land, so
 * nothing moves when they do: a section heading (with All items) over a
 * section of lists (rows on a phone, cards from `sm`). Needs you sits above it
 * already, and Coming up only shows for lists with an occasion close by, so
 * neither has a box here: one that turns out to have nothing would leave a
 * gap, then close it.
 */
function DashboardSkeleton() {
  return (
    <div>
      {/* The section heading's line (text-xl) with All items */}
      <div className="mb-5 flex h-7 items-center gap-3 px-1">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-3.5 w-14" />
      </div>
      <WishlistListSkeleton count={4} />
    </div>
  );
}

/**
 * "See all (n)" under a section of Home that shows only its first
 * `HOME_SECTION_LIMIT` lists, to the page with all `count` of them. Nothing
 * when they all fit.
 */
function SeeAll({ href, count }: { href: string; count: number }) {
  if (count <= HOME_SECTION_LIMIT) return null;
  return (
    <div className="mt-4 flex justify-end">
      <Link
        href={href}
        className={buttonClassName({ variant: 'ghost', size: 'sm', shape: 'pill' })}
      >
        See all ({count})
        <Icon name="arrow-right" size={CONTROL_ICON_SIZE.sm} />
      </Link>
    </div>
  );
}
