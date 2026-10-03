'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { badgeClassName } from '@/components/Badge';
import Cover from '@/components/Cover';
import Icon from '@/components/Icon';
import OccasionLabel from '@/components/OccasionLabel';
import ReservedByYouChip from '@/components/ReservedByYouChip';
import WishlistCard, { type WishlistSummary } from '@/components/WishlistCard';
import { SM_UP_QUERY, useMediaQuery } from '@/lib/hooks/useMediaQuery';
import { rowMeta } from '@/lib/utils/listRows';
import { WISHLIST_GRID_CLASSES, WISHLIST_ROWS_CLASSES } from '@/components/Skeleton';

/**
 * A section's lists, as the list screens show them (the dashboard's sections,
 * Your wishlists, Shared with you): a card grid from `sm` up, and below it
 * compact rows (`WishlistRow`), so a phone shows a dozen lists in a screen or
 * two instead of one 16:9 card per screen.
 *
 * Both are in the server's HTML, each hidden by CSS at the other's widths
 * (`sm:hidden` / `max-sm:hidden`), so the first paint is right at every width
 * and hydration never disagrees. Once the width is known (`useMediaQuery`), the
 * one CSS hides is dropped from the DOM. Hidden, it's `display: none`, so it's
 * never focusable or read out either way.
 */
export default function WishlistList({
  wishlists,
  shared = false,
  viewerUsername,
}: {
  wishlists: WishlistSummary[];
  /**
   * Lists shared with you: the owner is named on every row and card, with how
   * many you've reserved there, and no Member badge (the section says so).
   */
  shared?: boolean;
  /** The viewer's username, so a row of a co-owned list of theirs names the others. */
  viewerUsername?: string | null;
}) {
  // true from `sm` up, false below it, null until known (the server render and
  // the one that hydrates it), when both are rendered and CSS picks.
  const smUp = useMediaQuery(SM_UP_QUERY);
  return (
    <div>
      {smUp !== true && (
        <ul data-wishlist-rows className={`${WISHLIST_ROWS_CLASSES} sm:hidden`}>
          {wishlists.map((w) => (
            <li key={w._id.toString()}>
              <WishlistRow
                wishlist={w}
                meta={rowMeta(w, { shared, viewerUsername })}
                shared={shared}
              />
            </li>
          ))}
        </ul>
      )}
      {smUp !== false && (
        <div data-wishlist-cards className={`${WISHLIST_GRID_CLASSES} max-sm:hidden`}>
          {wishlists.map((w) => (
            <WishlistCard
              key={w._id.toString()}
              wishlist={w}
              showOwner={shared}
              showRole={!shared}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A list as one compact row, about 72px tall, that links to it: a 56px square
 * of its cover, its name, then its meta line ("@owner · 9 items", see
 * `rowMeta`) and its occasion. The occasion counts down from the viewer's
 * local date (`OccasionLabel`), and a yearly one never shows its stored year.
 * The meta line and the occasion share a line, and the occasion goes under it
 * when both don't fit. On a list shared with you, "N reserved by you" follows
 * (`ReservedByYouChip`, nothing at 0); your own list's row says nothing about
 * reservations. An archived list's row is greyed, as its card is.
 */
export function WishlistRow({
  wishlist,
  meta,
  shared = false,
}: {
  wishlist: WishlistSummary;
  meta: string;
  /** A list shared with you, which may carry your own reservations' count. */
  shared?: boolean;
}) {
  return (
    <Link
      href={`/wishlists/${wishlist.slug ?? wishlist._id}`}
      className={`group flex min-h-[4.5rem] items-center gap-3 px-3 py-2 outline-offset-[-2px] transition-colors hover:bg-surface-2 ${
        wishlist.archived ? 'opacity-70 hover:opacity-100' : ''
      }`}
    >
      <Cover
        src={wishlist.bannerUrl}
        seed={wishlist._id.toString()}
        sizes="56px"
        className={`relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-surface-2 ${
          wishlist.archived ? 'grayscale' : ''
        }`}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-semibold text-foreground transition-colors group-hover:text-accent">
          {wishlist.name}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-meta text-muted-foreground">{meta}</span>
          {/* Only mounted for a list with one, as each label watches the clock. */}
          {wishlist.occasion ? (
            <OccasionLabel
              occasion={wishlist.occasion}
              className={badgeClassName({ tone: 'neutral', size: 'sm' })}
            />
          ) : null}
          {shared ? <ReservedByYouChip count={wishlist.reservedByYou} size="sm" /> : null}
        </span>
      </span>
    </Link>
  );
}

/**
 * Your archived lists, folded away at the end of a page (the dashboard, Your
 * wishlists): one "Archived (n)" row that opens them, closed to begin with.
 * A disclosure (`aria-expanded`) inside the section's heading, so the heading
 * is still there to jump to. Open, it shows them as every section does: rows
 * on a phone, cards from `sm` up. Only owners have archived lists, and only
 * their own pages pass any; nothing renders without one.
 */
export function ArchivedLists({
  wishlists,
  viewerUsername,
}: {
  wishlists: WishlistSummary[];
  viewerUsername?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  if (wishlists.length === 0) return null;
  return (
    <section>
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-left shadow-sm transition-colors hover:bg-surface-2"
        >
          <Icon name="archive" size={18} className="flex-shrink-0 text-muted-foreground" />
          <span className="flex-1 text-body font-semibold text-foreground">
            Archived ({wishlists.length})
          </span>
          <Icon
            name="chevron-down"
            size={18}
            className={`flex-shrink-0 text-muted-foreground transition-transform ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>
      </h2>
      <div id={regionId}>
        {open && (
          <div className="mt-5">
            <WishlistList wishlists={wishlists} viewerUsername={viewerUsername} />
          </div>
        )}
      </div>
    </section>
  );
}
