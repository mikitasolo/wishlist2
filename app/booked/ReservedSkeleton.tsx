import { Skeleton } from '@/components/Skeleton';

/** The first load's placeholder: a heading and three reservation cards. */
export default function ReservedSkeleton() {
  return (
    <div className="mt-8">
      <Skeleton className="mb-4 ml-1 h-6 w-24" />
      <div className="grid grid-cols-1 gap-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
          >
            <div className="flex gap-3 p-3">
              <Skeleton className="h-16 w-16 flex-shrink-0 rounded-xl" />
              <div className="flex flex-1 flex-col gap-2 pt-1">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <div className="flex gap-2 border-t border-border p-3">
              <Skeleton className="h-9 flex-1 rounded-xl" />
              <Skeleton className="h-9 w-28 rounded-xl" />
              <Skeleton className="h-9 w-9 rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
