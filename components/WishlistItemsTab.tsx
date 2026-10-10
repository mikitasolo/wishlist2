'use client';

import type { ComponentProps } from 'react';
import AddItemTile from '@/components/AddItemTile';
import BudgetFilter from '@/components/BudgetFilter';
import Button from '@/components/Button';
import EmptyState from '@/components/EmptyState';
import FilterChips from '@/components/FilterChips';
import Icon from '@/components/Icon';
import LoadError from '@/components/LoadError';
import ListSearch from '@/components/ListSearch';
import Select from '@/components/Select';
import ShareButton from '@/components/ShareButton';
import { ITEM_GRID_CLASSES, ListControlsSkeleton, SkeletonGrid } from '@/components/Skeleton';
import WishlistItem from '@/components/WishlistItem';
import { useStaggeredEntrance } from '@/lib/hooks/useCardMotion';
import type { ItemCards } from '@/lib/hooks/useItemCards';
import type { ListFilters } from '@/lib/hooks/useListFilters';
import type { ItemDialogsControl } from '@/lib/hooks/useItemDialogs';
import type { WishlistItemActions } from '@/lib/hooks/useWishlistItemActions';
import type { WishlistItemsControl } from '@/lib/hooks/useWishlistItems';
import { canCopyItem } from '@/lib/utils/itemCopy';
import { SORT_OPTIONS, SORT_SHORT_LABELS } from '@/lib/utils/itemFilters';
import type { ViewerRole } from '@/lib/utils/itemStatus';
import { isDimmedInAll, listChips } from '@/lib/utils/listChips';
import { TONE_CLASSES } from '@/lib/utils/statusTones';
import type { IWishlist } from '@/models/Wishlist';

export interface WishlistItemsTabProps {
  wishlist: IWishlist;
  isOwner: boolean;
  isMember: boolean;
  viewerRole: ViewerRole;
  viewerId: string | null;
  /** The session's user id, as the page has it (undefined signed out). */
  sessionUserId: string | undefined;
  isAuthenticated: boolean;
  /** A share link's token, in link mode: no Save to my list, no group gifts. */
  linkToken: string | null;
  itemsControl: Pick<
    WishlistItemsControl,
    'itemsLoaded' | 'itemsFailed' | 'loadingItems' | 'retryItems'
  >;
  filters: ListFilters;
  cards: ItemCards;
  dialogs: ItemDialogsControl;
  itemActions: Pick<WishlistItemActions, 'handleCardDelete'>;
  /** The empty list's Share, for an owner (as the header's). */
  shareOwner: NonNullable<ComponentProps<typeof ShareButton>['owner']>;
  onUnarchive: () => void;
  isArchiving: boolean;
}

/**
 * The wishlist page's Items tab (WIS-372): everyone's view of the list, and an
 * owner's first tab. The archived banner, the chips and toolbar, the empty
 * states and the cards. Everything it shows is kept by the page (the filters,
 * the cards' state, the dialogs), so a switch of tab loses none of it.
 */
