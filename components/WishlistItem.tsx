'use client';

import { memo, useMemo, useCallback, useState, useEffect } from 'react';
import { ApiItem } from '@/types/api';
import { useSession } from 'next-auth/react';
import { itemAnchorId } from '@/lib/utils/itemDeepLink';
import { convertedPrice, formatApproxPrice, formatPrice } from '@/lib/utils/currency';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';
import Icon, { type IconName } from '@/components/Icon';
import Link from 'next/link';
import { RESERVED_PATH } from '@/lib/utils/reserveToast';
import Badge from '@/components/Badge';
import Cover from '@/components/Cover';
import ConfirmDialog from '@/components/ConfirmDialog';
import Menu, { type MenuItem } from '@/components/Menu';
import { statusMeta } from '@/lib/utils/itemStatus';
import { TONE_CLASSES } from '@/lib/utils/statusTones';
import IconButton from '@/components/IconButton';
import { iconButtonClassName } from '@/components/buttonStyles';
import { coverInitial } from '@/lib/utils/cover';
import {
  cardMenuActions,
  linkSlot,
  savesAsPrimary,
  type CardActionContext,
} from '@/lib/utils/itemCardActions';
import { SM_UP_QUERY, useMediaQuery } from '@/lib/hooks/useMediaQuery';

// The card's actions are one row, the same height on every card: one labelled
// primary action, then the product link as a square icon button (unless the
// link is the primary), then a "More actions" menu with the rest.
//
// Below `sm` the grid has two columns, and the row is just [primary] [⋯]: the
// link square folds into the menu as "Open product page". CSS does it on the
// first paint (the square is `max-sm:hidden`, and a menu that holds only the
// link is `sm:hidden`), so the server's HTML is right at every width and
// hydration never disagrees with it. Once the width is known (`useMediaQuery`),
// what CSS hides is dropped from the DOM, and the menu, whose items are only
// rendered while it's open, offers the link below `sm` only. Nothing hidden is
// ever focusable: `display: none` takes it out of the tab order and the
// accessibility tree.
const ROW_CONTROL = 'h-10 rounded-xl text-sm font-semibold';

const PRIMARY_BASE = `${ROW_CONTROL} inline-flex min-w-0 flex-1 items-center justify-center @container gap-1 px-1.5 sm:gap-1.5 sm:px-3 transition-all duration-200 cursor-pointer active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:active:scale-100`;

// The primary's icon gives way to its label where the button is too narrow
// for both (a two-column card on a phone narrower than about 390px): the
// button is a size container, so this follows its own width.
const PRIMARY_ICON = 'flex-shrink-0 @max-[5.25rem]:hidden';

const PRIMARY_TONES = {
  // Reserve: the success fill of the "Reserved by you" badge.
  book: 'bg-success-fill text-white shadow-sm hover:bg-success-fill-hover',
  // Publishing, reviewing, opening the product page.
  primary: 'bg-primary-600 text-white shadow-sm hover:bg-primary-500',
  // Editing: always there for an owner, so it doesn't shout.
  soft: 'bg-primary-500/12 text-accent hover:bg-primary-500/18',
  // Undoing your own booking.
  neutral: 'bg-muted text-foreground hover:bg-surface-2',
  // A gift you've given: done, in the success tone of your booking.
  given: TONE_CLASSES.success.tint,
  // Reserved by someone else: nothing to do.
  off: 'bg-muted text-muted-foreground',
} as const;

const ICON_BUTTON = `${iconButtonClassName({ variant: 'secondary', size: 'md' })} aria-expanded:bg-muted aria-expanded:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-60`;

/** The product-link square and the owner's "+ link": from `sm` up only. */
const SM_UP_ONLY = 'max-sm:hidden';

interface PrimaryAction {
  label: string;
  /** Shown instead of `label` below `sm`, where the card is narrow. */
  shortLabel?: string;
  /** The accessible name, which starts from (or contains) `label`. */
  ariaLabel: string;
  icon: IconName;
  tone: keyof typeof PRIMARY_TONES;
  onClick: () => void;
  /**
   * Changes the item's status (Reserve, Release, Publish), so it's held while
   * the card's update runs. Edit and Review aren't, as they never were.
   */
  changesStatus?: boolean;
  /**
   * Nothing the viewer can do here (an item someone else booked, a gift they've
   * given): really disabled.
   */
  unavailable?: boolean;
}

