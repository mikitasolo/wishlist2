'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { badgeClassName } from '@/components/Badge';
import Cover, { CoverMonogram } from '@/components/Cover';
import Icon from '@/components/Icon';
import OccasionLabel from '@/components/OccasionLabel';
import ReservedByYouChip from '@/components/ReservedByYouChip';
import WishlistCard, {
  PinButton,
  type PinControl,
  type WishlistSummary,
} from '@/components/WishlistCard';
import { SM_UP_QUERY, useMediaQuery } from '@/lib/hooks/useMediaQuery';
import { rowMeta } from '@/lib/utils/listRows';
import { getVisibility, visibilityMeta } from '@/lib/utils/visibility';
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
  viewerId,
  pins,
}: {
  wishlists: WishlistSummary[];
  /**
   * Lists shared with you: the owner is named on every row and card, with how
   * many you've reserved there, and no Member badge (the section says so).
   */
  shared?: boolean;
  /** The viewer's user id, so a row of a co-owned list of theirs names the others. */
  viewerId?: string | null;
  /**
   * Pin to top on each of these lists that isn't archived (`usePinToTop`):
   * your own lists only, never a shared one. `pinning` is the list whose pin is
   * on its way, which holds every list's pin button.
   */
  pins?: { pinning: string | null; onToggle: (wishlist: WishlistSummary) => void };
}) {
  const pinFor = (w: WishlistSummary): PinControl | undefined =>
    pins && !shared && !w.archived
      ? { pinned: !!w.featured, busy: pins.pinning !== null, onToggle: () => pins.onToggle(w) }
      : undefined;
  // true from `sm` up, false below it, null until known (the server render and
  // the one that hydrates it), when both are rendered and CSS picks.
  const smUp = useMediaQuery(SM_UP_QUERY);
  return (
    <div>
      {smUp !== true && (
        <ul data-wishlist-rows className={`${WISHLIST_ROWS_CLASSES} sm:hidden`}>
          {wishlists.map((w) => (
            <li key={w._id.toString()}>
              <WishlistRow wishlist={w} shared={shared} viewerId={viewerId} pin={pinFor(w)} />
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
              pin={pinFor(w)}
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
 * A list as one compact row that links to it: a 56px square of its cover, its
 * name, then its meta line ("@owner · 9 items", see `rowMeta`) and its
 * occasion. 72px tall when they fit on one line under the name, as the row's
 * skeleton is; the occasion (and a chip) wraps under the meta line when they
 * don't, rather than cutting the count off. The occasion counts down from the
 * viewer's local date (`OccasionLabel`), and a yearly one never shows its
 * stored year. Your own list's row shows its visibility as an icon beside the
 * name (an archived one is greyed instead, as its card is) and says nothing
 * about reservations; on a list shared with you, "N reserved by you" follows
 * (`ReservedByYouChip`, nothing at 0). With `pin`, Pin to top follows the
 * row's link, at its end.
 */
export function WishlistRow({
  wishlist,
  shared = false,
  viewerId,
  pin,
}: {
  wishlist: WishlistSummary;
  /** A list shared with you: its owner is named, with your own reservations' count. */
  shared?: boolean;
  /** The viewer's user id, so a co-owned list of theirs names the other owners. */
  viewerId?: string | null;
  /** Pin to top, on a row of your own active list. */
  pin?: PinControl;
}) {
  const meta = rowMeta(wishlist, { shared, viewerId });
  const visibility = shared || wishlist.archived ? null : visibilityMeta[getVisibility(wishlist)];
  const row = (
    <Link
      href={`/wishlists/${wishlist.slug ?? wishlist._id}`}
      className={`group flex min-h-[4.5rem] min-w-0 flex-1 items-center gap-3 px-3 py-2 outline-offset-[-2px] transition-colors hover:bg-surface-2 ${
        wishlist.archived ? 'opacity-70 hover:opacity-100' : ''
      }`}
    >
      <Cover
        src={wishlist.bannerUrl}
        seed={wishlist._id.toString()}
        name={wishlist.name}
        occasionKind={wishlist.occasion?.kind}
        placeholder={<CoverMonogram name={wishlist.name} className="text-lg" />}
        sizes="56px"
        className={`relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-surface-2 ${
          wishlist.archived ? 'grayscale' : ''
        }`}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-body font-semibold text-foreground transition-colors group-hover:text-accent">
            {wishlist.name}
          </span>
          {visibility ? (
            <span title={visibility.label} className="flex-shrink-0 text-muted-foreground">
              <Icon name={visibility.icon} size={16} />
              <span className="sr-only">, {visibility.label}</span>
            </span>
          ) : null}
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
  if (!pin) return row;
  // A button can't be inside the row's link: it follows it.
  return (
    <div className="flex items-center">
      {row}
      <PinButton pin={pin} className="mx-2" />
    </div>
  );
}

/**
 * Your archived lists, folded away at the end of a page (the dashboard, Your
 * wishlists): one "Archived (n)" row that opens them, closed to begin with.
 * A disclosure (`aria-expanded`) inside the section's heading, so the heading
 * is still there to jump to. Open, it shows them as every section does: rows
 * on a phone, cards from `sm` up. Only owners have archived lists, and only
 * their own pages pass any; nothing renders without one. A page with nothing
 * else of yours to show (every list you own is archived) opens it to begin
 * with (`defaultOpen`), so it isn't one closed row on an otherwise empty page.
 */
export function ArchivedLists({
  wishlists,
  viewerId,
  defaultOpen = false,
}: {
  wishlists: WishlistSummary[];
  viewerId?: string | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
            <WishlistList wishlists={wishlists} viewerId={viewerId} />
          </div>
        )}
      </div>
    </section>
  );
}
