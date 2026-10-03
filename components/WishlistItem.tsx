'use client';

import { memo, useMemo, useCallback, useState, useEffect } from 'react';
import { ApiItem } from '@/types/api';
import { useSession } from 'next-auth/react';
import { formatPriceFromObject, convertPrice } from '@/lib/utils/currency';
import Icon, { type IconName } from '@/components/Icon';
import Cover from '@/components/Cover';
import ConfirmDialog from '@/components/ConfirmDialog';
import Menu, { type MenuItem } from '@/components/Menu';

// The card's actions are one row, the same height on every card: one labelled
// primary action, then the product link as a square icon button (unless the
// link is the primary), then a "More actions" menu with the rest.
const ROW_CONTROL = 'h-10 rounded-xl text-sm font-semibold';

const PRIMARY_BASE = `${ROW_CONTROL} inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 px-3 transition-all duration-200 cursor-pointer active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:active:scale-100`;

const PRIMARY_TONES = {
  // Booking: the emerald of the "Booked by you" badge.
  book: 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-500',
  // Publishing, reviewing, opening the product page.
  primary: 'bg-primary-600 text-white shadow-sm hover:bg-primary-500',
  // Editing: always there for an owner, so it doesn't shout.
  soft: 'bg-primary-500/12 text-accent hover:bg-primary-500/18 dark:text-primary-300',
  // Undoing your own booking.
  neutral: 'bg-muted text-foreground hover:bg-surface-2',
  // A gift you've given: done, in the emerald of your booking.
  given: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  // Booked by someone else: nothing to do.
  off: 'bg-muted text-muted-foreground',
} as const;

const SQUARE = 'inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl';

const ICON_BUTTON = `${SQUARE} border border-border-strong bg-surface text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-60`;

interface PrimaryAction {
  label: string;
  /** The accessible name, which starts from (or contains) `label`. */
  ariaLabel: string;
  icon: IconName;
  tone: keyof typeof PRIMARY_TONES;
  onClick: () => void;
  /**
   * Changes the item's status (Book, Unbook, Publish), so it's held while
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
  isAuthenticated: boolean;
  isOwner?: boolean;
  isMember?: boolean;
  /** Currency to display prices in: 'original' keeps the item's own currency. */
  priceCurrency?: string;
  /** Exchange rates (code → units per USD) for converting when a currency is picked. */
  rates?: Record<string, number> | null;
}

