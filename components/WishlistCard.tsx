'use client';

import Link from 'next/link';
import { IWishlist } from '@/models/Wishlist';
import Avatar from '@/components/Avatar';
import Badge from '@/components/Badge';
import IconButton from '@/components/IconButton';
import Cover from '@/components/Cover';
import ReservedByYouChip from '@/components/ReservedByYouChip';
import OccasionLabel, { OCCASION_ON_COVER } from '@/components/OccasionLabel';
import { coverBadge } from '@/lib/utils/visibility';
import { formatOwnerItemSummary } from '@/lib/utils/itemCounts';
import { publicDisplayName } from '@/lib/utils/displayName';
import { rowOwnerLabel } from '@/lib/utils/listRows';

/** A list as the list screens get it from `GET /api/wishlists`: a card's or a row's data. */
export type WishlistSummary = IWishlist & {
  ownerUsername?: string | null;
  ownerImage?: string | null;
  /** Every owner of a co-owned list; the card shows the first plus a count. */
  ownerUsernames?: string[] | null;
  /** The viewer's own relationship to this list (null when they have none). */
  userRole?: 'owner' | 'member' | null;
  /** Published items: the "N items" every screen shows (`lib/utils/itemCounts.ts`). */
  itemCount?: number;
  /** Drafts and proposals to review: only on a list the viewer owns, from `/api/wishlists`. */
  draftCount?: number;
  proposalCount?: number;
  /**
   * Items the viewer has reserved here: only on a list shared with them,
   * from `/api/wishlists`, never on one they own. "N reserved by you".
   */
  reservedByYou?: number;
  archived?: boolean;
  bannerUrl?: string | null;
};

/**
 * Pin to top on a list of your own (`lib/utils/pinnedLists.ts`): whether it's
 * pinned, whether a pin is on its way (the button is held), and the toggle.
 */
export interface PinControl {
  pinned: boolean;
  busy: boolean;
  onToggle: () => void;
}

/** The pin button's accessible name, the same pinned or not: `aria-pressed` says which. */
export const PIN_LABEL = 'Pin to top';

/** The pin button's tooltip: what pressing it does. */
export const pinTooltip = (pinned: boolean) => (pinned ? 'Unpin' : PIN_LABEL);

interface WishlistCardProps {
  wishlist: WishlistSummary;
  /** Pin to top, on a card of your own active list. Nothing without it. */
  pin?: PinControl;
  showOwner?: boolean;
  /**
   * Text in the owner's place, with no avatar, instead of `showOwner`'s: a
   * profile's "with @chloe_r" on a co-owned list (`profileCoOwnerLabel`),
   * where the profile already says whose lists these are.
   */
  ownerNote?: string | null;
  /**
   * Whether the viewer's role ("Member", "Owner") shows over the cover. Off
   * where the page or section already says it ("Shared with you"), where it
   * would be the same on every card.
   */
  showRole?: boolean;
}

/**
 * How wide a card's cover is drawn, for the browser to pick the banner's size.
 * Every grid of cards is one column on a phone, two from `sm`, three from `lg`
 * and four from `xl`, inside a `max-w-7xl` page, so a card is never wider than
 * about 300px there. Without it next/image assumes the full viewport width,
 * and each card downloaded a banner several times the size it's shown at.
 */
export const WISHLIST_CARD_COVER_SIZES =
  '(max-width: 639px) 100vw, (max-width: 1023px) 50vw, (max-width: 1279px) 33vw, 320px';

