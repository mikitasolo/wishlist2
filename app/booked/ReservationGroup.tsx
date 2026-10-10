import { useId } from 'react';
import Link from 'next/link';
import OccasionLabel from '@/components/OccasionLabel';
import type { OccasionGroup } from '@/lib/utils/reservations';
import { listPath } from './ListName';
import type { Reservation } from './types';

/**
 * One group of "To give": a list's reservations under its upcoming occasion,
 * "Birthday · today — Dmitri's birthday · @dmitri_v", or the rest under "No
 * date".
 */
export default function ReservationGroup({
  group,
  headed,
  children,
}: {
  group: OccasionGroup<Reservation>;
  headed: boolean;
  children: React.ReactNode;
}) {
  const headingId = useId();
  const first = group.reservations[0];
  return (
    <section aria-labelledby={headed ? headingId : undefined}>
      {headed && (
        <h3
          id={headingId}
          className="mb-3 flex min-w-0 flex-wrap items-center gap-x-1.5 px-1 text-sm font-semibold text-foreground"
        >
          {group.occasion ? (
            <>
              <OccasionLabel occasion={group.occasion} className="text-sm font-semibold" />{' '}
              <span aria-hidden="true">—</span>{' '}
              {/* Only an open list has an occasion to group by, so it's linked. */}
              <Link href={listPath(first)} className="min-w-0 truncate hover:underline">
                {group.wishlistName}
              </Link>
              {first.wishlistOwnerUsername && (
                <span className="font-normal text-muted-foreground">
                  {' '}
                  · @{first.wishlistOwnerUsername}
                </span>
              )}
            </>
          ) : (
            'No date'
          )}
        </h3>
      )}
      {/* One column: a card carries its notes and up to three actions. */}
      <div className="grid grid-cols-1 gap-4">{children}</div>
    </section>
  );
}
