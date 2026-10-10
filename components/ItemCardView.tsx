import type { ReactNode } from 'react';
import Badge from '@/components/Badge';
import Cover from '@/components/Cover';
import Icon from '@/components/Icon';
import { coverInitial } from '@/lib/utils/cover';
import { itemAnchorId } from '@/lib/utils/itemDeepLink';
import type { statusMeta } from '@/lib/utils/itemStatus';

interface ItemCardViewProps {
  item: {
    _id: string;
    name: string;
    imageUrl?: string | null;
    notes?: string | null;
    mostWanted?: boolean;
  };
  /** From `statusMeta`, so an owner never gets a booking badge. */
  status: ReturnType<typeof statusMeta>;
  /** Replaces the status badge (a link to Reserved on your own reservation). */
  statusBadge?: ReactNode;
  /**
   * Makes the cover open the item's details, like the body does. A pointer
   * target only: it's out of the Tab order and hidden from assistive tech,
   * since the title is the card's one named way in.
   */
  onCoverClick?: () => void;
  /** The item's name, as a button or link whose `::after` stretches over the body. */
  title: ReactNode;
  /** Formatted price, and the original it was converted from. */
  priceText?: string | null;
  originalPriceText?: string | null;
  /** Faded: an item nobody can act on any more. */
  dimmed?: boolean;
  /** Outlined: the item a link to it pointed at. */
  highlighted?: boolean;
  /** Under the body, above the "Goes with" chips: a member's group gift progress (WIS-362). */
  groupGift?: ReactNode;
  /** Under the body, above the actions: the "Goes with" chips (WIS-29). */
  related?: ReactNode;
  /** The row under the body (one line of actions, or the list's name). */
  actions?: ReactNode;
  /**
   * The title's `::after` stretches over the whole card, cover included, not
   * just the body (the All items page, where the card is one link). Whatever
   * else is clickable in `actions` then needs `relative`.
   */
  titleCoversCard?: boolean;
  /** Anything else that belongs to the card (its sheet, its dialogs). */
  children?: ReactNode;
}

/**
 * The look of an item card, shared by the list page's `WishlistItem` and the
 * All items page: the cover with its badges (Most wanted, then the status from
 * the status map), the name, the price and a line of notes. What's clickable,
 * and the row of actions under it, is the caller's.
 */
export default function ItemCardView({
  item,
  status,
  statusBadge,
  onCoverClick,
  title,
  priceText,
  originalPriceText,
  dimmed,
  highlighted,
  groupGift,
  related,
  actions,
  titleCoversCard,
  children,
}: ItemCardViewProps) {
  return (
    <div
      id={itemAnchorId(item._id)}
      className={`relative flex min-w-0 scroll-mt-24 flex-col rounded-3xl border bg-surface p-3 shadow-md transition-opacity sm:p-5 ${status.classes.card} ${
        highlighted
          ? 'ring-2 ring-ring ring-offset-2 ring-offset-background'
          : dimmed
            ? 'opacity-60 focus-within:opacity-100 hover:opacity-100'
            : ''
      }`}
      role="article"
      aria-label={`Item: ${item.name}`}
      data-status={status.status}
      data-dimmed={(dimmed && !highlighted) || undefined}
      data-highlighted={highlighted || undefined}
    >
      {/* The cover and what sits on it. From `sm` up, the badges overhang its
          top right corner, as they always have. On the narrow card below it
          they sit inside it, so they never run into the card's corner (the
          status first, then Most wanted as just its star). */}
      <div className="relative mb-3 flex-shrink-0 sm:mb-4">
        <div className="absolute right-1.5 top-1.5 z-10 flex flex-col items-end gap-1 sm:-right-2 sm:-top-2 sm:gap-2">
          {item.mostWanted && (
            <Badge className="shadow-sm max-sm:px-1.5">
              <Icon name="star" size={12} className="fill-star text-star-edge" />
              <span className="max-sm:sr-only">Most wanted</span>
            </Badge>
          )}
          {status.badge &&
            (statusBadge ?? <Badge status={status} className="shadow-sm max-sm:order-first" />)}
        </div>

        {/* The gradient shows through when there's no image (or it fails to
            load), with the item's initial on it below `sm`, where an item with
            no image at all gets a shorter, 4:3 frame. */}
        <Cover
          src={item.imageUrl}
          seed={item._id}
          name={item.name}
          alt={item.name}
          sizes="(max-width: 1200px) 50vw, 33vw"
          placeholder={
            <span className="text-4xl font-semibold text-white/90 [text-shadow:0_1px_3px_rgba(0,0,0,0.25)] sm:hidden">
              {coverInitial(item.name)}
            </span>
          }
          className={`relative block w-full overflow-hidden rounded-2xl bg-surface-2 ${
            item.imageUrl ? 'aspect-square' : 'aspect-[4/3] sm:aspect-square'
          } ${onCoverClick ? 'transition-opacity duration-200 hover:opacity-90' : ''}`}
        >
          {onCoverClick && (
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={onCoverClick}
              className="absolute inset-0 cursor-pointer"
            />
          )}
        </Cover>
      </div>

      <div className="flex flex-col flex-grow">
        {/* The card's body (its name, price and notes): the name's `::after`
            stretches over the rest of it. */}
        <div className={`flex flex-grow flex-col ${titleCoversCard ? '' : 'relative'}`}>
          {/* Top-down flow with fixed slots (WIS-398): a two-line title slot,
              then the price, then the notes, so cards in one grid row line up
              whatever their content; the spare height goes below the notes,
              above the chips and the pinned action row. */}
          <h3 className="mb-1.5 min-h-[2lh] text-body font-semibold text-foreground sm:mb-3 sm:text-title">
            {title}
          </h3>

          <div className="mb-2 flex min-h-[28px] min-w-0 flex-col justify-start sm:mb-3 sm:min-h-[32px]">
            {priceText && (
              <p className="truncate text-lg font-semibold text-foreground sm:text-xl">
                {priceText}
              </p>
            )}
            {originalPriceText && (
              <p className="truncate text-xs text-muted-foreground">{originalPriceText}</p>
            )}
          </div>

          {/* A line of the notes; the sheet has them all. */}
          {item.notes && (
            <p className="mb-2 line-clamp-1 break-words text-meta text-muted-foreground sm:mb-3">
              {item.notes}
            </p>
          )}
        </div>

        {/* Outside the body, so its chips aren't under the title's ::after. */}
        {groupGift && <div className="mb-2 sm:mb-3">{groupGift}</div>}
        {related && <div className="mb-2 sm:mb-3">{related}</div>}

        {actions}
      </div>

      {children}
    </div>
  );
}
