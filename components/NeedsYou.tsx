'use client';

import { useId, type ReactNode } from 'react';
import Link from 'next/link';
import CurrencyPrompt, { useCurrencyOffer } from '@/components/CurrencyPrompt';
import Icon, { type IconName } from '@/components/Icon';
import InviteCard, { ACTION_CARD_CLASSES } from '@/components/InviteCard';
import { buttonClassName } from '@/components/buttonStyles';
import type { WishlistSummary } from '@/components/WishlistCard';
import { useChangedReservations } from '@/lib/hooks/useChangedReservations';
import { usePendingInvites } from '@/lib/hooks/usePendingInvites';
import { ACTIVITY_PATH } from '@/lib/utils/activityPath';
import { LIST_CHIP_PARAM } from '@/lib/utils/listChips';
import { plural } from '@/lib/utils/plural';
import { TONE_CLASSES } from '@/lib/utils/statusTones';

/** How many rows Needs you shows at most. */
export const NEEDS_YOU_LIMIT = 3;

/** A row of Needs you, by what it's about. */
type RowKind = 'invite' | 'reservations' | 'proposals' | 'currency';
interface Row {
  key: string;
  kind: RowKind;
  node: ReactNode;
}

/**
 * Which kinds get a row first when there are more rows than fit: one of each,
 * in this order, then the rest in the order they're shown. Proposals come last
 * because Activity lists them too (as it does invitations): the changed
 * reservations and the currency prompt are nowhere else on the way in.
 */
const FIRST_PICK: readonly RowKind[] = ['invite', 'reservations', 'currency', 'proposals'];

/**
 * The rows that fit, in the order they're shown: one of each kind first
 * (`FIRST_PICK`), so three invitations can't hide everything else, then the
 * others in their order until `limit` is reached.
 */
export function pickRows<T extends { kind: RowKind }>(rows: readonly T[], limit: number): T[] {
  const picked = new Set<T>();
  for (const kind of FIRST_PICK) {
    const first = rows.find((r) => r.kind === kind);
    if (first && picked.size < limit) picked.add(first);
  }
  for (const row of rows) {
    if (picked.size >= limit) break;
    picked.add(row);
  }
  return rows.filter((r) => picked.has(r));
}

/** The Booked page, where the gifter confirms what became of a changed reservation. */
const RESERVED_PATH = '/booked';

/**
 * The top of the dashboard (D4): what's waiting on you, in up to
 * `NEEDS_YOU_LIMIT` rows, then See all in Activity. Nothing at all when nothing
 * applies, and never a "nothing to do": a source that's still loading, or
 * failed to load, just adds no row. When more apply than fit, each kind gets a
 * row before any gets a second (`pickRows`). Shown in this order:
 *
 * - each pending invitation, with Accept and Decline in place (`InviteCard`,
 *   with its co-owner consent warning, answered through `usePendingInvites`,
 *   as Activity answers them);
 * - "3 reservations changed", the gifter's own reservations that need their
 *   confirmation (`useChangedReservations`, the Booked page's count), to
 *   Reserved. Only the gifter ever sees this count;
 * - "2 proposals to review on Anna's 30th", for each of your own lists with
 *   proposals waiting (`proposalCount`, which only an owner's lists carry), to
 *   the list's Proposals. A count, never who proposed;
 * - the currency prompt (`useCurrencyOffer`), whenever it would show.
 *
 * `ownLists` is your own active lists, as the page shows them; `null` while
 * they're read or when they couldn't be, which only leaves the proposals out.
 */
export default function NeedsYou({ ownLists }: { ownLists: WishlistSummary[] | null }) {
  const headingId = useId();
  const { invites, busy, respond } = usePendingInvites();
  const changed = useChangedReservations();
  const currency = useCurrencyOffer();

  const rows: Row[] = [];
  for (const invite of invites) {
    rows.push({
      key: `invite-${invite._id}`,
      kind: 'invite',
      node: (
        <InviteCard
          invite={invite}
          busy={busy(invite._id)}
          onAccept={() => respond(invite, 'accept')}
          onDecline={() => respond(invite, 'decline')}
        />
      ),
    });
  }
  if (changed) {
    rows.push({
      key: 'reservations',
      kind: 'reservations',
      node: (
        <ActionRow
          icon="alert"
          iconClassName={TONE_CLASSES.warning.tint}
          title={`${plural(changed, 'reservation')} changed`}
          detail={`${changed === 1 ? 'It needs' : 'They need'} your confirmation.`}
          href={RESERVED_PATH}
          action="Review"
          actionLabel="Review changed reservations"
        />
      ),
    });
  }
  for (const list of ownLists ?? []) {
    const proposals = list.proposalCount ?? 0;
    if (list.archived || proposals <= 0) continue;
    rows.push({
      key: `proposals-${list._id}`,
      kind: 'proposals',
      node: (
        <ActionRow
          icon="inbox"
          iconClassName="bg-primary-500/12 text-accent"
          title={`${plural(proposals, 'proposal')} to review`}
          detail={`On ${list.name}`}
          href={`/wishlists/${list.slug ?? list._id}?${LIST_CHIP_PARAM}=proposals`}
          action="Review"
          actionLabel={`Review proposals on ${list.name}`}
        />
      ),
    });
  }
  if (currency) {
    rows.push({ key: 'currency', kind: 'currency', node: <CurrencyPrompt offer={currency} /> });
  }

  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={headingId}>
      <div className="mb-4 flex items-baseline justify-between gap-3 px-1">
        <h2 id={headingId} className="text-xl font-semibold tracking-tight text-foreground">
          Needs you
        </h2>
        <Link
          href={ACTIVITY_PATH}
          className="whitespace-nowrap text-sm font-medium text-accent hover:underline"
        >
          See all in Activity
        </Link>
      </div>
      <ul className="space-y-3">
        {pickRows(rows, NEEDS_YOU_LIMIT).map((row) => (
          <li key={row.key}>{row.node}</li>
        ))}
      </ul>
    </section>
  );
}

/** A row of Needs you that takes you somewhere: what it's about, then its one action. */
function ActionRow({
  icon,
  iconClassName,
  title,
  detail,
  href,
  action,
  actionLabel,
}: {
  icon: IconName;
  iconClassName: string;
  title: string;
  detail: string;
  href: string;
  /** The link's text, and its fuller name for a screen reader (it starts with the text). */
  action: string;
  actionLabel: string;
}) {
  return (
    <div className={ACTION_CARD_CLASSES}>
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${iconClassName}`}
        >
          <Icon name={icon} size={18} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-body font-semibold text-foreground">{title}</p>
          <p className="truncate text-sm text-muted-foreground">{detail}</p>
        </div>
      </div>
      <Link
        href={href}
        aria-label={actionLabel}
        className={`${buttonClassName({ variant: 'secondary', size: 'sm' })} self-start sm:self-auto`}
      >
        {action}
        <Icon name="arrow-right" size={16} />
      </Link>
    </div>
  );
}
