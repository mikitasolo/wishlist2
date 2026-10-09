import type { ReactNode } from 'react';
import Badge from '@/components/Badge';
import Icon, { type IconName } from '@/components/Icon';
import { MOCK_ITEMS, MOCK_RESERVED, MockThumb, mockPrice } from '@/components/MockList';
import { groupGiftHeadline } from '@/components/GroupGiftProgress';
import { coverGradient } from '@/lib/utils/cover';
import { statusMeta } from '@/lib/utils/itemStatus';
import { plural } from '@/lib/utils/plural';
import type { TourIllustrationKind } from '@/lib/utils/tourSteps';

/**
 * The guided walkthrough's pictures (WIS-371): small static drawings of the
 * app, made-up data only (`MockList`, as the landing page's mock), so one tour
 * shows everyone what lists, items, sharing and reserving look like, whether
 * or not they have a list of their own. Purely decorative (`aria-hidden`):
 * the step's text says it all. Never a real control, never a real account's
 * data, and the owner's side never shows a reservation.
 */
export default function TourIllustration({ kind }: { kind: TourIllustrationKind }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none mb-3 select-none rounded-xl border border-border bg-surface-2 p-3"
    >
      {kind === 'list' && <ListCard />}
      {kind === 'item' && <ItemRow />}
      {kind === 'sharing' && <Sharing />}
      {kind === 'friends' && <Friends />}
      {kind === 'reserving' && <Reserving />}
    </div>
  );
}

function ListCard() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div
        className="flex h-10 items-center justify-center text-white/90"
        style={{ background: coverGradient('landing-mock-list') }}
      >
        <Icon name="gift" size={18} />
      </div>
      <div className="px-3 py-2">
        <p className="text-sm font-semibold text-foreground">Maya’s birthday</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name="calendar" size={12} />
          Sat 14 Mar · {plural(MOCK_ITEMS.length, 'item')}
        </p>
      </div>
    </div>
  );
}

function ItemRow() {
  const item = MOCK_ITEMS[2];
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
      <MockThumb name={item.name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{item.name}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {mockPrice(item.cents)}
          <Icon name="link" size={12} />
        </p>
      </div>
      <Icon name="star" size={16} className="flex-shrink-0 text-accent" />
    </div>
  );
}

function Sharing() {
  const levels: { icon: IconName; label: string }[] = [
    { icon: 'globe', label: 'Public' },
    { icon: 'users', label: 'Friends' },
    { icon: 'lock', label: 'Invite only' },
  ];
  return (
    <div className="space-y-2">
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {levels.map(({ icon, label }, i) => (
          <span
            key={label}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium whitespace-nowrap ${
              i === 1 ? 'bg-surface text-foreground shadow-xs' : 'text-muted-foreground'
            }`}
          >
            <Icon name={icon} size={12} />
            {label}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted-foreground">
        <Icon name="user-plus" size={12} />
        @anna
      </div>
    </div>
  );
}

/** A made-up search result: a person who follows you, and Follow back. */
function Friends() {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted-foreground">
        <Icon name="search" size={12} />
        @maya
      </div>
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
        <span
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white/90"
          style={{ background: coverGradient('maya') }}
        >
          M
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">@maya</p>
          <p className="text-xs text-muted-foreground">Follows you</p>
        </div>
        <span className="flex-shrink-0 rounded-full bg-primary-600 px-3 py-1 text-xs font-semibold text-white">
          Follow back
        </span>
      </div>
    </div>
  );
}

/** One item, two views: the owner's, with nothing to see, and a friend's, Reserved. */
function Reserving() {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <View caption="Maya sees">
          <span className="text-xs text-muted-foreground">{mockPrice(MOCK_RESERVED.cents)}</span>
        </View>
        <View caption="Friends see">
          <Badge status={statusMeta('booked', 'member')} />
        </View>
      </div>
      <div className="rounded-lg border border-border bg-surface px-3 py-2">
        <p className="text-xs font-medium text-foreground">{groupGiftHeadline(40)}</p>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-2/5 rounded-full bg-success-fill" />
        </div>
      </div>
    </div>
  );
}

function View({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs text-muted-foreground">{caption}</p>
      <div className="flex min-h-14 flex-col gap-1.5 rounded-lg border border-border bg-surface p-2">
        <div className="flex items-center gap-2">
          <MockThumb name={MOCK_RESERVED.name} size="sm" />
          <p className="line-clamp-2 min-w-0 text-xs font-medium text-foreground">
            {MOCK_RESERVED.name}
          </p>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}
