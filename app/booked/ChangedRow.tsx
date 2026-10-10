import { useId } from 'react';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import SnapshotThumb from '@/components/SnapshotThumb';
import GivenMoment from '@/components/GivenMoment';
import { changedCardPrimary, reservationNote } from '@/lib/utils/reservations';
import ListName from './ListName';
import ReservationPrice from './ReservationPrice';
import type { Reservation } from './types';

/**
 * A reservation that changed since it was reserved, as a compact row in the
 * warning tone. Its main action follows what happened (`changedCardPrimary`):
 * "I gave it" when the owner marked it received (or nothing says it didn't go
 * ahead), else Dismiss, with "I gave it anyway" beside it.
 */
export default function ChangedRow({
  r,
  busy,
  given,
  viewerCurrency,
  rates,
  onGift,
  onDismiss,
}: {
  r: Reservation;
  busy: boolean;
  /** Playing the Mark as given moment, just before it leaves (WIS-407). */
  given: boolean;
  viewerCurrency: string;
  rates: Record<string, number> | null;
  onGift: () => void;
  onDismiss: () => void;
}) {
  const nameId = useId();
  const note = reservationNote(r);
  const gaveFirst = changedCardPrimary(r) === 'gave';
  const gave = (
    <Button
      key="gave"
      size="sm"
      icon="check"
      variant={gaveFirst ? 'primary' : 'ghost'}
      disabled={busy}
      onClick={onGift}
    >
      {gaveFirst ? 'I gave it' : 'I gave it anyway'}
    </Button>
  );
  const dismiss = (
    <Button
      key="dismiss"
      size="sm"
      variant={gaveFirst ? 'ghost' : 'secondary'}
      disabled={busy}
      onClick={onDismiss}
      title="Remove from reservations"
    >
      Dismiss
    </Button>
  );
  return (
    <article
      aria-labelledby={nameId}
      className="relative flex gap-3 p-3 sm:px-4"
      data-motion={given ? 'given' : undefined}
    >
      {given && <GivenMoment />}
      <SnapshotThumb src={r.itemImage} alt={r.itemName} seed={r._id} small />
      <div className="min-w-0 flex-1">
        <p id={nameId} className="truncate text-sm font-semibold text-foreground">
          {r.itemName}
        </p>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2">
          <ListName r={r} />
          {/* A group gift's: their own share, which "I gave it" logs. */}
          {r.pledge ? (
            <span className="text-xs text-muted-foreground">
              Your share{' '}
              <ReservationPrice
                price={r.pledge}
                viewerCurrency={viewerCurrency}
                rates={rates}
                compact
              />
            </span>
          ) : (
            r.itemPrice && (
              <span className="text-xs text-muted-foreground">
                <ReservationPrice
                  price={r.itemPrice}
                  viewerCurrency={viewerCurrency}
                  rates={rates}
                  compact
                />
              </span>
            )
          )}
        </div>
        {note && (
          <p className="mt-1">
            <Badge tone="warning" size="sm" icon="info">
              {note}
            </Badge>
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {gaveFirst ? [gave, dismiss] : [dismiss, gave]}
        </div>
      </div>
    </article>
  );
}
