'use client';

import Link from 'next/link';
import { IWishlist } from '@/models/Wishlist';
import Avatar from '@/components/Avatar';
import Badge from '@/components/Badge';
import Cover from '@/components/Cover';
import ReservedByYouChip from '@/components/ReservedByYouChip';
import OccasionLabel, { OCCASION_ON_COVER } from '@/components/OccasionLabel';
import { coverBadge } from '@/lib/utils/visibility';
import { formatOwnerItemSummary } from '@/lib/utils/itemCounts';

interface WishlistCardProps {
  wishlist: IWishlist & {
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
  showOwner?: boolean;
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
  showOwner = false,
  showRole = true,
}: WishlistCardProps) {
  const ownerName = wishlist.ownerUsername || 'unknown';
  const coOwnerCount = Math.max(0, (wishlist.ownerUsernames?.length ?? 1) - 1);
  // "N items", plus the drafts and proposals to review on a list you own.
  const itemSummary = formatOwnerItemSummary({
    items: wishlist.itemCount ?? 0,
    drafts: wishlist.draftCount ?? 0,
    proposals: wishlist.proposalCount ?? 0,
  });
  // Archived instead of the visibility on an archived list: it's owner-only.
  const badge = coverBadge(wishlist);

  return (
    <Link
      href={`/wishlists/${wishlist.slug ?? wishlist._id}`}
      className={`group flex flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-md transition-all duration-200 hover:shadow-lg ${
        wishlist.archived ? 'opacity-70 hover:opacity-100' : ''
      }`}
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
        {wishlist.archived ? null : wishlist.featured ? (
          <Badge tone="glass" icon="sparkles" className="absolute left-3 top-3">
            Featured
          </Badge>
        ) : showRole && wishlist.userRole ? (
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
          {showOwner ? (
            <span className="flex min-w-0 items-center gap-2">
              <Avatar name={ownerName} src={wishlist.ownerImage} size="sm" />
              <span className="truncate text-meta text-muted-foreground">
                @{ownerName}
                {coOwnerCount > 0 && ` +${coOwnerCount}`}
              </span>
            </span>
          ) : (
            <span />
          )}
          <span className="flex-shrink-0 text-meta text-muted-foreground">{itemSummary}</span>
        </div>
      </div>
    </Link>
  );
}
