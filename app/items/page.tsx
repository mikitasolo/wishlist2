'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import EmptyState from '@/components/EmptyState';
import FilterChips from '@/components/FilterChips';
import Icon from '@/components/Icon';
import ItemCardView from '@/components/ItemCardView';
import LoadError from '@/components/LoadError';
import Select from '@/components/Select';
import MultiSelectDropdown from '@/components/MultiSelectDropdown';
import SearchField from '@/components/SearchField';
import { ITEM_GRID_CLASSES, ListControlsSkeleton, SkeletonGrid } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { signInPath } from '@/lib/utils/callbackUrl';
import { formatPrice } from '@/lib/utils/currency';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';
import { itemDeepLink } from '@/lib/utils/itemDeepLink';
import {
  forgetSavedListFilter,
  forgetSavedStatusFilters,
  isSortType,
  SORT_OPTIONS,
  SORT_SHORT_LABELS,
  type SortType,
} from '@/lib/utils/itemFilters';
import { formatOwnerItemSummary, tallyItems } from '@/lib/utils/itemCounts';
import { statusMeta } from '@/lib/utils/itemStatus';
import {
  countListChips,
  isDimmedInAll,
  LIST_CHIP_LABELS,
  LIST_CHIP_PARAM,
  listChipFor,
  listChips,
  orderListItems,
  type ChipItem,
  type ListChip,
} from '@/lib/utils/listChips';

interface MyItem {
  _id: string;
  name: string;
  imageUrl: string | null;
  price: { value: number; currency: string } | null;
  priceInUsdCents: number | null;
  link: string | null;
  mostWanted: boolean;
  status: 'draft' | 'available' | 'completed' | 'proposed';
  wishlistId: string;
  wishlistSlug: string | null;
  wishlistName: string;
  wishlistArchived: boolean;
  createdAt: string; // ISO date string
}

// localStorage keys — kept separate from the per-wishlist page's keys. The
// status chip and list filter aren't saved: each starts on All every visit
// (the chip lives in the URL's ?show= for back and refresh), so a chip picked
// once, or the lists you had when you last picked, don't narrow the page for
// good (a list created since would be missing).
const LS_SORT = 'items-sort';

// This page shows the items on lists you own, so it's the owner's view of a
// list: the owner's chips, and booked already folded into available.
const OWNER_CHIPS = listChips('owner');

