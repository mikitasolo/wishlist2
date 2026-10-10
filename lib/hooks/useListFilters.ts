'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiItem } from '@/types/api';
import type { ViewerRole } from '@/lib/utils/itemStatus';
import {
  searchItems,
  savedWishlistSort,
  forgetSavedStatusFilters,
  DEFAULT_WISHLIST_SORT,
  WISHLIST_SORT_STORAGE_KEY,
  type SortType,
} from '@/lib/utils/itemFilters';
import {
  addTileFor,
  countListChips,
  listChips,
  LIST_CHIP_LABELS,
  type ListChip,
  orderListItems,
} from '@/lib/utils/listChips';
import { useListChip } from '@/lib/hooks/useListChip';
import { useListSearch } from '@/lib/hooks/useListSearch';
import { useDiscreetMode } from '@/lib/hooks/useDiscreetMode';
import { withoutReservation } from '@/lib/utils/discreet';
import { useStickyItems } from '@/lib/hooks/useStickyItems';
import { useListPrices } from '@/lib/hooks/useListPrices';
import { useCurrencyRates } from '@/lib/hooks/useCurrencyRates';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';
import { filterByBudget, hasPricedItem, parseBudget } from '@/lib/utils/budgetFilter';
import { needsPricesControl, ORIGINAL_PRICES, viewerPriceCurrency } from '@/lib/utils/listPrices';

export interface ListFiltersOptions {
  /** The list on screen (null until it has loaded), which the chip is kept with. */
  list: { id: string; slug?: string | null } | null;
  /** The id or slug the page's URL names the list by. */
  wishlistId: string | null;
  viewerRole: ViewerRole;
  viewerId: string | null;
  isOwner: boolean;
  isMember: boolean;
  /** The viewer's account currency, if signed in. */
  defaultCurrency: string | null | undefined;
  /** The items as last read (never with discreet mode applied). */
  items: ApiItem[];
  /** Whether a read of the items has landed (before that, none isn't empty). */
  itemsLoaded: boolean;
}

/**
 * What a wishlist page shows of its items, and the controls that narrow it
 * (screens.md, "Status chips filter and are never saved; sort is saved"):
 *
 * - the status chip (`?show=`, `useListChip`), never saved;
 * - the sort, one saved setting for every list, saved only once picked;
 * - the item search (name and notes, in the URL's `?q=`, `useListSearch`, WIS-389)
 *   and the budget filter ("Under X", gifters only, WIS-326, page state),
 *   both cleared by Show all and on another list;
 * - the Prices currency pick (`useListPrices`), which the budget is read in;
 * - discreet mode (WIS-46), applied here at render time only (`viewItems`),
 *   never to `items`, so the poll can't flash the real state back.
 *
 * The chips count before the search and budget narrow, so a count never moves
 * with them. Cards the viewer has just changed stay put (`pinItem`, WIS-297)
 * until the chip, search, sort or budget change.
 */
