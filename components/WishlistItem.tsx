'use client';

import { memo, useMemo, useCallback, useState, useEffect } from 'react';
import { ApiItem } from '@/types/api';
import { useSession } from 'next-auth/react';
import { formatPriceFromObject, convertPrice } from '@/lib/utils/currency';
import Icon from '@/components/Icon';
import Cover from '@/components/Cover';
import ConfirmDialog from '@/components/ConfirmDialog';

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

  // Reset showNotes when item changes
  useEffect(() => {
    setShowNotes(false);
  }, [item._id]);

  const isBookedByCurrentUser = useMemo(
    () => item.bookedBy && session?.user?.id && item.bookedBy === session.user.id,
    [item.bookedBy, session?.user?.id]
  );

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

  // Moving a live item back to draft is dangerous: it may already be reserved
  // (owners can't see that), and drafting it hides it and cancels the booking.
  const handleMoveToDraft = useCallback(() => {
    if (!isOwner || isUpdating) return;
    setShowToDraftConfirm(true);
  }, [isOwner, isUpdating]);

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

        {/* Action buttons - only shown for authenticated users */}
        {isAuthenticated && (
          <div className="flex flex-wrap gap-2 mb-3 mt-auto">
            {/* Proposed item actions */}
            {item.status === 'proposed' && (
              <>
                {/* Review button for owners */}
                {isOwner && onReview && (
                  <button
                    onClick={() => onReview(item)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-700"
                    aria-label="Review proposed item"
                  >
                    <Icon name="check-circle" size={16} />
                    Review
                  </button>
                )}
                {/* Edit button for proposer */}
                {isProposedByCurrentUser && onEdit && (
                  <button
                    onClick={() => onEdit(item)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-muted px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
                    aria-label="Edit proposed item"
                  >
                    <Icon name="edit" size={16} />
                    Edit
                  </button>
                )}
              </>
            )}

            {/* Book/Unbook button - only for members, not for proposed items */}
            {isMember && displayStatus !== 'completed' && item.status !== 'proposed' && (
              <button
                onClick={handleToggleBooked}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium shadow-sm transition-colors ${
                  isUpdating
                    ? 'cursor-not-allowed opacity-60'
                    : item.status === 'booked' && isBookedByCurrentUser
                      ? 'cursor-pointer bg-muted text-foreground shadow-none hover:bg-surface-2'
                      : item.status === 'booked'
                        ? 'cursor-not-allowed bg-muted text-muted-foreground shadow-none'
                        : 'cursor-pointer bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
                disabled={isUpdating || (item.status === 'booked' && !isBookedByCurrentUser)}
                aria-label={
                  item.status === 'booked' && isBookedByCurrentUser
                    ? 'Unbook this item'
                    : item.status === 'booked'
                      ? 'This item is already booked'
                      : 'Book this item'
                }
              >
                {item.status === 'booked' && isBookedByCurrentUser
                  ? 'Unbook'
                  : item.status === 'booked'
                    ? 'Booked'
                    : 'Book'}
              </button>
            )}

            {/* Owner buttons - not for proposed items */}
            {isOwner && item.status !== 'proposed' && (
              <>
                {/* Edit button - only for owners */}
                {onEdit && (
                  <button
                    onClick={() => onEdit(item)}
                    className="flex items-center justify-center gap-1.5 rounded-xl bg-muted px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
                    aria-label="Edit item"
                  >
                    <Icon name="edit" size={16} />
                    Edit
                  </button>
                )}

                {item.status === 'draft' ? (
                  /* Draft: publish it (safe — nobody else can see it yet) */
                  <button
                    onClick={handlePublish}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium shadow-sm transition-colors ${
                      isUpdating
                        ? 'cursor-not-allowed opacity-60'
                        : 'cursor-pointer bg-primary-600 text-white hover:bg-primary-700'
                    }`}
                    disabled={isUpdating}
                    aria-label="Publish item"
                  >
                    <Icon name="globe" size={16} />
                    Publish
                  </button>
                ) : (
                  <>
                    {/* Complete / Uncomplete */}
                    <button
                      onClick={handleToggleCompleted}
                      className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium shadow-sm transition-colors ${
                        isUpdating
                          ? 'cursor-not-allowed opacity-60'
                          : displayStatus === 'completed'
                            ? 'cursor-pointer bg-emerald-500 text-white hover:bg-emerald-600'
                            : 'cursor-pointer bg-muted text-foreground shadow-none hover:bg-surface-2'
                      }`}
                      disabled={isUpdating}
                      aria-label={
                        displayStatus === 'completed'
                          ? 'Mark item as available'
                          : 'Mark item as completed'
                      }
                    >
                      {displayStatus === 'completed' ? 'Uncomplete' : 'Complete'}
                    </button>
                    {/* Move to draft — only for live (non-completed) items; danger */}
                    {displayStatus !== 'completed' && (
                      <button
                        onClick={handleMoveToDraft}
                        className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                          isUpdating
                            ? 'cursor-not-allowed opacity-60'
                            : 'cursor-pointer bg-muted text-muted-foreground hover:bg-surface-2 hover:text-foreground'
                        }`}
                        disabled={isUpdating}
                        aria-label="Move item to draft"
                        title="Move to draft"
                      >
                        <Icon name="note" size={16} />
                        Draft
                      </button>
                    )}
                  </>
                )}
              </>
            )}

            {/* Save a copy to one of the viewer's own lists */}
            {onSaveToList && (
              <button
                onClick={() => onSaveToList(item)}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-muted px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
                aria-label="Save to my list"
                title="Save to my list"
              >
                <Icon name="plus" size={16} />
                Save
              </button>
            )}
          </div>
        )}

        {/* Link button or placeholder - always at bottom with consistent height */}
        <div className={isAuthenticated ? '' : 'mt-auto'}>
          {item.link ? (
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-3 py-2 text-center text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-700"
              aria-label={`View ${item.name} product page`}
            >
              <Icon name="external-link" size={16} />
              View item
            </a>
          ) : (
            <p className="py-2 text-center text-sm italic text-muted-foreground">
              No link provided
            </p>
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
          message="Draft items are hidden from everyone else. If someone has already reserved this item, moving it to draft will cancel their reservation. You can publish it again later."
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
    </div>
  );
}

export default memo(WishlistItem);
