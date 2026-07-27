'use client';

import Link from 'next/link';
import { IWishlist } from '@/models/Wishlist';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import BannerImage from '@/components/BannerImage';
import { coverGradient } from '@/lib/utils/cover';
import { getVisibility, visibilityMeta } from '@/lib/utils/visibility';

interface WishlistCardProps {
  wishlist: IWishlist & {
    ownerUsername?: string | null;
    ownerImage?: string | null;
    /** Every owner of a co-owned list; the card shows the first plus a count. */
    ownerUsernames?: string[] | null;
    /** The viewer's own relationship to this list (null when they have none). */
    userRole?: 'owner' | 'member' | null;
    itemCount?: number;
    archived?: boolean;
    bannerUrl?: string | null;
  };
  showOwner?: boolean;
}

export default function WishlistCard({ wishlist, showOwner = false }: WishlistCardProps) {
  const ownerName = wishlist.ownerUsername || 'unknown';
  const coOwnerCount = Math.max(0, (wishlist.ownerUsernames?.length ?? 1) - 1);
  const itemCount = wishlist.itemCount ?? 0;
  const vis = visibilityMeta[getVisibility(wishlist)];

  return (
    <Link
      href={`/wishlists/${wishlist.slug ?? wishlist._id}`}
      className={`group flex flex-col overflow-hidden rounded-3xl border border-border bg-surface shadow-md transition-all duration-200 hover:shadow-lg ${
        wishlist.archived ? 'opacity-70 hover:opacity-100' : ''
      }`}
    >
      {/* Cover band */}
      <div
        className={`relative aspect-[16/9] bg-surface-2 ${wishlist.archived ? 'grayscale' : ''}`}
        style={{
          background: wishlist.bannerUrl ? undefined : coverGradient(wishlist._id.toString()),
        }}
      >
        {wishlist.bannerUrl && <BannerImage src={wishlist.bannerUrl} alt="" />}
        <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/20 px-2.5 py-1 text-[11.5px] font-semibold text-white backdrop-blur-md">
          <Icon name={vis.icon} size={12} />
          {vis.label}
        </span>
        {wishlist.archived ? (
          <span className="absolute left-3 top-3 inline-flex items-center rounded-full border border-white/25 bg-black/30 px-2.5 py-1 text-[11.5px] font-semibold text-white backdrop-blur-md">
            Archived
          </span>
        ) : wishlist.featured ? (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full border border-white/25 bg-white/20 px-2.5 py-1 text-[11.5px] font-semibold text-white backdrop-blur-md">
            <Icon name="sparkles" size={12} />
            Featured
          </span>
        ) : wishlist.userRole ? (
          <span className="absolute left-3 top-3 inline-flex items-center rounded-full border border-white/25 bg-white/20 px-2.5 py-1 text-[11.5px] font-semibold capitalize text-white backdrop-blur-md">
            {wishlist.userRole}
          </span>
        ) : null}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <h3 className="truncate text-[17px] font-semibold text-foreground transition-colors group-hover:text-accent dark:group-hover:text-primary-300">
          {wishlist.name}
        </h3>
        {wishlist.description ? (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{wishlist.description}</p>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          {showOwner ? (
            <span className="flex min-w-0 items-center gap-2">
              <Avatar name={ownerName} src={wishlist.ownerImage} size="sm" />
              <span className="truncate text-[13px] text-muted-foreground">
                @{ownerName}
                {coOwnerCount > 0 && ` +${coOwnerCount}`}
              </span>
            </span>
          ) : (
            <span />
          )}
          <span className="flex-shrink-0 text-[13px] text-muted-foreground">
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </span>
        </div>
      </div>
    </Link>
  );
}