interface WishlistItemProps {
  item: ApiItem;
  // Resolves once the update settles; the card ignores what it resolves with.
  onUpdate: (id: string, updates: Partial<ApiItem>) => Promise<unknown>;
  onEdit?: (item: ApiItem) => void;
  onReview?: (item: ApiItem) => void;
  /** "Save to my list": shown when given (the page decides who may copy what). */
  onSaveToList?: (item: ApiItem) => void;
  /**
   * An owner's Delete… (or Decline… on a proposal), asked once confirmed.
   * Rejects when the delete fails (the page has said so).
   */
  onDelete?: (item: ApiItem) => Promise<void>;
  /** "+ link": opens Edit on the Link field, for an owner's item with no link. */
  onAddLink?: (item: ApiItem) => void;
  isAuthenticated: boolean;
  isOwner?: boolean;
  isMember?: boolean;
  /** Currency to display prices in: 'original' keeps the item's own currency. */
  priceCurrency?: string;
  /** Exchange rates (code → units per USD) for converting when a currency is picked. */
  rates?: Record<string, number> | null;
  /**
   * Shown faded, as an item nobody can act on any more is under All (received,
   * or reserved by someone else: `isDimmedInAll`). Full strength again under
   * the pointer or with focus inside, so it's still readable and usable.
   */
  dimmed?: boolean;
  /** Outlined, as the item a link to it (`?item=`) pointed at; never dimmed then. */
  highlighted?: boolean;
}

