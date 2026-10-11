import Icon from '@/components/Icon';
import { TONE_CLASSES } from '@/lib/utils/statusTones';
import { plural } from '@/lib/utils/plural';
import ChangedRow from './ChangedRow';
import type { Reservation } from './types';

/**
 * Detached reservations: the item changed after it was reserved, so the gifter
 * is asked to resolve them (mark as given, or dismiss). An inline banner above
 * what's to give (WIS-394), not a section of its own: its rows are the banner's
 * body, so it reads as something to settle on the way in.
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
    <section
      aria-label="Changed since you reserved"
      data-testid="changed-banner"
      className={`overflow-hidden rounded-2xl border ${TONE_CLASSES.warning.card}`}
    >
      <div className={`flex items-start gap-2.5 p-3.5 text-sm ${TONE_CLASSES.warning.tint}`}>
        <Icon name="alert" size={18} className="mt-px flex-shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">
            {plural(needsConfirm.length, 'gift')} changed since you reserved
          </p>
          <p className="mt-0.5">
            If you gave the gift, mark it so it’s saved to your history. Otherwise dismiss it.
            Either way, the owner’s list isn’t affected.
          </p>
        </div>
      </div>
      <div className="divide-y divide-border bg-surface">
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
