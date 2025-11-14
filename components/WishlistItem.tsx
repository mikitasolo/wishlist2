'use client';

import { memo, useMemo, useCallback, useState } from 'react';
import { IItem } from '@/models/Item';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { formatPrice } from '@/lib/utils/currency';

interface WishlistItemProps {
  item: IItem;
  onUpdate: (id: string, updates: Partial<IItem>) => Promise<void>;
  onEdit?: (item: IItem) => void;
  isAuthenticated: boolean;
  isOwner?: boolean;
  isMember?: boolean;
}

function WishlistItem({ item, onUpdate, onEdit, isAuthenticated, isOwner = false, isMember = false }: WishlistItemProps) {
  const { data: session } = useSession();
  const [imageLoading, setImageLoading] = useState(true);
  
  const isBookedByCurrentUser = useMemo(
    () => item.bookedBy && session?.user?.id && item.bookedBy.toString() === session.user.id,
    [item.bookedBy, session?.user?.id]
  );
  
  // For owners, items always show as available (bookings are hidden)
  const displayStatus = isOwner && item.status === 'booked' ? 'available' : item.status;
  
  const handleToggleBooked = useCallback(async () => {
    if (isOwner) return; // Owners can't book items
    const newStatus = item.status === 'booked' ? 'available' : 'booked';
    await onUpdate(item._id.toString(), { status: newStatus });
  }, [item.status, item._id, onUpdate, isOwner]);

  const handleToggleCompleted = useCallback(async () => {
    if (!isOwner) return; // Only owners can complete items
    const newStatus = item.status === 'completed' ? 'available' : 'completed';
    await onUpdate(item._id.toString(), { status: newStatus });
  }, [item.status, item._id, onUpdate, isOwner]);

  return (
    <div
      className={`relative bg-white rounded-xl shadow-lg overflow-hidden transition-all duration-300 hover:shadow-xl flex flex-col ${
        displayStatus === 'completed' ? 'ring-2 ring-green-400' : ''
      }`}
      role="article"
      aria-label={`Item: ${item.name}`}
    >
      {/* Image */}
      <div className="relative h-64 w-full bg-gray-100 flex-shrink-0">
        {imageLoading && (
          <div className="absolute inset-0 bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 animate-pulse" />
        )}
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
        
        {/* Status badges */}
        <div className="absolute top-3 right-3 flex flex-col gap-2">
          {/* Only show booking badges to members, not owners */}
          {!isOwner && item.status === 'booked' && isBookedByCurrentUser && (
            <span className="bg-amber-500 text-white text-xs font-semibold px-3 py-1 rounded-full shadow-md">
              Booked by you
            </span>
          )}
          {!isOwner && item.status === 'booked' && !isBookedByCurrentUser && (
            <span className="bg-amber-500 text-white text-xs font-semibold px-3 py-1 rounded-full shadow-md">
              Booked
            </span>
          )}
          {displayStatus === 'completed' && (
            <span className="bg-green-500 text-white text-xs font-semibold px-3 py-1 rounded-full shadow-md">
              Completed
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4 sm:p-5 flex flex-col flex-grow">
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
          {item.priceInCents != null && (
            <p className="text-lg sm:text-xl font-semibold text-primary-600">
              {formatPrice(item.priceInCents)}
            </p>
          )}
        </div>

        {/* Action buttons - only shown for authenticated users */}
        {isAuthenticated && (
          <div className="flex flex-wrap gap-2 mb-3 mt-auto">
            {/* Book/Unbook button - only for members */}
            {isMember && displayStatus !== 'completed' && (
              <button
                onClick={handleToggleBooked}
                className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  item.status === 'booked' && isBookedByCurrentUser
                    ? 'bg-amber-500 text-white hover:bg-amber-600 cursor-pointer'
                    : item.status === 'booked'
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-primary-600 text-white hover:bg-primary-700 cursor-pointer'
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
            
            {/* Owner buttons */}
            {isOwner && (
              <>
                {/* Edit button - only for owners */}
                {onEdit && (
                  <button
                    onClick={() => onEdit(item)}
                    className="px-3 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors cursor-pointer"
                    aria-label="Edit item"
                  >
                    Edit
                  </button>
                )}
                {/* Complete/Uncomplete button - only for owners */}
                <button
                  onClick={handleToggleCompleted}
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                    displayStatus === 'completed'
                      ? 'bg-green-500 text-white hover:bg-green-600'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                  aria-label={displayStatus === 'completed' ? 'Mark item as available' : 'Mark item as completed'}
                >
                  {displayStatus === 'completed' ? 'Uncomplete' : 'Complete'}
                </button>
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
            <p className="text-sm text-gray-500 text-center italic py-2">
              Item has no link
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(WishlistItem);
