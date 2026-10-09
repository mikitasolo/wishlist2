import Badge from '@/components/Badge';
import { formatPrice } from '@/lib/utils/currency';
import { plural } from '@/lib/utils/plural';
import type { ContributingGroupGift } from '@/lib/utils/groupGiftSummary';

/**
 * A group gift on a contributor's Reserved card (WIS-363): "Group gift · N%
 * funded", a bar, what's pledged of the target, and every contributor's name
 * and pledge, the organizer marked and the viewer as "You". Only ever given a
 * gift the viewer is in (the API sends no other), so names and amounts reach
 * only the people in it. Amounts stay in the target's own currency, since the
 * pledges are: a converted total would show a sum nobody pledged.
 */
export default function ReservedGroupGift({
  gift,
  locale,
}: {
  gift: ContributingGroupGift;
  locale: string;
}) {
  const money = (value: number) => formatPrice({ value, currency: gift.target.currency }, locale);
  return (
    <div className="w-full min-w-0 space-y-1.5 pt-1" data-testid="reserved-group-gift">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-meta font-medium text-foreground">
          Group gift · {gift.percentFunded}% funded
        </p>
        {gift.status === 'funded' && (
          <Badge tone="success" size="sm">
            Funded
          </Badge>
        )}
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
          className="h-full rounded-full bg-success-fill"
          style={{ width: `${gift.percentFunded}%` }}
        />
      </div>
      <p className="text-meta text-muted-foreground">
        {money(gift.pledgedTotal)} of {formatPrice(gift.target, locale)} pledged
      </p>
      <ul className="space-y-1 pt-1" aria-label={plural(gift.contributors.length, 'contributor')}>
        {gift.contributors.map((c, i) => (
          <li
            key={i}
            className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-1.5 text-sm"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-foreground">{c.you ? 'You' : c.name}</span>
              {c.organizer && <Badge size="sm">Organizer</Badge>}
            </span>
            <span className="flex-shrink-0 font-semibold text-foreground">{money(c.pledged)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The confirmation for leaving a group gift, in the viewer's place in it: an
 * organizer leaving hands it to the earliest remaining contributor (named as
 * the gift names them), and the last one leaving ends it.
 */
export function leaveGroupGiftMessage(gift: ContributingGroupGift): string {
  if (!gift.organizer) return 'Your share comes off the total.';
  const next = gift.contributors.find((c) => !c.you);
  return next
    ? `${next.name} becomes the organizer.`
    : 'You’re the only one in it, so it ends and others on the list can reserve the item.';
}