function WishlistItem({
  item,
  onUpdate,
  onEdit,
  onReview,
  onSaveToList,
  onDelete,
  onAddLink,
  isAuthenticated,
  isOwner = false,
  isMember = false,
  priceCurrency = 'original',
  rates = null,
  dimmed = false,
  highlighted = false,
}: WishlistItemProps) {
  const { data: session } = useSession();
  const [showNotes, setShowNotes] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [showToDraftConfirm, setShowToDraftConfirm] = useState(false);
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Reset showNotes when item changes
  useEffect(() => {
    setShowNotes(false);
  }, [item._id]);

  const isBookedByCurrentUser = useMemo(
    () => item.bookedBy && session?.user?.id && item.bookedBy === session.user.id,
    [item.bookedBy, session?.user?.id]
  );

  // A gift the member booked and has since marked as given (only a member's own
  // read of the list carries `givenByMe`). It stays booked by them, but isn't
  // offered back up with Release: releasing it is in the menu, behind a warning.
  const isGivenByCurrentUser =
    !isOwner && item.status === 'booked' && !!isBookedByCurrentUser && item.givenByMe === true;

  const isProposedByCurrentUser = useMemo(
    () =>
      item.status === 'proposed' &&
      item.proposedBy &&
      session?.user?.id &&
      item.proposedBy === session.user.id,
    [item.status, item.proposedBy, session?.user?.id]
  );

  // How the item's status looks to this viewer. For owners, a booked item is
  // available (bookings are hidden), so they never get a booked badge or border.
  const status = statusMeta(item.status, isOwner ? 'owner' : isMember ? 'member' : 'visitor', {
    bookedByViewer: !!isBookedByCurrentUser,
  });

  // While the notes are hidden, the cover links to the product page.
  const productLink = item.link && !showNotes ? item.link : null;

  // Price to display: the item's own, exactly, or converted to the picked
  // currency, which is only approximate ("≈ €247"), so the original goes under
  // it. Without the rate (yet), the original alone.
  const locale = useViewerLocale();
  const converted = useMemo(
    () => (item.price ? convertedPrice(item.price, priceCurrency, rates) : null),
    [item.price, priceCurrency, rates]
  );

  const handleToggleBooked = useCallback(async () => {
    if (isOwner || isUpdating) return;
    setIsUpdating(true);
    try {
      const newStatus = item.status === 'booked' ? 'available' : 'booked';
      await onUpdate(item._id, { status: newStatus });
    } finally {
      setIsUpdating(false);
    }
  }, [item.status, item._id, onUpdate, isOwner, isUpdating]);

  const applyStatus = useCallback(
    async (newStatus: 'completed' | 'available' | 'draft') => {
      setIsUpdating(true);
      try {
        await onUpdate(item._id, { status: newStatus });
      } finally {
        setIsUpdating(false);
      }
    },
    [item._id, onUpdate]
  );

  // A content edit of `mostWanted` alone: never the status.
  const handleToggleMostWanted = useCallback(async () => {
    if (!isOwner || isUpdating) return;
    setIsUpdating(true);
    try {
      await onUpdate(item._id, { mostWanted: !item.mostWanted });
    } finally {
      setIsUpdating(false);
    }
  }, [isOwner, isUpdating, item._id, item.mostWanted, onUpdate]);

  const handleConfirmDelete = useCallback(async () => {
    if (!onDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await onDelete(item);
    } catch {
      // The page has said why; the item stays listed.
    } finally {
      setShowDeleteConfirm(false);
      setIsDeleting(false);
    }
  }, [onDelete, item, isDeleting]);

  // Releasing a gift already marked as given, once confirmed. Only ever an
  // unbook: if a poll has shown the item isn't theirs any more while the
  // warning was open, there's nothing left to release.
  const handleRelease = useCallback(() => {
    if (isOwner || isUpdating || item.status !== 'booked' || !isBookedByCurrentUser) return;
    applyStatus('available');
  }, [isOwner, isUpdating, item.status, isBookedByCurrentUser, applyStatus]);

  const handleToggleCompleted = useCallback(() => {
    if (!isOwner || isUpdating) return;
    if (item.status === 'completed') {
      // Un-completing is reversible → no confirmation needed
      applyStatus('available');
    } else {
      setShowCompleteConfirm(true);
    }
  }, [isOwner, isUpdating, item.status, applyStatus]);

  // Publishing a draft is safe (drafts aren't visible to anyone else yet).
  const handlePublish = useCallback(() => {
    if (!isOwner || isUpdating) return;
    applyStatus('available');
  }, [isOwner, isUpdating, applyStatus]);

  // Moving a live item back to draft asks first: it may already be reserved
  // (owners can't see that), and drafting it hides it and frees it on the list,
  // though the gifter keeps their reservation.
  const handleMoveToDraft = useCallback(() => {
    if (!isOwner || isUpdating) return;
    setShowToDraftConfirm(true);
  }, [isOwner, isUpdating]);

  const isProposed = item.status === 'proposed';
  const isDraft = item.status === 'draft';
  // Live (available, or booked as far as a member can tell) or completed.
  const isPublished = !isProposed && !isDraft;
  const isCompleted = status.status === 'completed';

  // true from `sm` up, false below it, null until known (in the server render
  // and the one that hydrates it): see the comment on the action row.
  const smUp = useMediaQuery(SM_UP_QUERY);

  // The one labelled action, by role and state. None (null) means the product
  // link takes its place: for signed-out visitors, signed-in non-members, and
  // a member on an item they can't book (completed).
  let primary: PrimaryAction | null = null;
  if (isAuthenticated && isOwner) {
    if (isProposed && onReview) {
      primary = {
        label: 'Review',
        ariaLabel: 'Review proposed item',
        icon: 'check-circle',
        tone: 'primary',
        onClick: () => onReview(item),
      };
    } else if (isDraft) {
      primary = {
        label: 'Publish',
        ariaLabel: 'Publish item',
        icon: 'globe',
        tone: 'primary',
        onClick: handlePublish,
        changesStatus: true,
      };
    } else if (isPublished && onEdit) {
      primary = {
        label: 'Edit',
        ariaLabel: 'Edit item',
        icon: 'edit',
        tone: 'soft',
        onClick: () => onEdit(item),
      };
    }
  } else if (isAuthenticated && isProposedByCurrentUser && onEdit) {
    primary = {
      label: 'Edit',
      ariaLabel: 'Edit proposed item',
      icon: 'edit',
      tone: 'soft',
      onClick: () => onEdit(item),
    };
  } else if (isAuthenticated && isMember && item.status === 'available') {
    primary = {
      label: 'Reserve',
      ariaLabel: 'Reserve this item',
      icon: 'gift',
      tone: 'book',
      onClick: handleToggleBooked,
      changesStatus: true,
    };
  } else if (isAuthenticated && isMember && item.status === 'booked') {
    // Owners never get here: for them a booked item is just available.
    primary = isGivenByCurrentUser
      ? {
          label: 'Given by you',
          shortLabel: 'Given',
          ariaLabel: 'Given by you',
          icon: 'check-circle',
          tone: 'given',
          onClick: () => {},
          unavailable: true,
        }
      : isBookedByCurrentUser
        ? {
            label: 'Release',
            ariaLabel: 'Release this item',
            icon: 'undo',
            tone: 'neutral',
            onClick: handleToggleBooked,
            changesStatus: true,
          }
        : {
            label: 'Reserved',
            ariaLabel: 'This item is already reserved',
            icon: 'lock',
            tone: 'off',
            onClick: () => {},
            unavailable: true,
          };
  }

  // The actions beyond the primary come from one place (itemCardActions), so
  // anything that reuses the card's actions reads the same set.
  const actionContext: CardActionContext = {
    isAuthenticated,
    isOwner,
    isMember,
    status: item.status,
    isCompleted,
    isGivenByViewer: isGivenByCurrentUser,
    hasLink: !!item.link,
    canEdit: !!onEdit,
    canSave: !!onSaveToList,
    canDelete: !!onDelete,
    canAddLink: !!onAddLink,
  };
  // No link and nothing else to do with it: a signed-in non-member saves the
  // item instead, as the primary.
  if (!primary && onSaveToList && savesAsPrimary(actionContext)) {
    primary = {
      label: 'Save to my list',
      shortLabel: 'Save',
      ariaLabel: 'Save to my list',
      icon: 'plus',
      tone: 'soft',
      onClick: () => onSaveToList(item),
    };
    actionContext.primaryIsSave = true;
  }

  // Moving a completed item to draft isn't offered (it never was), and drafts
  // and other people's proposals can't be copied (the page gives no
  // `onSaveToList` for them). The status changes are held while the card's
  // update runs; Edit and Save to my list aren't.
  const menuItems: MenuItem[] = cardMenuActions(actionContext).map((action): MenuItem => {
    switch (action) {
      case 'markReceived':
        return {
          label: isCompleted ? 'Mark as not received' : 'Mark as received',
          icon: isCompleted ? 'undo' : 'check-circle',
          onSelect: handleToggleCompleted,
          disabled: isUpdating,
        };
      case 'moveToDraft':
        return {
          label: 'Move to draft',
          icon: 'note',
          onSelect: handleMoveToDraft,
          disabled: isUpdating,
        };
      case 'editDraft':
        return { label: 'Edit', icon: 'edit', onSelect: () => onEdit?.(item) };
      case 'mostWanted':
        return {
          label: item.mostWanted ? 'Not most wanted' : 'Mark as most wanted',
          icon: 'star',
          onSelect: handleToggleMostWanted,
          disabled: isUpdating,
        };
      case 'releaseGiven':
        return {
          label: 'Release…',
          icon: 'undo',
          onSelect: () => setShowReleaseConfirm(true),
          disabled: isUpdating,
        };
      case 'saveToList':
        return {
          label: 'Save to my list',
          icon: 'plus',
          onSelect: () => onSaveToList?.(item),
          separated: true,
        };
      case 'decline':
        return {
          label: 'Decline…',
          icon: 'trash',
          onSelect: () => setShowDeleteConfirm(true),
          separated: true,
          danger: true,
        };
      case 'delete':
        return {
          label: 'Delete…',
          icon: 'trash',
          onSelect: () => setShowDeleteConfirm(true),
          separated: true,
          danger: true,
        };
    }
  });

  // The product page opens in a new tab, from the primary action or the link button.
  const productPage = item.link
    ? {
        href: item.link,
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': `View ${item.name} product page`,
      }
    : null;

  // Below `sm`, the link square folds into the menu, as its first item. When
  // the link is the primary action, there's no square to fold.
  const linkFolds = !!primary && !!item.link;
  // Until the width is known the link is in it too, so a menu that CSS shows
  // below `sm` for it is never an empty one. (Items only render while it's
  // open, by when the width is known.)
  const rowMenuItems: MenuItem[] =
    linkFolds && smUp !== true
      ? [
          { label: 'Open product page', icon: 'external-link', href: item.link!, external: true },
          ...menuItems,
        ]
      : menuItems;
  const showMenu = menuItems.length > 0 || (linkFolds && smUp !== true);
  // A menu holding nothing but the folded link is there below `sm` only.
  const menuBelowSmOnly = menuItems.length === 0;
  const slot = linkSlot(actionContext);
  const showLinkSquare = !!primary && smUp !== false;

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
      {/* The cover and what sits on it. From `sm` up, the notes button and
          the badges overhang its top corners, as they always have. On the
          narrow card below it they sit inside it, so they never run into each
          other or the card's corners: the badges top right (the status first,
          then Most wanted as just its star), the notes button bottom left. */}
      <div className="relative mb-3 flex-shrink-0 sm:mb-4">
        {item.notes && (
          <IconButton
            icon={showNotes ? 'image' : 'info'}
            label={showNotes ? 'Show image' : 'Show notes'}
            title={showNotes ? 'Show image' : 'Show notes'}
            onClick={() => setShowNotes(!showNotes)}
            variant="glass"
            size="sm"
            shape="pill"
            iconClassName={showNotes ? 'text-accent' : undefined}
            className="absolute bottom-1.5 left-1.5 z-10 sm:-left-2 sm:-top-2 sm:bottom-auto"
          />
        )}

        <div className="absolute right-1.5 top-1.5 z-10 flex flex-col items-end gap-1 sm:-right-2 sm:-top-2 sm:gap-2">
          {item.mostWanted && (
            <Badge className="shadow-sm max-sm:px-1.5">
              <Icon name="star" size={12} className="fill-amber-400 text-amber-500" />
              <span className="max-sm:sr-only">Most wanted</span>
            </Badge>
          )}
          {/* From the status map, so an owner never gets a booking badge. */}
          {status.badge &&
            (isBookedByCurrentUser && !isOwner && item.status === 'booked' ? (
              // Your own reservation's badge leads to Reserved (WIS-260).
              <Link
                href={RESERVED_PATH}
                aria-label="Reserved by you, open Reserved"
                className="max-sm:order-first rounded-full"
              >
                <Badge status={status} className="shadow-sm" />
              </Link>
            ) : (
              <Badge status={status} className="shadow-sm max-sm:order-first" />
            ))}
        </div>

        {/* Image / notes area — when notes are shown, the image stays visible
            behind a frosted, dimmed layer so the text is easy to read on top.
            Gradient shows through when there's no image (or it fails to load),
            with the item's initial on it below `sm`, where an item with no
            image at all gets a shorter, 4:3 frame. */}
        <Cover
          src={item.imageUrl}
          seed={item._id}
          alt={item.name}
          sizes="(max-width: 1200px) 50vw, 33vw"
          link={
            productLink ? { href: productLink, label: `View ${item.name} product page` } : undefined
          }
          // Not under the notes, where it would show through blurred.
          placeholder={
            !showNotes && (
              <span className="text-4xl font-semibold text-white/90 [text-shadow:0_1px_3px_rgba(0,0,0,0.25)] sm:hidden">
                {coverInitial(item.name)}
              </span>
            )
          }
          className={`relative block w-full overflow-hidden rounded-2xl bg-surface-2 ${
            item.imageUrl ? 'aspect-square' : 'aspect-[4/3] sm:aspect-square'
          } ${productLink ? 'transition-opacity duration-200 hover:opacity-90' : ''}`}
        >
          {showNotes && item.notes && (
            <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4">
              <div className="absolute inset-0 bg-black/45 backdrop-blur-md" aria-hidden />
              <p className="relative max-h-full overflow-y-auto whitespace-pre-wrap break-words text-center text-sm font-medium leading-relaxed text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.65)] sm:text-lg">
                {item.notes}
              </p>
            </div>
          )}
        </Cover>
      </div>

      {/* Content */}
      <div className="flex flex-col flex-grow">
        {/* Item name - can vary in height */}
        <div className="flex-grow">
          <h3
            className="mb-1.5 line-clamp-2 text-body font-semibold text-foreground sm:mb-3 sm:text-title"
            title={item.name}
          >
            {item.name}
          </h3>
        </div>

        {/* Price - fixed position */}
        <div className="mb-2 flex min-h-[28px] min-w-0 flex-col justify-center sm:mb-3 sm:min-h-[32px]">
          {item.price && (
            <p className="truncate text-lg font-semibold text-foreground sm:text-xl">
              {converted ? formatApproxPrice(converted, locale) : formatPrice(item.price, locale)}
            </p>
          )}
          {item.price && converted && (
            <p className="truncate text-xs text-muted-foreground">
              {formatPrice(item.price, locale)}
            </p>
          )}
        </div>

        {/* Actions: one row, the same height on every card. */}
        <div className="mt-auto flex min-h-10 items-center gap-2">
          {primary ? (
            <button
              type="button"
              onClick={() => {
                if (!(primary.changesStatus && isUpdating)) primary.onClick();
              }}
              // Reserved by someone else is really disabled. A status change
              // held while this card's update runs only looks it, so focus on
              // it stays put.
              disabled={primary.unavailable}
              aria-disabled={primary.changesStatus && isUpdating ? true : undefined}
              aria-label={primary.ariaLabel}
              className={`${PRIMARY_BASE} ${PRIMARY_TONES[primary.tone]}`}
            >
              <Icon name={primary.icon} size={16} className={PRIMARY_ICON} />
              {primary.shortLabel ? (
                <>
                  <span className="truncate sm:hidden">{primary.shortLabel}</span>
                  <span className="truncate max-sm:hidden">{primary.label}</span>
                </>
              ) : (
                <span className="truncate">{primary.label}</span>
              )}
            </button>
          ) : productPage ? (
            <a {...productPage} className={`${PRIMARY_BASE} ${PRIMARY_TONES.primary}`}>
              <Icon name="external-link" size={16} className={PRIMARY_ICON} />
              <span className="truncate">View item</span>
            </a>
          ) : null}

          {/* The product link, when the primary action isn't already it: from
              `sm` up (below it, it's in the menu). */}
          {showLinkSquare && slot === 'link' && productPage && (
            <a
              {...productPage}
              className={`${ICON_BUTTON} ${SM_UP_ONLY}`}
              title="View product page"
            >
              <Icon name="external-link" size={18} />
            </a>
          )}
          {showLinkSquare && slot === 'add-link' && onAddLink && (
            <IconButton
              icon="plus"
              label="Add product link"
              title="Add product link"
              variant="secondary"
              size="md"
              onClick={() => onAddLink(item)}
              className={SM_UP_ONLY}
            />
          )}

          {showMenu && (
            <Menu
              label="More actions"
              items={rowMenuItems}
              triggerClassName={ICON_BUTTON}
              className={menuBelowSmOnly ? 'relative flex sm:hidden' : undefined}
            />
          )}
        </div>
      </div>

      {showCompleteConfirm && (
        <ConfirmDialog
          isOpen
          title="Mark as received?"
          message="It stays on the list with a ✓ so people know it's taken care of, and nobody can reserve it. You can undo this."
          confirmText="Mark as received"
          cancelText="Cancel"
          type="info"
          onConfirm={() => {
            setShowCompleteConfirm(false);
            applyStatus('completed');
          }}
          onCancel={() => setShowCompleteConfirm(false)}
        />
      )}

      {showToDraftConfirm && (
        <ConfirmDialog
          isOpen
          title="Move to draft?"
          // An owner's status change frees the item but keeps the gifter's
          // reservation. Read by an owner, so it can't say whether anyone has.
          message="Hide it from everyone else? If someone reserved it, it's released here, but they keep it on their Reserved page."
          confirmText="Move to draft"
          cancelText="Cancel"
          type="warning"
          onConfirm={() => {
            setShowToDraftConfirm(false);
            applyStatus('draft');
          }}
          onCancel={() => setShowToDraftConfirm(false)}
        />
      )}

      {showDeleteConfirm && onDelete && (
        <ConfirmDialog
          isOpen
          // Declining a proposal is the review dialog's Decline: the same
          // words, and the proposer is told nothing (D12).
          title={isProposed ? 'Decline this proposal?' : 'Delete item'}
          message={
            isProposed
              ? "It's removed from the list."
              : 'Are you sure you want to delete this item? This action cannot be undone.'
          }
          confirmText={isProposed ? 'Decline' : 'Delete'}
          pendingText={isProposed ? 'Declining…' : 'Deleting…'}
          cancelText="Cancel"
          type="danger"
          onConfirm={handleConfirmDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {showReleaseConfirm && (
        <ConfirmDialog
          isOpen
          title="Release this gift?"
          message="You’ve marked it as given. Once it’s released, someone else on the list could reserve it and buy it again."
          confirmText="Release"
          cancelText="Cancel"
          type="warning"
          onConfirm={() => {
            setShowReleaseConfirm(false);
            handleRelease();
          }}
          onCancel={() => setShowReleaseConfirm(false)}
        />
      )}
    </div>
  );
}

export default memo(WishlistItem);
