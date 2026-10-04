'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Badge from '@/components/Badge';
import EmptyState from '@/components/EmptyState';
import Icon from '@/components/Icon';
import LoadError from '@/components/LoadError';
import Select from '@/components/Select';
import MultiSelectDropdown from '@/components/MultiSelectDropdown';
import Cover from '@/components/Cover';
import { Skeleton } from '@/components/Skeleton';
import { useToast } from '@/components/ToastProvider';
import { signInPath } from '@/lib/utils/callbackUrl';
import { formatPrice } from '@/lib/utils/currency';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';
import {
  forgetSavedStatusFilters,
  isEveryStatusSelected,
  isSortType,
  sortItems,
  SORT_OPTIONS,
  statusFilterPicker,
  type FilterOption,
  type SortType,
} from '@/lib/utils/itemFilters';
import { formatOwnerItemSummary, tallyItems } from '@/lib/utils/itemCounts';
import { FILTER_META, statusMeta } from '@/lib/utils/itemStatus';
import { TONE_CLASSES } from '@/lib/utils/statusTones';

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

// Owner view: booked is folded into "available" by the API (never revealed).
// Same order the stat cards render in, so cards ↔ dropdown line up.
const STATUS_FILTER_OPTIONS: FilterOption[] = [
  'all',
  'draft',
  'proposed',
  'available',
  'completed',
];
const STATUS_PICKER = statusFilterPicker(STATUS_FILTER_OPTIONS, STATUS_FILTER_OPTIONS);

// localStorage keys — kept separate from the per-wishlist page's keys. The
// status filter isn't saved, as on the wishlist page: it starts on All each
// visit, so a stat card clicked once doesn't narrow the page for good.
const LS_LISTS = 'items-wishlist-filters';
const LS_SORT = 'items-sort';

