/**
 * Content-shaped skeleton loaders. `skeleton` class (see globals.css)
 * provides the shimmer + surface background.
 */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-md ${className}`} />;
}

/** Card skeleton matching WishlistCard proportions. */
export function WishlistCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-3 w-full" />
      <div className="mt-4 flex items-center justify-between">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-4 w-16" />
      </div>
    </div>
  );
}

/** Card skeleton matching WishlistItem proportions. */
export function ItemCardSkeleton() {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5">
      <Skeleton className="mb-4 h-64 w-full rounded-xl" />
      <Skeleton className="mb-3 h-5 w-4/5" />
      <Skeleton className="mb-4 h-6 w-24" />
      <Skeleton className="h-10 w-full rounded-lg" />
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