export function useListFilters({
  list,
  wishlistId,
  viewerRole,
  viewerId,
  isOwner,
  isMember,
  defaultCurrency,
  items,
  itemsLoaded,
}: ListFiltersOptions) {
  const [sortBy, setSortBy] = useState<SortType>(DEFAULT_WISHLIST_SORT);
  // The item search (`?q=`, WIS-389): name and notes, kept in the URL, never saved.
  const [searchQuery, setSearchQuery] = useListSearch(list, wishlistId);

  // The status chip the list is shown on: All on every list the page opens
  // (or the URL's ?show=), kept only for this list and role, and never saved.
  const [chosenChip, chooseChip] = useListChip(list, wishlistId, viewerRole);

  // Discreet mode (WIS-46) keeps a member's reservations off the screen. It's
  // applied as the page renders (`viewItems`, below), never to `items`, which
  // the poll and the mutations keep as the server has it, so nothing flashes
  // the real state back. The chip for their own reservations goes, and a list
  // opened on it shows All.
  const { discreet } = useDiscreetMode();
  const hideReservations = discreet && isMember && !isOwner;
  const activeChip: ListChip =
    hideReservations && chosenChip === 'reserved-by-you' ? 'all' : chosenChip;

  // Restore the visitor's saved sort, else the default. It's one setting for
  // every list, so it's read once rather than per wishlist. A status filter an
  // earlier version saved is deleted, so it can't come back.
  useEffect(() => {
    setSortBy(savedWishlistSort(localStorage));
    forgetSavedStatusFilters(localStorage);
  }, []);

  // Save only a sort the visitor picks, so the default can change for everyone
  // who never chose one.
  const handleSortChange = useCallback((value: string) => {
    const next = value as SortType;
    setSortBy(next);
    localStorage.setItem(WISHLIST_SORT_STORAGE_KEY, next);
  }, []);

  // Each chip's count, by the rules the chips filter with (lib/utils/listChips.ts).
  // The items as this screen draws them: in discreet mode, none reserved.
  const viewItems = useMemo(
    () => (hideReservations ? items.map(withoutReservation) : items),
    [items, hideReservations]
  );
  const chipCounts = useMemo(
    () => countListChips(viewItems, viewerRole, viewerId),
    [viewItems, viewerRole, viewerId]
  );

  // The items under the chip, actionable ones first under All, in the
  // viewer's sort within each group.
  const chipItems = useMemo(
    () => orderListItems(viewItems, activeChip, viewerRole, viewerId, sortBy),
    [viewItems, activeChip, viewerRole, viewerId, sortBy]
  );

  // Prices (D9): someone else's list starts in the viewer's currency, their
  // own on each item's; offered only when some price is in another currency.
  const prices = useListPrices({ viewerId, defaultCurrency, ownList: isOwner, items });

  // The budget filter ("Under X", WIS-326): for gifters only (a signed-in
  // non-owner of someone else's list; a signed-out link visitor has no known
  // currency), never saved. The amount is in the currency Prices shows, so a
  // new pick re-reads the typed text in it; on each item's own currency (or
  // with Prices not offered) it's the account's default. It narrows what's
  // shown after the chips have counted, so a chip's count never moves with it.
  const accountCurrency = viewerPriceCurrency(defaultCurrency);
  const viewerCurrency = prices.value === ORIGINAL_PRICES ? accountCurrency : prices.value;
  const viewerLocale = useViewerLocale();
  const [budgetText, setBudgetText] = useState('');
  const budgetOffered = !isOwner && !!viewerId && hasPricedItem(items);
  const budget = budgetOffered ? parseBudget(budgetText, viewerLocale) : null;
  const budgetLimit = budget === 'invalid' ? null : budget;
  // Rates are only needed to compare a price in another currency.
  const ownRates = useCurrencyRates(
    budgetLimit !== null && prices.rates === null && needsPricesControl(items, viewerCurrency)
  );
  const budgetRates = prices.rates ?? ownRates;

  const filteredItems = useMemo(
    () =>
      filterByBudget(searchItems(chipItems, searchQuery), budgetLimit, viewerCurrency, budgetRates),
    [chipItems, searchQuery, budgetLimit, viewerCurrency, budgetRates]
  );

  // A card the viewer reserves, releases, publishes or marks stays in its
  // slot, and in view, until they change the chip, search or sort (WIS-297).
  const { items: sortedItems, pin: pinItem } = useStickyItems(
    filteredItems,
    viewItems,
    JSON.stringify([wishlistId, viewerRole, activeChip, sortBy, searchQuery, budgetLimit])
  );

  // The list has no items at all, as far as this viewer can see: no filter is
  // hiding anything, so the chips and the toolbar step aside for an empty
  // state that says so and offers the add itself. Only once a read has
  // landed: before that, no items means it hasn't loaded.
  const listIsEmpty = itemsLoaded && items.length === 0;

  // With the toolbar gone, a chip or search still in force couldn't be seen,
  // and could hide the next item added (Received, a search for the item just
  // deleted), so a list that empties goes back to All.
  useEffect(() => {
    if (!listIsEmpty) return;
    chooseChip('all');
    setSearchQuery('');
  }, [listIsEmpty, chooseChip, setSearchQuery]);

  // The way out of a search or chip that hides every item: All, and no search.
  const showAllItems = useCallback(() => {
    chooseChip('all');
    setSearchQuery('');
    setBudgetText('');
  }, [chooseChip, setSearchQuery]);

  // Clear the budget when switching to a different wishlist (the search is
  // kept per list by `useListSearch`).
  useEffect(() => {
    setBudgetText('');
  }, [wishlistId]);

  // The grid's first cell: an owner's Add item or a member's Propose an item,
  // under All (and a member's Your proposals), never while a search is on.
  const addTile = addTileFor(
    viewerRole,
    activeChip,
    searchQuery.trim() !== '' || budgetLimit !== null
  );

  const chips = listChips(viewerRole)
    .filter((chip) => !(hideReservations && chip === 'reserved-by-you'))
    .map((chip) => ({
      value: chip,
      label: LIST_CHIP_LABELS[chip],
      count: chipCounts[chip],
    }));

  return {
    sortBy,
    handleSortChange,
    searchQuery,
    setSearchQuery,
    activeChip,
    chooseChip,
    chips,
    hideReservations,
    viewItems,
    prices,
    budgetText,
    setBudgetText,
    budgetOffered,
    budgetInvalid: budget === 'invalid',
    budgetLimit,
    viewerCurrency,
    sortedItems,
    pinItem,
    listIsEmpty,
    showAllItems,
    addTile,
  };
}

export type ListFilters = ReturnType<typeof useListFilters>;