function WishlistItem({
  item,
  onUpdate,
  onEdit,
  onReview,
  onSaveToList,
  isAuthenticated,
  isOwner = false,
  isMember = false,
  priceCurrency = 'original',
  rates = null,
}: WishlistItemProps) {
  const { data: session } = useSession();
  const [showNotes, setShowNotes] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [showToDraftConfirm, setShowToDraftConfirm] = useState(false);
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);

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
  // offered back up with Unbook: releasing it is in the menu, behind a warning.
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

  // For owners, items always show as available (bookings are hidden)
  const displayStatus = isOwner && item.status === 'booked' ? 'available' : item.status;

  // While the notes are hidden, the cover links to the product page.
  const productLink = item.link && !showNotes ? item.link : null;

  // Price to display: original currency, or converted to the picked currency
  // (falling back to original if the rate isn't available yet).
  const displayPrice = useMemo(() => {
    if (!item.price) return null;
    if (priceCurrency === 'original' || !rates) return item.price;
    return convertPrice(item.price, priceCurrency, rates) ?? item.price;
  }, [item.price, priceCurrency, rates]);

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
  const isCompleted = displayStatus === 'completed';

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
      label: 'Book',
      ariaLabel: 'Book this item',
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
          ariaLabel: 'Given by you',
          icon: 'check-circle',
          tone: 'given',
          onClick: () => {},
          unavailable: true,
        }
      : isBookedByCurrentUser
        ? {
            label: 'Unbook',
            ariaLabel: 'Unbook this item',
            icon: 'undo',
            tone: 'neutral',
            onClick: handleToggleBooked,
            changesStatus: true,
          }
        : {
            label: 'Booked',
            ariaLabel: 'This item is already booked',
            icon: 'lock',
            tone: 'off',
            onClick: () => {},
            unavailable: true,
          };
  }

  // Everything else the viewer may do. Moving a completed item to draft isn't
  // offered (it never was), and drafts and other people's proposals can't be
  // copied (the page gives no `onSaveToList` for them). The status changes
  // are held while the card's update runs; Edit and Save to my list aren't.
  const menuItems: MenuItem[] = [];
  if (isAuthenticated && isOwner && isPublished) {
    menuItems.push({
      label: isCompleted ? 'Mark as available' : 'Mark as completed',
      icon: isCompleted ? 'undo' : 'check-circle',
      onSelect: handleToggleCompleted,
      disabled: isUpdating,
    });
    if (!isCompleted) {
      menuItems.push({
        label: 'Move to draft',
        icon: 'note',
        onSelect: handleMoveToDraft,
        disabled: isUpdating,
      });
    }
  }
  if (isAuthenticated && isOwner && isDraft && onEdit) {
    menuItems.push({ label: 'Edit', icon: 'edit', onSelect: () => onEdit(item) });
  }
  if (isAuthenticated && isMember && isGivenByCurrentUser) {
    menuItems.push({
      label: 'Release…',
      icon: 'undo',
      onSelect: () => setShowReleaseConfirm(true),
      disabled: isUpdating,
    });
  }
  if (isAuthenticated && onSaveToList) {
    menuItems.push({
      label: 'Save to my list',
      icon: 'plus',
      onSelect: () => onSaveToList(item),
      separated: true,
    });
  }

  // The product page opens in a new tab, from the primary action or the link button.
  const productPage = item.link
    ? {
        href: item.link,
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': `View ${item.name} product page`,
      }
    : null;

  // Determine border styling based on item status (refined, tokenized)
  const getBorderClass = () => {
    if (item.status === 'draft') {
      return 'border-dashed border-border-strong';
    }
    if (item.status === 'proposed') {
      return 'border-primary-400 ring-1 ring-primary-400/40';
    }
    if (item.status === 'booked' && !isOwner && isBookedByCurrentUser) {
      return 'border-emerald-500/60 ring-1 ring-emerald-500/30';
    }
    if (item.status === 'booked' && !isOwner && !isBookedByCurrentUser) {
      return 'border-amber-500/60 ring-1 ring-amber-500/30';
    }
    return 'border-border';
  };

  return (
    <div
      className={`group relative flex flex-col rounded-3xl border bg-surface p-4 shadow-md transition-all duration-200 hover:shadow-lg sm:p-5 ${
        displayStatus === 'completed' ? 'ring-1 ring-emerald-500/40' : ''
      } ${getBorderClass()}`}
      role="article"
      aria-label={`Item: ${item.name}`}
    >
      {/* Notes icon button - positioned absolutely at top-left corner of card */}
      {item.notes && (
        <button
          onClick={() => setShowNotes(!showNotes)}
          className="absolute left-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface/90 shadow-sm backdrop-blur transition-all hover:bg-surface sm:left-3 sm:top-3"
          aria-label={showNotes ? 'Show image' : 'Show notes'}
          title={showNotes ? 'Show image' : 'Show notes'}
        >
          <Icon
            name={showNotes ? 'image' : 'info'}
            size={18}
            className={showNotes ? 'text-accent dark:text-primary-400' : 'text-muted-foreground'}
          />
        </button>
      )}

      {/* Status badges - positioned absolutely at top-right corner of card */}
      <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-2 sm:right-3 sm:top-3">
        {item.mostWanted && (
          <span className="flex items-center gap-1 rounded-full border border-border bg-surface/90 px-2.5 py-1 text-xs font-semibold text-foreground shadow-sm backdrop-blur">
            <Icon name="star" size={12} className="fill-amber-400 text-amber-500" />
            Most wanted
          </span>
        )}
        {item.status === 'draft' && (
          <span className="rounded-full border border-border bg-surface/90 px-2.5 py-1 text-xs font-semibold text-muted-foreground shadow-sm backdrop-blur">
            Draft
          </span>
        )}
        {item.status === 'proposed' && (
          <span className="rounded-full bg-primary-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
            Proposed
          </span>
        )}
        {/* Only show booking badges to members, not owners */}
        {!isOwner && item.status === 'booked' && isBookedByCurrentUser && (
          <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
            Booked by you
          </span>
        )}
        {!isOwner && item.status === 'booked' && !isBookedByCurrentUser && (
          <span className="rounded-full bg-amber-500 px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
            Booked
          </span>
        )}
        {displayStatus === 'completed' && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
            <Icon name="check" size={12} />
            Completed
          </span>
        )}
      </div>

      {/* Image / notes area — when notes are shown, the image stays visible
          behind a frosted, dimmed layer so the text is easy to read on top.
          Gradient shows through when there's no image (or it fails to load). */}
      <Cover
        src={item.imageUrl}
        seed={item._id}
        alt={item.name}
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        link={
          productLink ? { href: productLink, label: `View ${item.name} product page` } : undefined
        }
        className={`relative mb-4 block aspect-square w-full flex-shrink-0 overflow-hidden rounded-2xl bg-surface-2 ${
          productLink ? 'transition-opacity duration-200 hover:opacity-90' : ''
        }`}
      >
        {showNotes && item.notes && (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/45 backdrop-blur-md" aria-hidden />
            <p className="relative max-h-full overflow-y-auto whitespace-pre-wrap break-words text-center text-base font-medium leading-relaxed text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.65)] sm:text-lg">
              {item.notes}
            </p>
          </div>
        )}
      </Cover>

      {/* Content */}
      <div className="flex flex-col flex-grow">
        {/* Item name - can vary in height */}
        <div className="flex-grow">
          <h3
            className="mb-2 line-clamp-2 text-base font-semibold text-foreground sm:mb-3 sm:text-lg"
            title={item.name}
          >
            {item.name}
          </h3>
        </div>

        {/* Price - fixed position */}
        <div className="mb-2 flex min-h-[28px] items-center sm:mb-3 sm:min-h-[32px]">
          {displayPrice && (
            <p className="text-lg font-semibold text-foreground sm:text-xl">
              {formatPriceFromObject(displayPrice)}
            </p>
          )}
        </div>

        {/* Actions: one row, the same height on every card. */}
        <div className="mt-auto flex items-center gap-2">
          {primary ? (
            <button
              type="button"
              onClick={() => {
                if (!(primary.changesStatus && isUpdating)) primary.onClick();
              }}
              // Booked by someone else is really disabled. A status change
              // held while this card's update runs only looks it, so focus on
              // it stays put.
              disabled={primary.unavailable}
              aria-disabled={primary.changesStatus && isUpdating ? true : undefined}
              aria-label={primary.ariaLabel}
              className={`${PRIMARY_BASE} ${PRIMARY_TONES[primary.tone]}`}
            >
              <Icon name={primary.icon} size={16} className="flex-shrink-0" />
              <span className="truncate">{primary.label}</span>
            </button>
          ) : productPage ? (
            <a {...productPage} className={`${PRIMARY_BASE} ${PRIMARY_TONES.primary}`}>
              <Icon name="external-link" size={16} className="flex-shrink-0" />
              <span className="truncate">View item</span>
            </a>
          ) : (
            <p
              className={`${ROW_CONTROL} flex min-w-0 flex-1 items-center justify-center border border-dashed border-border px-3 font-medium italic text-muted-foreground`}
            >
              <span className="truncate">No link provided</span>
            </p>
          )}

          {/* The product link, when the primary action isn't already it. */}
          {primary &&
            (productPage ? (
              <a {...productPage} className={ICON_BUTTON} title="View product page">
                <Icon name="external-link" size={18} />
              </a>
            ) : (
              <span
                role="img"
                aria-label="No link provided"
                title="No link provided"
                className={`${SQUARE} border border-dashed border-border text-muted-foreground/70`}
              >
                <Icon name="link-off" size={18} />
              </span>
            ))}

          {menuItems.length > 0 && (
            <Menu label="More actions" items={menuItems} triggerClassName={ICON_BUTTON} />
          )}
        </div>
      </div>

      {showCompleteConfirm && (
        <ConfirmDialog
          isOpen
          title="Mark as completed?"
          message="This marks the item as completed on this wishlist."
          confirmText="Complete"
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
