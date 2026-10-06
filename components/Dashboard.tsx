'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import AuthButton from '@/components/AuthButton';
import AppHeader from '@/components/AppHeader';
import CreateWishlistModal from '@/components/CreateWishlistModal';
import ComingUp from '@/components/ComingUp';
import NeedsYou from '@/components/NeedsYou';
import WishlistList, { ArchivedLists } from '@/components/WishlistList';
import Button from '@/components/Button';
import { buttonClassName, CONTROL_ICON_SIZE } from '@/components/buttonStyles';
import Icon from '@/components/Icon';
import StarterCard from '@/components/StarterCard';
import UsernameNudge from '@/components/UsernameNudge';
import LoadError from '@/components/LoadError';
import { Skeleton, WishlistListSkeleton } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { useHydrated } from '@/lib/hooks/useHydrated';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import { usePinToTop } from '@/lib/hooks/usePinToTop';
import type { FriendBirthday } from '@/lib/utils/comingUp';
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

function greetingWord(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function Dashboard() {
  const { data: session, status } = useKnownSession();
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

  // Friends' birthdays for Coming up (WIS-343): a read of its own, so it never
  // holds the lists back, and one that fails adds no birthday cards while the
  // lists show as ever. Keyed on the account, like the lists.
  const [birthdays, setBirthdays] = useState<FriendBirthday[]>([]);
  useEffect(() => {
    setBirthdays([]);
    if (status !== 'authenticated' || !userId) return;
    let current = true;
    (async () => {
      try {
        const response = await fetch('/api/users/me/birthdays', { cache: 'no-store' });
        const result = await response.json();
        if (!current) return;
        if (!result.success) throw new Error(result.error || 'Failed to load birthdays');
        setBirthdays(Array.isArray(result.data) ? result.data : []);
      } catch (error) {
        if (current) console.error('Error fetching birthdays:', error);
      }
    })();
    return () => {
      current = false;
    };
  }, [status, userId]);

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

  // The page is server-rendered with the session (app/page.tsx), but the
  // dashboard isn't: the greeting reads the browser's clock, and what's below
  // it the browser's storage and date. So the server's HTML, and the render
  // that hydrates it, show the skeleton, as while the session loads.
  const hydrated = useHydrated();

  // ---- Auth still resolving, or not hydrated yet: the skeleton -------
  // (Signed out, the home page shows the landing instead: `HomeGate`.)
  if (status === 'loading' || !hydrated || !session?.user) {
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
              <ComingUp
                own={activeOwned}
                shared={member}
                birthdays={birthdays}
                viewerId={session.user.id}
              />

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
