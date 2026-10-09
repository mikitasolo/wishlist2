import Badge from '@/components/Badge';
import { formatPrice } from '@/lib/utils/currency';
import { plural } from '@/lib/utils/plural';
import type { GroupGiftSummary } from '@/lib/utils/groupGiftSummary';

/** The line a group gift reads as, to anyone who may see it (WIS-362). */
export const groupGiftHeadline = (percent: number) => `Group gift · ${percent}% funded`;

/**
 * A group gift on an item: "Group gift · N% funded", a bar, and for a
 * contributor what's pledged of the target. With `showPeople` (the sheet) each
 * contributor's name and pledge follow. Another member's view of it is the
 * headline and bar alone: no names, amounts or count (WIS-361). Amounts are in
 * the target's own currency, since the pledges are, and adding converted ones
 * would show a total nobody pledged.
 */
export default function GroupGiftProgress({
  gift,
  locale,
  showPeople = false,
}: {
  gift: GroupGiftSummary;
  locale: string;
  showPeople?: boolean;
}) {
  const funded = gift.contributing && gift.status === 'funded';
  return (
    <div className="min-w-0 space-y-1.5" data-testid="group-gift">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-meta font-medium text-foreground">
          {groupGiftHeadline(gift.percentFunded)}
        </p>
        {funded && <Badge tone="success">Funded</Badge>}
      </div>
      <div
        role="progressbar"
        aria-label="Group gift funded"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={gift.percentFunded}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-success-fill transition-[width] duration-300"
          style={{ width: `${gift.percentFunded}%` }}
        />
      </div>
      {gift.contributing && (
        <p className="text-meta text-muted-foreground">
          {formatPrice({ value: gift.pledgedTotal, currency: gift.target.currency }, locale)} of{' '}
          {formatPrice(gift.target, locale)} pledged
        </p>
      )}
      {gift.contributing && showPeople && (
        <ul className="space-y-1 pt-1" aria-label={plural(gift.contributors.length, 'contributor')}>
          {gift.contributors.map((c, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-foreground">
                  {c.you ? 'You' : c.name}
                </span>
                {c.organizer && <Badge size="sm">Organizer</Badge>}
              </span>
              <span className="flex-shrink-0 font-semibold text-foreground">
                {formatPrice({ value: c.pledged, currency: gift.target.currency }, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
