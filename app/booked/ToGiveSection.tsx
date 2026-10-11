import { groupByOccasion, occasionProgress, totalInCurrency } from '@/lib/utils/reservations';
import OccasionProgress from './OccasionProgress';
import ReservationCard from './ReservationCard';
import ReservationGroup from './ReservationGroup';
import SectionHeading from './SectionHeading';
import type { Gift, Reservation } from './types';

/**
 * "To give": what's still to give comes first, as it's what the page is for.
 * Grouped by each list's upcoming occasion, nearest first, afresh on every
 * render: a read or a card's action moves or drops cards between groups. With
 * no occasion coming up on any list there's one group, and it needs no heading.
 * Mark as given, Release and the group gift actions each open their
 * confirmation through the callbacks here.
 */
export default function ToGiveSection({
  active,
  gifts,
  showProgress,
  today,
  busy,
  givenIds,
  viewerCurrency,
  rates,
  onGift,
  onRelease,
  onGiveGroupGift,
  onLeaveGroupGift,
}: {
  active: Reservation[];
  /** The gift history, which a dated group's progress counts what's given from. */
  gifts: Gift[];
  /** Off while a search narrows `active`: a group's progress is of the whole occasion, not of its matches. */
  showProgress: boolean;
  today: string | null;
  busy: (id: string) => boolean;
  givenIds: ReadonlySet<string>;
  viewerCurrency: string;
  rates: Record<string, number> | null;
  onGift: (id: string) => void;
  /**
   * Still reserved to them, on a list they can open: Release frees it there
   * too. Dismissing would leave it reserved under their name, with nothing
   * tracking it.
   */
  onRelease: (id: string) => void;
  onGiveGroupGift: (id: string) => void;
  onLeaveGroupGift: (id: string) => void;
}) {
  const toGive = groupByOccasion(active, today);
  const headed = toGive.some((group) => group.occasion);
  return (
    <section>
      <SectionHeading title="To give" count={active.length} />
      {active.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">Nothing to give right now.</p>
      ) : (
        <div className="space-y-8">
          {toGive.map((group) => (
            <ReservationGroup
              key={group.key}
              group={group}
              headed={headed}
              progress={
                showProgress &&
                group.occasion &&
                today && (
                  <OccasionProgress
                    progress={occasionProgress(
                      group.occasion,
                      group.reservations[0].wishlistId,
                      group.reservations.length,
                      gifts,
                      today
                    )}
                    // A group gift counts as the viewer's own share of it.
                    leftTotal={totalInCurrency(
                      group.reservations.map((r) => r.pledge ?? r.itemPrice),
                      viewerCurrency,
                      rates
                    )}
                  />
                )
              }
            >
              {group.reservations.map((r) => (
                <ReservationCard
                  key={r._id}
                  r={r}
                  busy={busy(r._id)}
                  given={givenIds.has(r._id)}
                  // A dated group's heading names the list already.
                  showList={!group.occasion}
                  viewerCurrency={viewerCurrency}
                  rates={rates}
                  onGift={() => onGift(r._id)}
                  onRelease={() => onRelease(r._id)}
                  onGiveGroupGift={() => onGiveGroupGift(r._id)}
                  onLeaveGroupGift={() => onLeaveGroupGift(r._id)}
                />
              ))}
            </ReservationGroup>
          ))}
        </div>
      )}
    </section>
  );
}
