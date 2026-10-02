/**
 * Content-shaped skeleton loaders. `skeleton` class (see globals.css)
 * provides the shimmer + surface background.
 */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-md ${className}`} />;
}

/** Card skeleton matching WishlistCard (cover band on top, then body). */
export function WishlistCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-md">
      {/* Cover band (16:9) */}
      <div className="skeleton aspect-[16/9] w-full" />
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

/** Row skeleton for member lists. */
export function MemberRowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-4 sm:px-6">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}

export function SkeletonGrid({
  count = 8,
  variant = 'wishlist',
}: {
  count?: number;
  variant?: 'wishlist' | 'item';
}) {
  const Card = variant === 'item' ? ItemCardSkeleton : WishlistCardSkeleton;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} />
      ))}
    </div>
  );
}
