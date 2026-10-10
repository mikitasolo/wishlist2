import { TONE_CLASSES } from '@/lib/utils/statusTones';
import ChangedRow from './ChangedRow';
import SectionHeading from './SectionHeading';
import type { Reservation } from './types';

/**
 * Detached reservations: the item changed after it was reserved, so the gifter
 * is asked to resolve them (mark as given, or dismiss).
 */
export default function ChangedSection({
  needsConfirm,
  busy,
  givenIds,
  viewerCurrency,
  rates,
  onGift,
  onDismiss,
}: {
  needsConfirm: Reservation[];
  busy: (id: string) => boolean;
  givenIds: ReadonlySet<string>;
  viewerCurrency: string;
  rates: Record<string, number> | null;
  onGift: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <section>
      <SectionHeading title="Changed since you reserved" count={needsConfirm.length} />
      <p className="-mt-2 mb-4 px-1 text-sm text-muted-foreground">
        If you gave the gift, mark it so it’s saved to your history. Otherwise dismiss it. Either
        way, the owner’s list isn’t affected.
      </p>
      <div
        className={`divide-y divide-border overflow-hidden rounded-2xl border bg-surface shadow-sm ${TONE_CLASSES.warning.card}`}
      >
        {needsConfirm.map((r) => (
          <ChangedRow
            key={r._id}
            r={r}
            busy={busy(r._id)}
            given={givenIds.has(r._id)}
            viewerCurrency={viewerCurrency}
            rates={rates}
            onGift={() => onGift(r._id)}
            onDismiss={() => onDismiss(r._id)}
          />
        ))}
      </div>
    </section>
  );
}