export default function MyItemsPage() {
  const { status } = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const locale = useViewerLocale();
  const [items, setItems] = useState<MyItem[]>([]);
  const [loading, setLoading] = useState(true);
  // The first read failed: said in place, with Try again, never as "No items
  // yet". Only until a read succeeds: a later one that fails (Include
  // archived) keeps the items shown and says so in a toast.
  const [loadFailed, setLoadFailed] = useState(false);
  const loadedOnce = useRef(false);
  const [wishlistFilters, setWishlistFilters] = useState<string[]>([]);
  const [chip, setChip] = useState<ListChip>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sort, setSort] = useState<SortType>('date-desc');
  // Archived lists are left out unless asked for, so the counts here match the
  // dashboard's. Not saved: every visit starts without them. `includeArchived`
  // is what the items shown were read with; `archivedWanted` is the box's new
  // state while the read for it is on its way (null otherwise).
  const [includeArchived, setIncludeArchived] = useState(false);
  const [archivedWanted, setArchivedWanted] = useState<boolean | null>(null);
  const [archivedItems, setArchivedItems] = useState(0);
  const latestRead = useRef(0);
  // The lists the last read had items from (null before the first one).
  const loadedListIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(signInPath('/items'));
  }, [status, router]);

  // The chip is read from the URL's ?show= once (so back and refresh keep it),
  // and written back by replaceState when picked. Never saved.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get(LIST_CHIP_PARAM);
    setChip(listChipFor(fromUrl, 'owner'));
  }, []);

  const chooseChip = useCallback((next: ListChip) => {
    setChip(next);
    const url = new URL(window.location.href);
    if (next === 'all') url.searchParams.delete(LIST_CHIP_PARAM);
    else url.searchParams.set(LIST_CHIP_PARAM, next);
    if (url.href !== window.location.href) window.history.replaceState(null, '', url);
  }, []);

  const loadItems = useCallback(
    async (withArchived: boolean) => {
      // Only the latest read lands: one a later toggle has replaced is dropped.
      const read = ++latestRead.current;
      const isLatest = () => read === latestRead.current;
      try {
        const res = await fetch(
          `/api/users/me/items${withArchived ? '?includeArchived=true' : ''}`,
          { cache: 'no-store' }
        );
        const body = await res.json();
        if (!isLatest()) return;
        if (!body.success) throw new Error('Failed to load items');
        setItems(body.data as MyItem[]);
        setArchivedItems(typeof body.archivedItems === 'number' ? body.archivedItems : 0);
        setIncludeArchived(withArchived);
        setLoadFailed(false);
        loadedOnce.current = true;
      } catch {
        if (!isLatest()) return;
        if (loadedOnce.current) showToast('Failed to load items', 'error');
        else setLoadFailed(true);
      } finally {
        // A failed read leaves the box as the items shown were read.
        if (isLatest()) {
          setLoading(false);
          setArchivedWanted(null);
        }
      }
    },
    [showToast]
  );

  useEffect(() => {
    if (status === 'authenticated') void loadItems(false);
  }, [status, loadItems]);

  const changeIncludeArchived = (next: boolean) => {
    setArchivedWanted(next);
    void loadItems(next);
  };

  const retryLoad = () => {
    setLoadFailed(false);
    setLoading(true);
    void loadItems(false);
  };

  // The filters wait for the first read that succeeds, so a failed one can't
  // be taken for "no lists" when they're restored.
  const ready = !loading && !loadFailed;

  // Restore the persisted sort once loaded (independent of items), and delete
  // a status filter an earlier version saved, so it can't come back.
  useEffect(() => {
    if (!ready) return;
    forgetSavedStatusFilters(localStorage);
    forgetSavedListFilter(localStorage);
    const storedSort = localStorage.getItem(LS_SORT);
    if (isSortType(storedSort)) setSort(storedSort);
  }, [ready]);

  // Start the list filter on all lists once items are known. Ids of deleted
  // (or archived) lists are dropped. After that, each read Include archived makes selects the lists it
  // adds and drops the ones it takes away, back to all lists if that leaves none.
  useEffect(() => {
    if (!ready) return;
    const ids = new Set(items.map((i) => i.wishlistId));
    const previous = loadedListIds.current;
    loadedListIds.current = ids;
    if (previous) {
      setWishlistFilters((selected) => {
        const next = [
          ...selected.filter((id) => ids.has(id)),
          ...Array.from(ids).filter((id) => !previous.has(id) && !selected.includes(id)),
        ];
        return next.length > 0 ? next : Array.from(ids);
      });
      return;
    }
    setWishlistFilters(Array.from(ids));
  }, [ready, items]);

  // Distinct lists the user owns (from the loaded items — no extra fetch).
  const wishlistOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const it of items) {
      if (!seen.has(it.wishlistId)) {
        seen.set(
          it.wishlistId,
          it.wishlistArchived ? `${it.wishlistName} (archived)` : it.wishlistName
        );
      }
    }
    return Array.from(seen, ([value, label]) => ({ value, label }));
  }, [items]);

  // An empty selection means all lists, never an empty grid.
  const changeWishlistFilters = (next: string[]) =>
    setWishlistFilters(next.length > 0 ? next : wishlistOptions.map((o) => o.value));

  // "57 items · 3 drafts · 2 to review", counted as the dashboard counts them.
  const summary = useMemo(() => formatOwnerItemSummary(tallyItems(items)), [items]);

  // The items on the lists picked in the Lists filter: what the chips count.
  const scopedItems = useMemo(
    () => items.filter((i) => wishlistFilters.includes(i.wishlistId)),
    [items, wishlistFilters]
  );

  // The owner's chips and counts, as on a list's page (never a reservation).
  const chips = useMemo(() => {
    const counts = countListChips(scopedItems as unknown as ChipItem[], 'owner', null);
    return OWNER_CHIPS.map((value) => ({
      value,
      label: LIST_CHIP_LABELS[value],
      count: counts[value],
    }));
  }, [scopedItems]);

  const visibleItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matching = q ? scopedItems.filter((i) => i.name.toLowerCase().includes(q)) : scopedItems;
    // The list page's ordering: under All the actionable items come first.
    return orderListItems(matching, chip, 'owner', null, sort);
  }, [scopedItems, searchQuery, chip, sort]);

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Items in your lists
        </h1>
        <p className="mt-1 text-muted-foreground">
          {loading || items.length === 0
            ? 'Everything across the wishlists you own.'
            : `Across the wishlists you own${includeArchived ? ', archived ones too' : ''}: ${summary}`}
        </p>

        {loading ? (
          <div className="mt-8">
            <ListControlsSkeleton chips={OWNER_CHIPS.length} />
            <SkeletonGrid count={8} variant="item" />
          </div>
        ) : loadFailed ? (
          <div className="mt-8">
            <LoadError title="Couldn’t load your items" onRetry={retryLoad} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            className="mt-8"
            icon="package"
            title="No items yet"
            body="Items you add to your wishlists will appear here."
            actions={
              // Archived lists are left out by default, and the List filter
              // that brings them back isn't shown without items.
              !includeArchived && archivedItems > 0 ? (
                <button
                  type="button"
                  onClick={() => changeIncludeArchived(true)}
                  disabled={archivedWanted !== null}
                  className="text-sm font-semibold text-accent hover:underline disabled:opacity-60"
                >
                  Include archived lists
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* The owner's status chips, as on a list's page: one row, one choice */}
            <FilterChips
              chips={chips}
              value={chip}
              onChange={chooseChip}
              ariaLabel="Show items"
              className="mt-8 mb-4"
            />

            {/* Toolbar, as on a list's page: search and Sort, one row from sm
                up and on a phone the search on a row of its own. The Lists
                filter sits beside them. */}
            <div className="mb-6 flex flex-wrap items-center gap-2 sm:mb-8 sm:flex-nowrap sm:gap-3">
              <SearchField
                size="sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onClear={() => setSearchQuery('')}
                placeholder="Search items…"
                aria-label="Search items by name"
                className="w-full sm:w-auto sm:min-w-0 sm:flex-1"
              />
              <MultiSelectDropdown
                className="min-w-0 flex-1 sm:w-48 sm:flex-none"
                options={wishlistOptions}
                selected={wishlistFilters}
                onChange={changeWishlistFilters}
                allLabel="All lists"
                extraToggle={{
                  label: 'Include archived',
                  checked: archivedWanted ?? includeArchived,
                  onChange: changeIncludeArchived,
                }}
              />
              <Select
                ariaLabel="Sort items by"
                value={sort}
                onChange={(v) => {
                  // Saved only when picked, so the default can still change.
                  setSort(v as SortType);
                  localStorage.setItem(LS_SORT, v);
                }}
                options={SORT_OPTIONS}
                valueLabel={SORT_SHORT_LABELS[sort]}
                menuAlign="right"
                triggerClassName="min-w-0 flex-1 sm:flex-none sm:flex-shrink-0"
              />
            </div>

            {visibleItems.length === 0 ? (
              <EmptyState
                tone="muted"
                icon="package"
                title="No items found"
                body="No items match these filters."
              />
            ) : (
              <div className={ITEM_GRID_CLASSES}>
                {visibleItems.map((it) => {
                  // The owner's view: the API has already folded booked into available.
                  const status = statusMeta(it.status, 'owner');
                  const listPath = it.wishlistSlug ?? it.wishlistId;
                  const href = itemDeepLink(listPath, it._id);
                  return (
                    <ItemCardView
                      key={it._id}
                      item={it}
                      status={status}
                      dimmed={
                        chip === 'all' && isDimmedInAll(it as unknown as ChipItem, 'owner', null)
                      }
                      priceText={it.price ? formatPrice(it.price, locale) : null}
                      titleCoversCard
                      // Opens the item on its list; actions stay there.
                      title={
                        <Link
                          href={href}
                          title={it.name}
                          className="block w-full rounded-md text-left after:absolute after:inset-0 after:content-['']"
                        >
                          <span className="line-clamp-2">{it.name}</span>
                        </Link>
                      }
                      actions={
                        <div className="mt-auto flex min-h-10 items-center">
                          <Link
                            href={`/wishlists/${encodeURIComponent(listPath)}`}
                            className="relative inline-flex min-w-0 items-center gap-1.5 text-sm font-medium text-accent hover:underline"
                          >
                            <Icon name="gift" size={16} className="flex-shrink-0" />
                            <span className="truncate">
                              {it.wishlistArchived
                                ? `${it.wishlistName} (archived)`
                                : it.wishlistName}
                            </span>
                          </Link>
                        </div>
                      }
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
