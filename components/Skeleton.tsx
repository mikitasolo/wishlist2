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

/** Card skeleton matching WishlistCard (cover band on top, then body). */
export function WishlistCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-md">
      {/* Cover band (16:9) */}
      <Skeleton className="aspect-[16/9] w-full rounded-none" />
      {/* Body */}
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <Skeleton className="h-[18px] w-3/4" />
        <Skeleton className="mt-2 h-3 w-full" />
        <Skeleton className="mt-1.5 h-3 w-2/3" />
        <div className="mt-4 flex items-center justify-between pt-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-3 w-12" />
        </div>
      </div>
    </div>
  );
}

/**
 * Card skeleton matching WishlistItem (square image, title, price, and its one
 * row of actions: the primary action, the link button and the menu button).
 */
export function ItemCardSkeleton() {
  return (
    <div className="flex flex-col rounded-3xl border border-border bg-surface p-4 shadow-md sm:p-5">
      <Skeleton className="mb-4 aspect-square w-full rounded-2xl" />
      <Skeleton className="mb-2 h-5 w-4/5" />
      <Skeleton className="mb-3 h-6 w-24" />
      <div className="flex gap-2">
        <Skeleton className="h-10 flex-1 rounded-xl" />
        <Skeleton className="h-10 w-10 rounded-xl" />
        <Skeleton className="h-10 w-10 rounded-xl" />
      </div>
    </div>
  );
}

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

/**
 * A grid of card skeletons. Its gaps match the grid it stands in for: the
 * dashboard's, Mine's and Shared's lists are `gap-5`, a list's items and a
 * profile's lists `gap-4 sm:gap-6` (pass `gapClassName`).
 */
export function SkeletonGrid({
  count = 8,
  variant = 'wishlist',
  gapClassName,
}: {
  count?: number;
  variant?: 'wishlist' | 'item';
  gapClassName?: string;
}) {
  const Card = variant === 'item' ? ItemCardSkeleton : WishlistCardSkeleton;
  const gap = gapClassName ?? (variant === 'item' ? 'gap-4 sm:gap-6' : 'gap-5');
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${gap}`}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} />
      ))}
    </div>
  );
}
