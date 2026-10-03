'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Icon from '@/components/Icon';
import Select from '@/components/Select';
import FilterDropdown, { type FilterOption } from '@/components/FilterDropdown';
import MultiSelectDropdown from '@/components/MultiSelectDropdown';
import Cover from '@/components/Cover';
import { useToast } from '@/components/ToastProvider';
import { signInPath } from '@/lib/utils/callbackUrl';
import { formatPrice } from '@/lib/utils/currency';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';
import { isSortType, sortItems, SORT_OPTIONS, type SortType } from '@/lib/utils/itemFilters';
import { formatOwnerItemSummary, tallyItems } from '@/lib/utils/itemCounts';

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

const STATUS_BADGE: Partial<Record<MyItem['status'], { label: string; className: string }>> = {
  draft: { label: 'Draft', className: 'bg-surface-2 text-muted-foreground' },
  proposed: { label: 'Proposed', className: 'bg-primary-600 text-white' },
  completed: { label: 'Completed', className: 'bg-emerald-500 text-white' },
};

// Owner view: booked is folded into "available" by the API (never revealed).
// Same order the stat cards render in, so cards ↔ dropdown line up.
const STATUS_FILTER_OPTIONS: FilterOption[] = [
  'all',
  'draft',
  'proposed',
  'available',
  'completed',
];

// localStorage keys — kept separate from the per-wishlist page's keys.
const LS_STATUS = 'items-status-filters';
const LS_LISTS = 'items-wishlist-filters';
const LS_SORT = 'items-sort';

const CARD_META: Record<
  Exclude<FilterOption, 'bookedByMe' | 'bookedByOthers' | 'proposedByMe'>,
  { label: string; valueClass: string }
> = {
  // "All", not a total: it counts drafts and proposals too, and "N items" means
  // published items only (lib/utils/itemCounts.ts).
  all: { label: 'All', valueClass: 'text-foreground' },
  draft: { label: 'Draft', valueClass: 'text-muted-foreground' },
  proposed: { label: 'Proposed', valueClass: 'text-blue-500' },
  available: { label: 'Available', valueClass: 'text-foreground' },
  completed: { label: 'Completed', valueClass: 'text-emerald-500' },
};

export default function MyItemsPage() {
  const { status } = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const locale = useViewerLocale();
  const [items, setItems] = useState<MyItem[]>([]);
  const [loading, setLoading] = useState(true);
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
        if (body.success) {
          setItems(body.data as MyItem[]);
          setArchivedItems(typeof body.archivedItems === 'number' ? body.archivedItems : 0);
          setIncludeArchived(withArchived);
        } else showToast('Failed to load items', 'error');
      } catch {
        if (isLatest()) showToast('Failed to load items', 'error');
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

  // Restore persisted status filter + sort once loaded (independent of items).
  useEffect(() => {
    if (loading) return;
    const storedStatus = localStorage.getItem(LS_STATUS);
    if (storedStatus) {
      try {
        const parsed = JSON.parse(storedStatus) as FilterOption[];
        const valid = parsed.filter((f) => STATUS_FILTER_OPTIONS.includes(f));
        if (valid.length > 0) setStatusFilters(valid);
      } catch {
        /* ignore malformed */
      }
    }
    const storedSort = localStorage.getItem(LS_SORT);
    if (isSortType(storedSort)) setSort(storedSort);
  }, [loading]);

  // Restore the list filter once items (and therefore valid ids) are known;
  // fall back to "all lists". Stale ids from deleted (or archived) lists are
  // dropped. After that, each read Include archived makes selects the lists it
  // adds and drops the ones it takes away, back to all lists if that leaves none.
  useEffect(() => {
    if (loading) return;
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
  }, [loading, items]);

  // Persist changes (skip empty selections so a transient state can't clobber).
  useEffect(() => {
    if (loading || statusFilters.length === 0) return;
    localStorage.setItem(LS_STATUS, JSON.stringify(statusFilters));
  }, [loading, statusFilters]);

  useEffect(() => {
    if (loading || wishlistFilters.length === 0) return;
    localStorage.setItem(LS_LISTS, JSON.stringify(wishlistFilters));
  }, [loading, wishlistFilters]);

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
    const nonAll = STATUS_FILTER_OPTIONS.filter((o) => o !== 'all');
    if (nonAll.every((o) => statusFilters.includes(o))) return 'all';
    if (statusFilters.length === 1) return statusFilters[0];
    return null;
  }, [statusFilters]);

  const applyStatusCard = (key: FilterOption) => {
    setStatusFilters(key === 'all' ? [...STATUS_FILTER_OPTIONS] : [key]);
  };

  const visibleItems = useMemo(() => {
    const list = items.filter(
      (i) =>
        wishlistFilters.includes(i.wishlistId) &&
        (statusFilters.includes('all') || statusFilters.includes(i.status))
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
              className="mt-6 grid gap-3 sm:gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))' }}
            >
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="skeleton h-[70px] rounded-xl sm:h-[78px]" />
              ))}
            </div>
            {/* Item grid — square image + small body, matching the real cards */}
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
                >
                  <div className="skeleton aspect-square w-full" />
                  <div className="flex flex-col gap-2 p-3">
                    <div className="skeleton h-4 w-4/5 rounded-md" />
                    <div className="skeleton h-3 w-1/3 rounded-md" />
                    <div className="skeleton mt-1 h-3 w-1/2 rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : items.length === 0 ? (
          <div className="mt-8 flex flex-col items-center rounded-3xl border border-dashed border-border-strong py-20 text-center">
            <span className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-3xl bg-primary-500/12 text-accent dark:text-primary-300">
              <Icon name="package" size={30} />
            </span>
            <h3 className="text-xl font-semibold text-foreground">No items yet</h3>
            <p className="mx-auto mt-2 max-w-sm px-4 text-[15px] text-muted-foreground">
              Items you add to your wishlists will appear here.
            </p>
            {/* Archived lists are left out by default, and the List filter that
                brings them back isn't shown without items. */}
            {!includeArchived && archivedItems > 0 && (
              <button
                type="button"
                onClick={() => changeIncludeArchived(true)}
                disabled={archivedWanted !== null}
                className="mt-6 text-sm font-semibold text-accent hover:underline disabled:opacity-60"
              >
                Include archived lists
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Stat cards — full-width row; click to filter by status */}
            <div
              className="mt-6 grid gap-3 sm:gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))' }}
            >
              {STATUS_FILTER_OPTIONS.map((key) => {
                const meta = CARD_META[key as keyof typeof CARD_META];
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
                    <p className={`text-2xl font-bold sm:text-3xl ${meta.valueClass}`}>
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
                <FilterDropdown
                  options={STATUS_FILTER_OPTIONS}
                  selectedFilters={statusFilters}
                  onChange={setStatusFilters}
                  ariaLabel="Filter by status"
                  className="w-full sm:w-auto sm:min-w-[200px]"
                />
              </div>
              <MultiSelectDropdown
                label="List"
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
              <div className="mt-8 rounded-3xl border border-dashed border-border-strong py-16 text-center text-[15px] text-muted-foreground">
                No items match these filters.
              </div>
            ) : (
              <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {visibleItems.map((it) => {
                  const badge = STATUS_BADGE[it.status];
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
                        {badge && (
                          <span
                            className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-semibold shadow-sm ${badge.className}`}
                          >
                            {badge.label}
                          </span>
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
                        <p className="truncate text-sm font-semibold text-foreground">{it.name}</p>
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
