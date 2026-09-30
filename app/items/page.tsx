'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { formatPriceFromObject } from '@/lib/utils/currency';
import {
  compareMostWanted,
  isSortType,
  SORT_OPTIONS,
  type SortType,
} from '@/lib/utils/itemFilters';

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
  all: { label: 'Total', valueClass: 'text-foreground' },
  draft: { label: 'Draft', valueClass: 'text-muted-foreground' },
  proposed: { label: 'Proposed', valueClass: 'text-blue-500' },
  available: { label: 'Available', valueClass: 'text-foreground' },
  completed: { label: 'Completed', valueClass: 'text-emerald-500' },
};

export default function MyItemsPage() {
  const { status } = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const [items, setItems] = useState<MyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [wishlistFilters, setWishlistFilters] = useState<string[]>([]);
  const [statusFilters, setStatusFilters] = useState<FilterOption[]>([...STATUS_FILTER_OPTIONS]);
  const [sort, setSort] = useState<SortType>('date-desc');

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/users/me/items', { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setItems(res.data as MyItem[]);
        else showToast('Failed to load items', 'error');
      })
      .catch(() => showToast('Failed to load items', 'error'))
      .finally(() => setLoading(false));
  }, [status, showToast]);

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
  // fall back to "all lists". Stale ids from deleted lists are dropped.
  useEffect(() => {
    if (loading) return;
    const ids = new Set(items.map((i) => i.wishlistId));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

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
    for (const it of items) if (!seen.has(it.wishlistId)) seen.set(it.wishlistId, it.wishlistName);
    return Array.from(seen, ([value, label]) => ({ value, label }));
  }, [items]);

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
    const sorted = [...list];
    switch (sort) {
      case 'priority':
        // Most wanted first, newest first within each group (see date-desc).
        sorted.sort((a, b) => compareMostWanted(a, b) || b._id.localeCompare(a._id));
        break;
      case 'name-asc':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name-desc':
        sorted.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case 'price-asc':
      case 'price-desc':
        // Compare currency-normalized values (USD cents) so PLN vs USD sort
        // correctly. Items without a price sort to the bottom either way.
        sorted.sort((a, b) => {
          const av = a.priceInUsdCents ?? null;
          const bv = b.priceInUsdCents ?? null;
          if (av === null) return bv === null ? 0 : 1;
          if (bv === null) return -1;
          return sort === 'price-asc' ? av - bv : bv - av;
        });
        break;
      case 'date-asc':
        // ObjectIds encode creation time, so lexical order is chronological.
        sorted.sort((a, b) => a._id.localeCompare(b._id));
        break;
      case 'date-desc':
        sorted.sort((a, b) => b._id.localeCompare(a._id));
        break;
    }
    return sorted;
  }, [items, wishlistFilters, statusFilters, sort]);

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Items in your lists
        </h1>
        <p className="mt-1 text-muted-foreground">Everything across the wishlists you own.</p>

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
                            {formatPriceFromObject(it.price)}
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
