'use client';

import { memo, useMemo, useCallback, useState, useEffect } from 'react';
import { ApiItem } from '@/types/api';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { formatPriceFromObject } from '@/lib/utils/currency';

interface WishlistItemProps {
  item: ApiItem;
  onUpdate: (id: string, updates: Partial<ApiItem>) => Promise<void>;
  onEdit?: (item: ApiItem) => void;
  onReview?: (item: ApiItem) => void;
  isAuthenticated: boolean;
  isOwner?: boolean;
  isMember?: boolean;
}

function WishlistItem({
  item,
  onUpdate,
  onEdit,
  onReview,
  isAuthenticated,
  isOwner = false,
  isMember = false,
}: WishlistItemProps) {
  const { data: session } = useSession();
  const [imageLoading, setImageLoading] = useState(true);
  const [showNotes, setShowNotes] = useState(false);

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

  const handleToggleBooked = useCallback(async () => {
    if (isOwner) return; // Owners can't book items
    const newStatus = item.status === 'booked' ? 'available' : 'booked';
    await onUpdate(item._id, { status: newStatus });
  }, [item.status, item._id, onUpdate, isOwner]);

  const handleToggleCompleted = useCallback(async () => {
    if (!isOwner) return; // Only owners can complete items
    const newStatus = item.status === 'completed' ? 'available' : 'completed';
    await onUpdate(item._id, { status: newStatus });
  }, [item.status, item._id, onUpdate, isOwner]);

  // Determine border styling based on item status
  const getBorderClass = () => {
    if (item.status === 'draft') {
      return 'border-2 border-gray-300 border-dashed';
    }
    if (item.status === 'proposed') {
      return 'border-2 border-blue-500 border-dashed';
    }
    if (item.status === 'booked' && !isOwner && isBookedByCurrentUser) {
      return 'border-2 border-green-700 border-dashed';
    }
    if (item.status === 'booked' && !isOwner && !isBookedByCurrentUser) {
      return 'border-2 border-yellow-500 border-dashed';
    }
    return '';
  };

  return (
    <div
      className={`relative bg-white rounded-xl shadow-lg transition-all duration-300 hover:shadow-xl flex flex-col p-4 sm:p-5 ${
        displayStatus === 'completed' ? 'ring-2 ring-green-400' : ''
      } ${getBorderClass()}`}
      role="article"
      aria-label={`Item: ${item.name}`}
    >
      {/* Notes icon button - positioned absolutely at top-left corner of card */}
      {item.notes && (
        <button
          onClick={() => setShowNotes(!showNotes)}
          className="absolute top-2 left-2 sm:top-3 sm:left-3 z-10 bg-white/90 hover:bg-white rounded-full p-2 shadow-md transition-all cursor-pointer"
          aria-label={showNotes ? 'Show image' : 'Show notes'}
        >
          <svg
            className={`w-5 h-5 transition-colors ${
              showNotes ? 'text-primary-600' : 'text-gray-600'
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </button>
      )}

      {/* Status badges - positioned absolutely at top-right corner of card */}
      <div className="absolute top-2 right-2 sm:top-3 sm:right-3 z-10 flex flex-col gap-2">
        {item.status === 'draft' && (
          <span className="bg-gray-500 text-white text-xs font-semibold px-3 py-1 rounded-full shadow-md">
            Draft
          </span>
        )}
        {item.status === 'proposed' && (
          <span className="bg-blue-500 text-white text-xs font-semibold px-3 py-1 rounded-full shadow-md">
            Proposed
          </span>
        )}
        {/* Only show booking badges to members, not owners */}
        {!isOwner && item.status === 'booked' && isBookedByCurrentUser && (
          <span className="bg-green-700 text-white text-xs font-semibold px-3 py-1 rounded-full shadow-md">
            Booked by you
          </span>
        )}
        {!isOwner && item.status === 'booked' && !isBookedByCurrentUser && (
          <span className="bg-yellow-500 text-white text-xs font-semibold px-3 py-1 rounded-full shadow-md">
            Booked
          </span>
        )}
        {displayStatus === 'completed' && (
          <span className="bg-green-500 text-white text-xs font-semibold px-3 py-1 rounded-full shadow-md">
            Completed
          </span>
        )}
      </div>

      {/* Image/Notes area */}
      {item.link && !showNotes ? (
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="relative h-64 w-full bg-gray-100 flex-shrink-0 rounded-lg overflow-hidden mb-4 block cursor-pointer hover:opacity-90 transition-opacity duration-200"
          aria-label={`View ${item.name} product page`}
        >
          {imageLoading && item.imageUrl && (
            <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-pulse" />
          )}
          {item.imageUrl ? (
            <Image
              src={item.imageUrl}
              alt={item.name}
              fill
              className={`object-cover transition-opacity duration-300 ${
                imageLoading ? 'opacity-0' : 'opacity-100'
              }`}
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              onLoad={() => setImageLoading(false)}
              onError={() => setImageLoading(false)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-200">
              <div className="text-center text-gray-400">
                <svg
                  className="w-16 h-16 mx-auto mb-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <p className="text-xs font-medium">No Image</p>
              </div>
            </div>
          )}
        </a>
      ) : (
        <div className="relative h-64 w-full bg-gray-100 flex-shrink-0 rounded-lg overflow-hidden mb-4">
          {/* Show notes or image */}
          {showNotes && item.notes ? (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-50 p-4">
              <p className="text-base sm:text-lg text-gray-800 whitespace-pre-wrap break-words text-center">
                {item.notes}
              </p>
            </div>
          ) : (
            <>
              {imageLoading && item.imageUrl && (
                <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-pulse" />
              )}
              {item.imageUrl ? (
                <Image
                  src={item.imageUrl}
                  alt={item.name}
                  fill
                  className={`object-cover transition-opacity duration-300 ${
                    imageLoading ? 'opacity-0' : 'opacity-100'
                  }`}
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  onLoad={() => setImageLoading(false)}
                  onError={() => setImageLoading(false)}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-200">
                  <div className="text-center text-gray-400">
                    <svg
                      className="w-16 h-16 mx-auto mb-2"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    <p className="text-xs font-medium">No Image</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex flex-col flex-grow">
        {/* Item name - can vary in height */}
        <div className="flex-grow">
          <h3
            className="text-base sm:text-lg font-bold text-gray-800 mb-2 sm:mb-3 line-clamp-2"
            title={item.name}
          >
            {item.name}
          </h3>
        </div>

        {/* Price - fixed position */}
        <div className="mb-2 sm:mb-3 min-h-[28px] sm:min-h-[32px] flex items-center">
          {item.price && (
            <p className="text-lg sm:text-xl font-semibold text-primary-600">
              {formatPriceFromObject(item.price)}
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
                    className="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors cursor-pointer"
                    aria-label="Review proposed item"
                  >
                    Review
                  </button>
                )}
                {/* Edit button for proposer */}
                {isProposedByCurrentUser && onEdit && (
                  <button
                    onClick={() => onEdit(item)}
                    className="flex-1 px-3 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors cursor-pointer"
                    aria-label="Edit proposed item"
                  >
                    Edit
                  </button>
                )}
              </>
            )}

            {/* Book/Unbook button - only for members, not for proposed items */}
            {isMember && displayStatus !== 'completed' && item.status !== 'proposed' && (
              <button
                onClick={handleToggleBooked}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  item.status === 'booked' && isBookedByCurrentUser
                    ? 'bg-gray-300 text-gray-700 hover:bg-gray-400 cursor-pointer'
                    : item.status === 'booked'
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-green-700 text-white hover:bg-green-800 cursor-pointer'
                }`}
                disabled={item.status === 'booked' && !isBookedByCurrentUser}
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
                    className={`px-3 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors cursor-pointer ${
                      item.status === 'draft' ? 'flex-1' : ''
                    }`}
                    aria-label="Edit item"
                  >
                    Edit
                  </button>
                )}
                {/* Complete/Uncomplete button - only for owners, not for draft items */}
                {item.status !== 'draft' && (
                  <button
                    onClick={handleToggleCompleted}
                    className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                      displayStatus === 'completed'
                        ? 'bg-green-500 text-white hover:bg-green-600'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                    aria-label={
                      displayStatus === 'completed'
                        ? 'Mark item as available'
                        : 'Mark item as completed'
                    }
                  >
                    {displayStatus === 'completed' ? 'Uncomplete' : 'Complete'}
                  </button>
                )}
              </>
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
              className="block w-full bg-primary-600 text-white text-sm font-medium px-3 py-2 rounded-lg hover:bg-primary-700 transition-colors text-center cursor-pointer"
              aria-label={`View ${item.name} product page`}
            >
              View Item
            </a>
          ) : (
            <p className="text-sm text-gray-500 text-center italic py-2">Item has no link</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(WishlistItem);