export default function MyItemsPage() {
  const { status } = useKnownSession();
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
  const [statusFilters, setStatusFilters] = useState<FilterOption[]>([...STATUS_FILTER_OPTIONS]);
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
    const storedSort = localStorage.getItem(LS_SORT);
    if (isSortType(storedSort)) setSort(storedSort);
  }, [ready]);

  // Restore the list filter once items (and therefore valid ids) are known;
  // fall back to "all lists". Stale ids from deleted (or archived) lists are
  // dropped. After that, each read Include archived makes selects the lists it
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
    const stored = localStorage.getItem(LS_LISTS);
    if (stored) {
      try {
        const valid = (JSON.parse(stored) as string[]).filter((id) => ids.has(id));
        if (valid.length > 0) {
          setWishlistFilters(valid);
          return;
        }
      } catch {
        /* ignore malformed */
      }
    }
    setWishlistFilters(Array.from(ids));
  }, [ready, items]);

  // Persist changes (skip empty selections so a transient state can't clobber).
  useEffect(() => {
    if (!ready || wishlistFilters.length === 0) return;
    localStorage.setItem(LS_LISTS, JSON.stringify(wishlistFilters));
  }, [ready, wishlistFilters]);

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

  // "57 items · 3 drafts · 2 to review", counted as the dashboard counts them.
  const summary = useMemo(() => formatOwnerItemSummary(tallyItems(items)), [items]);

  // Per-status counts across all owned items (cards show totals, ignore filters).
  const counts = useMemo(() => {
    const c = { all: items.length, draft: 0, proposed: 0, available: 0, completed: 0 };
    for (const it of items) if (it.status in c) c[it.status as keyof typeof c]++;
    return c;
  }, [items]);

  // Which status card reflects the current selection (for highlighting).
  const activeStatusCard = useMemo<FilterOption | null>(() => {
    if (isEveryStatusSelected(statusFilters, STATUS_FILTER_OPTIONS)) return 'all';
    if (statusFilters.length === 1) return statusFilters[0];
    return null;
  }, [statusFilters]);

  const applyStatusCard = (key: FilterOption) => {
    setStatusFilters(key === 'all' ? [...STATUS_FILTER_OPTIONS] : [key]);
  };

  const visibleItems = useMemo(() => {
    const everyStatus = isEveryStatusSelected(statusFilters, STATUS_FILTER_OPTIONS);
    const list = items.filter(
      (i) =>
        wishlistFilters.includes(i.wishlistId) && (everyStatus || statusFilters.includes(i.status))
    );
    // The wishlist page's sorter, so the two grids order items the same way.
    return sortItems(list, sort);
  }, [items, wishlistFilters, statusFilters, sort]);

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
          <>
            {/* Stat cards row */}
            <div
              className="mt-8 grid gap-3 sm:gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))' }}
            >
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[70px] rounded-xl sm:h-[78px]" />
              ))}
            </div>
            {/* Item grid — square image + small body, matching the real cards */}
            <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
                >
                  <Skeleton className="aspect-square w-full rounded-none" />
                  <div className="flex flex-col gap-2 p-3">
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="mt-1 h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </>
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
            {/* Stat cards — full-width row; click to filter by status */}
            <div
              className="mt-8 grid gap-3 sm:gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))' }}
            >
              {STATUS_FILTER_OPTIONS.map((key) => {
                // "All", not a total: it counts drafts and proposals too, and "N
                // items" means published items only (lib/utils/itemCounts.ts).
                const meta = FILTER_META[key];
                const active = activeStatusCard === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyStatusCard(key)}
                    aria-pressed={active}
                    title={`Show ${meta.label.toLowerCase()}`}
                    className={`rounded-xl border bg-surface p-3 text-left shadow-sm transition-all sm:p-4 ${
                      active
                        ? 'border-accent ring-1 ring-accent'
                        : 'border-border hover:border-border-strong hover:bg-surface-hover'
                    }`}
                  >
                    <p className="mb-1 truncate text-xs text-muted-foreground sm:text-sm">
                      {meta.label}
                    </p>
                    <p className={`text-2xl font-bold sm:text-3xl ${TONE_CLASSES[meta.tone].text}`}>
                      {counts[key as keyof typeof counts]}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Filters + sort */}
            <div className="mt-6 flex flex-wrap items-end gap-3 sm:gap-4">
              <div className="w-full sm:w-auto">
                <label className="mb-2 block whitespace-nowrap text-xs font-medium text-foreground sm:text-sm">
                  Status
                </label>
                <MultiSelectDropdown
                  {...STATUS_PICKER}
                  selected={statusFilters}
                  onChange={setStatusFilters}
                  ariaLabel="Filter by status"
                  className="w-full sm:w-auto sm:min-w-[200px]"
                />
              </div>
              <MultiSelectDropdown
                label="List"
                className="min-w-[200px]"
                options={wishlistOptions}
                selected={wishlistFilters}
                onChange={setWishlistFilters}
                allLabel="All lists"
                extraToggle={{
                  label: 'Include archived',
                  checked: archivedWanted ?? includeArchived,
                  onChange: changeIncludeArchived,
                }}
              />
              <div className="ml-auto">
                <label className="mb-2 block whitespace-nowrap text-xs font-medium text-foreground sm:text-sm">
                  Sort by:
                </label>
                <Select
                  ariaLabel="Sort items"
                  value={sort}
                  onChange={(v) => {
                    // Saved only when picked, so the default can still change.
                    setSort(v as SortType);
                    localStorage.setItem(LS_SORT, v);
                  }}
                  options={SORT_OPTIONS}
                  menuAlign="right"
                  triggerClassName="w-full sm:w-auto sm:min-w-[13rem]"
                />
              </div>
            </div>

            {visibleItems.length === 0 ? (
              <EmptyState
                className="mt-8"
                tone="muted"
                icon="package"
                title="No items found"
                body="No items match these filters."
              />
            ) : (
              <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {visibleItems.map((it) => {
                  // The owner's view: the API has already folded booked into available.
                  const badge = statusMeta(it.status, 'owner');
                  return (
                    <div
                      key={it._id}
                      className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
                    >
                      <Cover
                        src={it.imageUrl}
                        seed={it._id}
                        alt={it.name}
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw"
                        className="relative aspect-square w-full bg-surface-2"
                      >
                        {badge.badge && (
                          <Badge
                            status={badge}
                            size="sm"
                            className="absolute left-2 top-2 shadow-sm"
                          />
                        )}
                        {it.mostWanted && (
                          <span
                            role="img"
                            aria-label="Most wanted"
                            title="Most wanted"
                            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface/90 shadow-sm backdrop-blur"
                          >
                            <Icon name="star" size={12} className="fill-amber-400 text-amber-500" />
                          </span>
                        )}
                      </Cover>
                      <div className="flex flex-1 flex-col p-3">
                        <p className="truncate text-body font-semibold text-foreground">
                          {it.name}
                        </p>
                        {it.price && (
                          <p className="text-sm text-muted-foreground">
                            {formatPrice(it.price, locale)}
                          </p>
                        )}
                        <Link
                          href={`/wishlists/${it.wishlistSlug ?? it.wishlistId}`}
                          className="mt-auto inline-flex items-center gap-1 pt-2 text-xs font-medium text-accent hover:underline"
                        >
                          <Icon name="gift" size={12} />
                          <span className="truncate">{it.wishlistName}</span>
                        </Link>
                      </div>
                    </div>
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