export default function WishlistCard({
  wishlist,
  pin,
  showOwner = false,
  ownerNote = null,
  showRole = true,
}: WishlistCardProps) {
  // The primary owner and how many co-owners, named as the list's phone row
  // names them (`rowOwnerLabel`): "@dan_w +1", or "Someone" with no username.
  const ownerName = publicDisplayName({ username: wishlist.ownerUsername });
  const ownerLabel = rowOwnerLabel(wishlist, { shared: true });
  // "N items", plus the drafts and proposals to review on a list you own.
  const itemSummary = formatOwnerItemSummary({
    items: wishlist.itemCount ?? 0,
    drafts: wishlist.draftCount ?? 0,
    proposals: wishlist.proposalCount ?? 0,
  });
  // Archived instead of the visibility on an archived list: it's owner-only.
  const badge = coverBadge(wishlist);

  const card = (
    <Link
      href={`/wishlists/${wishlist.slug ?? wishlist._id}`}
      className={`group flex flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-md transition-all duration-200 hover:shadow-lg ${
        pin ? 'h-full' : ''
      } ${wishlist.archived ? 'opacity-70 hover:opacity-100' : ''}`}
    >
      {/* Cover band */}
      <Cover
        src={wishlist.bannerUrl}
        seed={wishlist._id.toString()}
        sizes={WISHLIST_CARD_COVER_SIZES}
        className={`relative aspect-[16/9] bg-surface-2 ${wishlist.archived ? 'grayscale' : ''}`}
      >
        <Badge
          tone="glass"
          dim={!!wishlist.archived}
          icon={badge.icon}
          className="absolute right-3 top-3"
        >
          {badge.label}
        </Badge>
        {/* The role, where the pin button isn't: that one says whether it's
            pinned, so there's no Pinned badge (WIS-302). */}
        {!wishlist.archived && showRole && wishlist.userRole && !pin ? (
          <Badge tone="glass" className="absolute left-3 top-3 capitalize">
            {wishlist.userRole}
          </Badge>
        ) : null}
        {/* The list's occasion and its countdown, in the viewer's local date.
            Over the cover, so a card with one is the same size as one without.
            Only mounted for a list with one, as each label watches the clock. */}
        {wishlist.occasion ? (
          <OccasionLabel
            occasion={wishlist.occasion}
            className={`absolute bottom-3 left-3 ${OCCASION_ON_COVER}`}
          />
        ) : null}
      </Cover>

      {/* Body */}
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <h3 className="truncate text-title font-semibold text-foreground transition-colors group-hover:text-accent">
          {wishlist.name}
        </h3>
        {wishlist.description ? (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{wishlist.description}</p>
        ) : null}
        <ReservedByYouChip count={wishlist.reservedByYou} className="mt-2 self-start" />

        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          {ownerNote ? (
            <span className="truncate text-meta text-muted-foreground">{ownerNote}</span>
          ) : showOwner ? (
            <span className="flex min-w-0 items-center gap-2">
              <Avatar name={ownerName} src={wishlist.ownerImage} size="sm" />
              <span className="truncate text-meta text-muted-foreground">{ownerLabel}</span>
            </span>
          ) : (
            <span />
          )}
          <span className="flex-shrink-0 text-meta text-muted-foreground">{itemSummary}</span>
        </div>
      </div>
    </Link>
  );
  if (!pin) return card;

  // The pin is a button, so it can't be inside the card's link: it sits over
  // the cover's top-left corner, where a role badge would be (the section is
  // your own lists, so it would only say Owner).
  return (
    <div className="relative">
      {card}
      <PinButton pin={pin} className="absolute left-3 top-3" />
    </div>
  );
}

/**
 * Pin to top as a round frosted icon button, over a cover (a card's) or at the
 * end of a row (a phone's): the one sign that a list is pinned (WIS-302). A
 * toggle button, so its name stays Pin to top and `aria-pressed` says whether
 * it's pinned (a name that flipped to Unpin would read "Unpin, pressed"); the
 * pin is filled in while it's pinned, and the tooltip says what pressing it
 * does, Pin to top or Unpin.
 */
export function PinButton({ pin, className = '' }: { pin: PinControl; className?: string }) {
  return (
    <IconButton
      icon="pin"
      label={PIN_LABEL}
      title={pinTooltip(pin.pinned)}
      aria-pressed={pin.pinned}
      variant="glass"
      shape="pill"
      onClick={pin.onToggle}
      disabled={pin.busy}
      iconClassName={pin.pinned ? 'fill-current text-accent' : undefined}
      className={className}
    />
  );
}
