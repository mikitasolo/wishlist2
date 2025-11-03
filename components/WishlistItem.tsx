'use client';

import { IItem } from '@/models/Item';
import Image from 'next/image';
import { useState } from 'react';

interface WishlistItemProps {
  item: IItem;
  onUpdate: (id: string, updates: Partial<IItem>) => Promise<void>;
  isAuthenticated: boolean;
}

export default function WishlistItem({ item, onUpdate, isAuthenticated }: WishlistItemProps) {
  const [isUpdating, setIsUpdating] = useState(false);

  const handleToggleBooked = async () => {
    setIsUpdating(true);
    await onUpdate(item._id!, { isBooked: !item.isBooked });
    setIsUpdating(false);
  };

  const handleToggleCompleted = async () => {
    setIsUpdating(true);
    await onUpdate(item._id!, { isCompleted: !item.isCompleted });
    setIsUpdating(false);
  };

  return (
    <div
      className={`relative bg-white rounded-xl shadow-lg overflow-hidden transition-all duration-300 hover:shadow-xl ${
        isUpdating ? 'opacity-75' : ''
      } ${item.isCompleted ? 'ring-2 ring-green-400' : ''}`}
    >
      {/* Image */}
      <div className="relative h-64 w-full bg-gray-100">
        <Image
          src={item.imageUrl}
          alt={item.name}
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        />
        
        {/* Status badges */}
        <div className="absolute top-3 right-3 flex flex-col gap-2">
          {item.isBooked && (
            <span className="bg-amber-500 text-white text-xs font-semibold px-3 py-1 rounded-full shadow-md">
              Booked
            </span>
          )}
          {item.isCompleted && (
            <span className="bg-green-500 text-white text-xs font-semibold px-3 py-1 rounded-full shadow-md">
              Completed
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-5">
        <h3 className="text-lg font-bold text-gray-800 mb-2 line-clamp-2">
          {item.name}
        </h3>
        
        {item.price && (
          <p className="text-xl font-semibold text-primary-600 mb-3">
            {item.price}
          </p>
        )}

        {/* Action buttons - only shown for authenticated users */}
        {isAuthenticated && (
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={handleToggleBooked}
              className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                item.isBooked
                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              disabled={isUpdating}
            >
              {item.isBooked ? 'Unbook' : 'Book'}
            </button>
            
            <button
              onClick={handleToggleCompleted}
              className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                item.isCompleted
                  ? 'bg-green-500 text-white hover:bg-green-600'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              disabled={isUpdating}
            >
              {item.isCompleted ? 'Uncomplete' : 'Complete'}
            </button>
          </div>
        )}

        {item.link && (
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className={`block w-full bg-primary-600 text-white text-sm font-medium px-3 py-2 rounded-lg hover:bg-primary-700 transition-colors text-center ${
              !isAuthenticated ? 'mt-0' : ''
            }`}
          >
            View Item
          </a>
        )}

        {/* Sign in prompt for public viewers */}
        {!isAuthenticated && !item.link && (
          <p className="text-sm text-gray-500 text-center italic">
            Sign in to book this item
          </p>
        )}
      </div>
    </div>
  );
}