export default function WishlistItemsTab({
  wishlist,
  isOwner,
  isMember,
  viewerRole,
  viewerId,
  sessionUserId,
  isAuthenticated,
  linkToken,
  itemsControl: { itemsLoaded, itemsFailed, loadingItems, retryItems },
  filters,
  cards,
  dialogs,
  itemActions,
  shareOwner,
  onUnarchive,
  isArchiving,
}: WishlistItemsTabProps) {
  const {
    sortBy,
    handleSortChange,
    searchQuery,
    setSearchQuery,
    activeChip,
    chooseChip,
    chips,
    prices,
    budgetText,
    setBudgetText,
    budgetOffered,
    budgetInvalid,
    budgetLimit,
    viewerCurrency,
    sortedItems,
    listIsEmpty,
    showAllItems,
    addTile,
  } = filters;
  const { setShowAddItemModal, setShowProposeItemModal, setItemToReview, setItemToSave } = dialogs;
  // The cards come in one after another as the grid first shows (WIS-407).
  const staggered = useStaggeredEntrance(
    itemsLoaded && !loadingItems,
    itemsLoaded && !loadingItems && sortedItems.length > 0
  );

  return (
    <>
      {/* Archived: say so before anything else, with the way back. Only an
          owner ever gets an archived list, but the banner checks anyway. */}
      {isOwner && wishlist.archived && (
        <div
          className={`mb-6 flex flex-col gap-3 rounded-2xl px-4 py-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between ${TONE_CLASSES.warning.notice}`}
        >
          <p className="flex items-center gap-2.5 text-sm font-medium text-foreground">
            <Icon
              name="archive"
              size={18}
              className={`flex-shrink-0 ${TONE_CLASSES.warning.text}`}
            />
            Archived. Only owners can see this list.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={onUnarchive}
            disabled={isArchiving}
            className="self-start sm:self-auto"
          >
            Unarchive
          </Button>
        </div>
      )}

      {!itemsLoaded ? (
        // No read of the items has landed yet: no counts or controls,
        // which would claim the list is empty (see `itemsLoaded`).
        itemsFailed ? (
          <LoadError title="Couldn’t load this list’s items" onRetry={retryItems} />
        ) : (
          <>
            {/* The chips and toolbar to come, as they'll be laid out */}
            <ListControlsSkeleton chips={listChips(viewerRole).length} />
            <SkeletonGrid count={8} variant="item" />
          </>
        )
      ) : (
        <>
          {/* Chips and toolbar: not on an empty list, where the chips
          would all be zero, the filters would have nothing to filter, and
          the empty state below offers the add (or the proposal) itself */}
          {!listIsEmpty && (
            <>
              {/* The filter row scrolls with the page (WIS-420): the chips,
                  then search and the sorts. */}
              <div className="mb-6 sm:mb-8">
                {/* The status chips (none for a visitor): one row, one choice */}
                {chips.length > 0 && (
                  <FilterChips
                    chips={chips}
                    value={activeChip}
                    onChange={chooseChip}
                    ariaLabel="Show items"
                    className="mb-2"
                  />
                )}

                {/* Toolbar: search, Sort, and Prices when it changes anything. One
                  row, search taking what Sort and Prices leave; Budget wraps. */}
                <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
                  <ListSearch value={searchQuery} onChange={setSearchQuery} />
                  <Select
                    value={sortBy}
                    onChange={handleSortChange}
                    ariaLabel="Sort items by"
                    options={SORT_OPTIONS}
                    valueLabel={SORT_SHORT_LABELS[sortBy]}
                    menuAlign="right"
                    triggerClassName="flex-shrink-0"
                  />
                  {prices.shown && (
                    <Select
                      value={prices.value}
                      onChange={prices.choose}
                      options={prices.options}
                      valueLabel={prices.valueLabel}
                      ariaLabel="Show prices in"
                      menuAlign="right"
                      triggerClassName="flex-shrink-0"
                    />
                  )}
                  {budgetOffered && (
                    <BudgetFilter
                      className="w-full sm:w-auto"
                      value={budgetText}
                      onChange={setBudgetText}
                      currency={viewerCurrency}
                      invalid={budgetInvalid}
                    />
                  )}
                </div>
              </div>
            </>
          )}

          {/* Items Grid */}
          {loadingItems ? (
            <SkeletonGrid count={8} variant="item" />
          ) : listIsEmpty ? (
            // Nothing on the list (that this viewer can see), so it says so,
            // with what each role can do about it, rather than blaming a filter.
            <EmptyState
              tone="muted"
              icon="gift"
              title={
                isOwner ? 'Your list is empty' : isMember ? 'Nothing here yet' : 'No items yet'
              }
              body={
                isOwner
                  ? "Add the things you'd love to get. You can keep them as drafts until you're ready to share."
                  : undefined
              }
              actions={
                isOwner ? (
                  <>
                    <Button onClick={() => setShowAddItemModal(true)}>Add your first item</Button>
                    {/* Not on an archived list, as the header's Share isn't. */}
                    {!wishlist.archived && (
                      <ShareButton
                        variant="button"
                        url={`/wishlists/${wishlist.slug || wishlist._id}`}
                        title={wishlist.name}
                        owner={shareOwner}
                      />
                    )}
                  </>
                ) : isMember ? (
                  <Button onClick={() => setShowProposeItemModal(true)}>Propose an item</Button>
                ) : undefined
              }
            />
          ) : sortedItems.length === 0 ? (
            // There are items, but the search or the chip hides every one.
            <EmptyState
              tone="muted"
              icon="package"
              title="No items found"
              body={
                searchQuery.trim()
                  ? `No items match “${searchQuery.trim()}”.`
                  : budgetLimit !== null && activeChip === 'all'
                    ? 'No items are under that price.'
                    : 'No items match this filter.'
              }
              actions={
                <>
                  {/* A member's Your proposals with none yet: the tile's
                      way to make one, since there's no grid to hold it. */}
                  {addTile === 'propose' && (
                    <Button onClick={() => setShowProposeItemModal(true)}>Propose an item</Button>
                  )}
                  <Button onClick={showAllItems} variant="secondary">
                    Show all
                  </Button>
                </>
              }
            />
          ) : (
            <div
              className={`${ITEM_GRID_CLASSES} ${staggered ? 'motion-stagger' : ''}`}
              data-staggered={staggered || undefined}
            >
              {addTile && (
                <AddItemTile
                  label={addTile === 'add' ? 'Add item' : 'Propose an item'}
                  data-tour={addTile === 'add' ? 'add-item' : undefined}
                  onClick={() =>
                    addTile === 'add' ? setShowAddItemModal(true) : setShowProposeItemModal(true)
                  }
                />
              )}
              {sortedItems.map((item) => (
                <WishlistItem
                  key={item._id}
                  item={item}
                  onUpdate={cards.handleStickyCardUpdate}
                  onEdit={
                    // Owners can edit non-proposed items
                    // Proposers can edit their own proposed items
                    (isOwner && item.status !== 'proposed') ||
                    (item.status === 'proposed' && item.proposedBy?.toString() === sessionUserId)
                      ? dialogs.handleEditItem
                      : undefined
                  }
                  onDelete={isOwner ? itemActions.handleCardDelete : undefined}
                  onAddLink={isOwner ? dialogs.handleAddItemLink : undefined}
                  onReview={
                    isOwner && item.status === 'proposed' ? () => setItemToReview(item) : undefined
                  }
                  onSaveToList={
                    // Any signed-in viewer, owners too (to copy between their
                    // lists), but not on a share link's page: copying is
                    // link-blind, so it would refuse a list the link opened.
                    !linkToken && canCopyItem(item, sessionUserId) ? setItemToSave : undefined
                  }
                  isAuthenticated={isAuthenticated}
                  isOwner={isOwner}
                  isMember={isMember}
                  priceCurrency={prices.value}
                  rates={prices.rates}
                  dimmed={activeChip === 'all' && isDimmedInAll(item, viewerRole, viewerId)}
                  highlighted={item._id === cards.highlightedItemId}
                  related={cards.relatedById.get(item._id)}
                  onShowItem={cards.showItem}
                  onGroupGift={
                    isMember && !isOwner && !linkToken ? cards.handleGroupGift : undefined
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
