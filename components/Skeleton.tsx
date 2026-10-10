/**
 * Content-shaped skeleton loaders. Every placeholder block is a `Skeleton`
 * (never a raw `.skeleton` element): the `skeleton` class (see globals.css)
 * gives the shimmer and the surface, this the default radius. A page's
 * skeleton matches its layout, so nothing jumps when the content lands: when
 * a layout changes, its skeleton changes with it.
 */

import type { ReactNode } from 'react';

interface SkeletonProps {
  /** Size, shape and spacing. A `rounded-*` here replaces the default `rounded-md`. */
  className?: string;
  /** `span` for a placeholder inside a line of text (a count). */
  as?: 'div' | 'span';
  /** Screen-reader text, e.g. `<span className="sr-only">Loading</span>`. */
  children?: ReactNode;
}

export function Skeleton({ className = '', as: Tag = 'div', children }: SkeletonProps) {
  const radius = /(^|\s)rounded(-|\s|$)/.test(className) ? '' : 'rounded-md';
  return <Tag className={`skeleton ${radius} ${className}`}>{children}</Tag>;
}

/**
 * Card skeleton matching WishlistCard line for line: the 16:9 cover, then the
 * body's title, a one-line description and the footer (the owner, with
 * `showOwner`, and the item count), each in a box of its line's height. So a
 * card lands where its skeleton was, as tall as it unless its description
 * runs to none or two lines.
 */
