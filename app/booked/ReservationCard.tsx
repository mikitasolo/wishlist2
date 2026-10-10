import { useId } from 'react';
import Icon from '@/components/Icon';
import Menu from '@/components/Menu';
import Button from '@/components/Button';
import SnapshotThumb from '@/components/SnapshotThumb';
import GivenMoment from '@/components/GivenMoment';
import ReservedGroupGift from '@/components/ReservedGroupGift';
import { buttonClassName, iconButtonClassName } from '@/components/buttonStyles';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';
import { isHttpUrl } from '@/lib/utils/itemFields';
import { itemDeepLink } from '@/lib/utils/itemDeepLink';
import ListName from './ListName';
import ReservationPrice from './ReservationPrice';
import type { Reservation } from './types';

/** The "More actions" square beside a card's buttons, as on an item card. */
const MENU_TRIGGER = `${iconButtonClassName({ variant: 'secondary', size: 'sm' })} aria-expanded:bg-muted aria-expanded:text-foreground`;

/**
 * A gift still to give: Open link ↗ to the shop (the primary, when the item
 * has a link), Mark as given, and a menu with View on list (straight to the
 * item: `?item=`) and Release. The item's notes ("size M, blue") are under
 * its name. The list's name is left out under a dated group's heading, which
 * names it already.
 *
 * A group gift's card (WIS-363) shows the viewer's own share in place of the
 * price, then the gift's progress and everyone in it. Its organizer's Mark as
 * given gives the whole gift; anyone else's card has none (the organizer gives
 * it for everyone). Leave group gift stands in for Release, which a group
 * gift's item refuses; cancelling or converting it is on the list's item sheet
 * (View on list).
 */
export default function ReservationCard({
  r,
  busy,
  given,
  showList,
  viewerCurrency,
  rates,
  onGift,
  onRelease,
  onGiveGroupGift,
  onLeaveGroupGift,
}: {
  r: Reservation;
  busy: boolean;
  /** Playing the Mark as given moment, just before it leaves (WIS-407). */
  given: boolean;
  showList: boolean;
  viewerCurrency: string;
  rates: Record<string, number> | null;
  onGift: () => void;
  onRelease: () => void;
  onGiveGroupGift: () => void;
  onLeaveGroupGift: () => void;
}) {
  const nameId = useId();
  const locale = useViewerLocale();
  const gift = r.groupGift ?? null;
  // A contributor who isn't the organizer has no Mark as given of their own.
  const canGive = !gift || gift.organizer;
  // The API only sends an http(s) link; checked again, since it's an href.
  const link = r.itemLink && isHttpUrl(r.itemLink) ? r.itemLink : null;
  return (
    <article
      aria-labelledby={nameId}
      className="relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
      data-motion={given ? 'given' : undefined}
    >
      {given && <GivenMoment />}
      <div className="flex flex-1 gap-3 p-3">
        <SnapshotThumb src={r.itemImage} alt={r.itemName} seed={r._id} />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <p id={nameId} className="w-full truncate text-body font-semibold text-foreground">
            {r.itemName}
          </p>
          {r.pledge ? (
            <span className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-sm text-muted-foreground">Your share</span>
              <ReservationPrice price={r.pledge} viewerCurrency={viewerCurrency} rates={rates} />
            </span>
          ) : (
            r.itemPrice && (
              <ReservationPrice price={r.itemPrice} viewerCurrency={viewerCurrency} rates={rates} />
            )
          )}
          {showList && <ListName r={r} />}
          {r.itemNotes && (
            <p
              className="line-clamp-2 w-full text-xs whitespace-pre-line text-muted-foreground"
              title={r.itemNotes}
            >
              {r.itemNotes}
            </p>
          )}
          {gift && <ReservedGroupGift gift={gift} locale={locale} />}
        </div>
      </div>
      <div className="flex gap-2 border-t border-border p-3">
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonClassName({ size: 'sm' })} flex-1 whitespace-nowrap sm:flex-none`}
          >
            Open link
            <Icon name="external-link" size={16} />
          </a>
        )}
        {/* One row at every width: beside Open link it keeps its own width,
            and drops its check below `sm`, so both fit on one line at 360. */}
        {canGive && (
          <Button
            size="sm"
            icon={link ? undefined : 'check'}
            variant={link ? 'secondary' : 'primary'}
            disabled={busy}
            onClick={gift ? onGiveGroupGift : onGift}
            className={`whitespace-nowrap ${link ? '' : 'flex-1 sm:flex-none'}`}
          >
            {link && <Icon name="check" size={16} className="max-sm:hidden" />}
            Mark as given
          </Button>
        )}
        {/* With no link to fill the row, say who gives it instead. */}
        {!canGive && !link && (
          <p className="flex min-w-0 flex-1 items-center text-meta text-muted-foreground">
            The organizer marks it as given
          </p>
        )}
        <Menu
          label="More actions"
          icon="more"
          className="relative ml-auto flex"
          triggerClassName={MENU_TRIGGER}
          items={[
            {
              label: 'View on list',
              icon: 'arrow-right',
              href: itemDeepLink(r.wishlistSlug ?? r.wishlistId, r.itemId),
            },
            gift
              ? {
                  label: 'Leave group gift',
                  icon: 'undo',
                  onSelect: onLeaveGroupGift,
                  disabled: busy,
                }
              : { label: 'Release', icon: 'undo', onSelect: onRelease, disabled: busy },
          ]}
        />
      </div>
    </article>
  );
}
