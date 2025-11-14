'use client';

import Link from 'next/link';
import { IWishlist } from '@/models/Wishlist';

interface WishlistCardProps {
  wishlist: IWishlist & { ownerEmail?: string | null; isMember?: boolean };
  showOwner?: boolean;
}

export default function WishlistCard({ 
  wishlist, 
  showOwner = false,
}: WishlistCardProps) {
  const ownerEmail = wishlist.ownerEmail || 'Unknown';

  return (
    <Link
      href={`/wishlists/${wishlist._id}`}
      className="bg-white rounded-xl px-6 py-4 shadow-md hover:shadow-lg transition-shadow cursor-pointer"
    >
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-1">
          {wishlist.name}
        </h3>
        {showOwner && (
          <p className="text-sm text-gray-500 mb-3">
            by {ownerEmail}
          </p>
        )}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>{wishlist.isPublic ? 'Public' : 'Private'}</span>
          {wishlist.isMember && (
            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">Member</span>
          )}
        </div>
      </div>
    </Link>
  );
}