export function WishlistCardSkeleton({ showOwner = false }: { showOwner?: boolean }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-md">
      <Skeleton className="aspect-[16/9] w-full rounded-none" />
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        {/* The title's line (text-title) */}
        <div className="flex h-6 items-center">
          <Skeleton className="h-4 w-3/4" />
        </div>
        {/* A description's line (text-sm) */}
        <div className="mt-1 flex h-5 items-center">
          <Skeleton className="h-3 w-full" />
        </div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          {showOwner ? (
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          ) : (
            <span />
          )}
          {/* The item count's line (text-meta) */}
          <div className="flex h-[1.125rem] items-center">
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Card skeleton matching WishlistItem (square image, title, price, and its one
 * row of actions: the primary action, the link button and the menu button),
 * each in a box of the real line's height and margins. Below `sm`, like the
 * card in the two-column grid there, it's tighter, with a `text-body` title
 * and no link button (the link is in the card's menu). Its cover is square, as
 * a card with a photo's is: one with none is a shorter 4:3 below `sm`, which a
 * skeleton can't know before the items load.
 */
export function ItemCardSkeleton() {
  return (
    <div className="flex min-w-0 flex-col rounded-3xl border border-border bg-surface p-3 shadow-md sm:p-5">
      <Skeleton className="mb-3 aspect-square w-full rounded-2xl sm:mb-4" />
      {/* The title's line (text-body, text-title from sm) */}
      <div className="mb-1.5 flex h-[1.375rem] items-center sm:mb-3 sm:h-6">
        <Skeleton className="h-4 w-4/5" />
      </div>
      <div className="mb-2 flex min-h-[28px] items-center sm:mb-3 sm:min-h-[32px]">
        <Skeleton className="h-5 w-16 sm:w-24" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-10 flex-1 rounded-xl" />
        <Skeleton className="h-10 w-10 rounded-xl max-sm:hidden" />
        <Skeleton className="h-10 w-10 rounded-xl" />
      </div>
    </div>
  );
}

/** The item grid's columns: two on a phone (`gap-4`), up to four from `xl`. */
export const ITEM_GRID_CLASSES = 'grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4';

/** Row skeleton for a list `Panel`'s rows (owners, members): avatar, name, a meta line. */
export function MemberRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
      <Skeleton className="h-10 w-10 flex-shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-48 max-w-full" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}

/** Every grid of list cards: one column on a phone up to four from `xl`, `gap-5`. */
export const WISHLIST_GRID_CLASSES =
  'grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

/** The frame of a section's compact list rows on a phone (`WishlistList`): one panel, a line between rows. */
export const WISHLIST_ROWS_CLASSES =
  'divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-sm';

/**
 * Row skeleton matching `WishlistRow`: the 56px cover square, then the name's
 * line (text-body) and the meta line (text-meta), each in a box of its line's
 * height, in a row of the same 72px.
 */
export function WishlistRowSkeleton() {
  return (
    <div className="flex min-h-[4.5rem] items-center gap-3 px-3 py-2">
      <Skeleton className="h-14 w-14 flex-shrink-0 rounded-xl" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[1.375rem] items-center">
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="mt-0.5 flex h-[1.125rem] items-center">
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
    </div>
  );
}

/**
 * A section of lists while they load, as `WishlistList` lays them out: compact
 * rows below `sm`, cards from `sm` up, picked by CSS alone (`showOwner` for
 * other people's lists, whose cards name their owner).
 */
export function WishlistListSkeleton({
  count = 8,
  showOwner = false,
}: {
  count?: number;
  showOwner?: boolean;
}) {
  return (
    <div>
      <div data-wishlist-rows className={`${WISHLIST_ROWS_CLASSES} sm:hidden`}>
        {Array.from({ length: count }).map((_, i) => (
          <WishlistRowSkeleton key={i} />
        ))}
      </div>
      <SkeletonGrid count={count} showOwner={showOwner} className="max-sm:hidden" />
    </div>
  );
}

/**
 * A grid of card skeletons, laid out as every grid of cards is (`gap-5`, one
 * column on a phone up to four from `xl`), so nothing moves when the cards land.
 * Item cards are the exception: two columns on a phone (`ITEM_GRID_CLASSES`).
 * `showOwner` for a grid whose cards name their owner (Shared, a profile). A
 * section of lists that shows rows on a phone takes `WishlistListSkeleton`.
 */
export function SkeletonGrid({
  count = 8,
  variant = 'wishlist',
  showOwner = false,
  className = '',
}: {
  count?: number;
  variant?: 'wishlist' | 'item';
  showOwner?: boolean;
  /** Added to the grid's own classes, e.g. to hide it at some widths. */
  className?: string;
}) {
  return (
    <div
      data-wishlist-cards={variant === 'wishlist' ? '' : undefined}
      className={[variant === 'item' ? ITEM_GRID_CLASSES : WISHLIST_GRID_CLASSES, className]
        .filter(Boolean)
        .join(' ')}
    >
      {Array.from({ length: count }).map((_, i) =>
        variant === 'item' ? (
          <ItemCardSkeleton key={i} />
        ) : (
          <WishlistCardSkeleton key={i} showOwner={showOwner} />
        )
      )}
    </div>
  );
}

/**
 * A list's item controls while its items load, as `FilterChips` and the
 * toolbar under them lay out: the row of status chips (`chips` of them; none
 * for a visitor, who gets no chips), then the search field and the Sort
 * trigger: one row from `sm` up, and on a phone the search on a row of its own
 * with Sort under it. Prices isn't drawn: whether it shows depends on the items'
 * currencies, and it only ever narrows the search field when it does. Each
 * block is the 36px height of what replaces it.
 */
export function ListControlsSkeleton({ chips }: { chips: number }) {
  return (
    <div className="mb-3 pb-3 sm:mb-5">
      {chips > 0 && (
        <div className="-mx-4 mb-2 flex gap-2 overflow-hidden px-4 py-1 sm:mx-0 sm:px-0">
          {Array.from({ length: chips }).map((_, i) => (
            <Skeleton
              key={i}
              className={`h-9 flex-shrink-0 rounded-full ${i === 0 ? 'w-16' : 'w-28'}`}
            />
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 sm:gap-3">
        <Skeleton className="h-9 min-w-[6rem] flex-1 rounded-xl" />
        <Skeleton className="h-9 w-28 flex-shrink-0 rounded-xl sm:w-40" />
      </div>
    </div>
  );
}
