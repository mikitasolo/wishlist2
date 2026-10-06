'use client';

import { useId } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import ShareButton from '@/components/ShareButton';
import { buttonClassName } from '@/components/buttonStyles';
import type { WishlistSummary } from '@/components/WishlistCard';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import { LIST_TAB_PARAM } from '@/lib/hooks/useListTab';
import {
  birthdaysComingUp,
  comingUp,
  mergeComingUp,
  type FriendBirthday,
} from '@/lib/utils/comingUp';
import { LIST_CHIP_PARAM } from '@/lib/utils/listChips';
import { rowOwnerLabel } from '@/lib/utils/listRows';
import { formatCountdown, formatOccasionDay, occasionKindLabel } from '@/lib/utils/occasion';
import { getVisibility } from '@/lib/utils/visibility';

const listPath = (list: WishlistSummary) => `/wishlists/${list.slug ?? list._id}`;

const CARD =
  'flex w-64 flex-shrink-0 snap-start flex-col rounded-2xl border border-border bg-surface p-4 shadow-sm';

/** A card's first line: "Today · Sat 3 Oct", in the accent today and tomorrow. */
function WhenLine({ days, date, today }: { days: number; date: string; today: string }) {
  const countdown = formatCountdown(days);
  const withYear = date.slice(0, 4) !== today.slice(0, 4);
  return (
    <p
      className={`flex items-center gap-1.5 text-meta font-semibold ${
        days <= 1 ? 'text-accent' : 'text-muted-foreground'
      }`}
    >
      <Icon name="calendar" size={12} className="flex-shrink-0" />
      <time dateTime={date}>
        {countdown[0].toUpperCase() + countdown.slice(1)} · {formatOccasionDay(date, { withYear })}
      </time>
    </p>
  );
}

/**
 * The dashboard's Coming up (D4): a row you scroll sideways of every list,
 * your own and the ones shared with you, whose occasion falls in the next 30
 * days, nearest first (`comingUp`): "Today · Sat 3 Oct", the list's name, then
 * "Birthday · @dmitri_v". A list shared with you offers Find a gift (its
 * available items); one of your own offers Share, and says nothing about
 * reservations, since an owner never learns what has been reserved.
 *
 * Friends' birthdays (WIS-343, `birthdays`: what `GET /api/users/me/birthdays`
 * answered, or none when that read failed) sit among them by day
 * (`mergeComingUp`): the friend's photo and "@anna's birthday", linking to her
 * profile. Each is its own card, about the person only: it never links to,
 * counts or hints at her lists, and a Birthday list of hers you can open is its
 * own card beside it.
 *
 * Worked out from the viewer's local date (`useLocalToday`), so nothing renders
 * in the server render or the one that hydrates it, and nothing when nothing is
 * that close. Archived lists are left out. `own` and `shared` are the lists
 * `GET /api/wishlists` gives the viewer, so every one is a list they can open.
 */
export default function ComingUp({
  own,
  shared,
  birthdays = [],
  viewerId,
}: {
  own: WishlistSummary[];
  shared: WishlistSummary[];
  birthdays?: FriendBirthday[];
  viewerId?: string | null;
}) {
  const today = useLocalToday();
  const router = useRouter();
  const headingId = useId();
  if (!today) return null;
  const cards = mergeComingUp(
    comingUp(own, shared, today),
    birthdaysComingUp(birthdays, today, viewerId)
  );
  if (cards.length === 0) return null;

  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-4 px-1 text-xl font-semibold tracking-tight text-foreground">
        Coming up
      </h2>
      {/* Edge to edge on a phone, so the next card peeks in from the side. */}
      <ul className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:scroll-px-0 sm:px-0">
        {cards.map((card) => {
          if (card.kind === 'birthday') {
            const { person, days, date } = card;
            return (
              <li key={`birthday-${person.id}`} className={CARD}>
                <WhenLine days={days} date={date} today={today} />
                <div className="mt-2 flex min-w-0 items-center gap-2">
                  <Avatar name={person.username} src={person.image} size="sm" />
                  <Link
                    href={`/users/${encodeURIComponent(person.username)}`}
                    className="truncate text-body font-semibold text-foreground transition-colors hover:text-accent"
                  >
                    @{person.username}’s birthday
                  </Link>
                </div>
              </li>
            );
          }
          const { list, own: isOwn, days, date } = card;
          const owner = rowOwnerLabel(list, { shared: !isOwn, viewerId });
          const kind = occasionKindLabel(list.occasion!.kind);
          return (
            <li key={list._id.toString()} className={CARD}>
              <WhenLine days={days} date={date} today={today} />
              <Link
                href={listPath(list)}
                className="mt-2 truncate text-body font-semibold text-foreground transition-colors hover:text-accent"
              >
                {list.name}
              </Link>
              <p className="mt-0.5 truncate text-meta text-muted-foreground">
                {owner ? `${kind} · ${owner}` : kind}
              </p>
              <div className="mt-auto pt-4">
                {isOwn ? (
                  <ShareButton
                    url={listPath(list)}
                    title={list.name}
                    owner={{
                      visibility: getVisibility(list),
                      archived: false,
                      onInvite: () => router.push(`${listPath(list)}?${LIST_TAB_PARAM}=people`),
                    }}
                  />
                ) : (
                  <Link
                    href={`${listPath(list)}?${LIST_CHIP_PARAM}=available`}
                    aria-label={`Find a gift on ${list.name}`}
                    className={buttonClassName({ size: 'sm', shape: 'pill' })}
                  >
                    <Icon name="gift" size={16} />
                    Find a gift
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
