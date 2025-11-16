'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import AuthButton from '@/components/AuthButton';
import UserSearch from '@/components/UserSearch';
import WishlistCard from '@/components/WishlistCard';
import { useToast } from '@/components/ToastProvider';
import { IWishlist } from '@/models/Wishlist';
import { IUser } from '@/models/User';

interface WishlistWithMembership extends IWishlist {
  isMember?: boolean;
  ownerEmail?: string | null;
}

export default function UserWishlists() {
  const { data: session, status } = useSession();
  const params = useParams();
  const router = useRouter();
  const { showToast } = useToast();
  const userId = typeof params?.id === 'string' ? params.id : null;

  const [user, setUser] = useState<IUser | null>(null);
  const [wishlists, setWishlists] = useState<WishlistWithMembership[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchUserWishlists() {
      if (!userId) return;

      // Redirect to home if user is viewing their own page
      if (session?.user?.id === userId) {
        router.push('/');
        return;
      }

      try {
        setLoading(true);

        // Fetch user info
        const userResponse = await fetch(`/api/users/${userId}`, { cache: 'no-store' });
        if (!userResponse.ok) {
          if (userResponse.status === 404) {
            showToast('User not found', 'error');
            router.push('/');
            return;
          }
          throw new Error('Failed to fetch user');
        }
        const userResult = await userResponse.json();
        if (userResult.success) {
          setUser(userResult.data);
        }

        // Fetch wishlists
        const wishlistsResponse = await fetch(`/api/users/${userId}/wishlists`, { cache: 'no-store' });
        if (!wishlistsResponse.ok) {
          throw new Error('Failed to fetch wishlists');
        }
        const wishlistsResult = await wishlistsResponse.json();
        if (wishlistsResult.success) {
          setWishlists(wishlistsResult.data || []);
        } else {
          showToast('Failed to load wishlists', 'error');
        }
      } catch (error) {
        console.error('Error fetching user wishlists:', error);
        showToast('Failed to load wishlists', 'error');
      } finally {
        setLoading(false);
      }
    }

    fetchUserWishlists();
  }, [userId, session?.user?.id, router, showToast]);

  if (status === 'loading' || loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
          <p className="mt-4 text-sm text-gray-600">Loading...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6 lg:py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 sm:mb-8">
          <div className="relative flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 sm:mb-8 gap-4">
            <div className="text-center sm:text-left flex-1">
              <div className="flex flex-col items-center sm:items-start mb-2 sm:mb-4">
                <Link href="/" className="text-4xl sm:text-5xl hover:scale-110 transition-transform cursor-pointer mb-2 sm:mb-3">
                  🎁
                </Link>
                <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-gray-900">
                  Wishlists of {user?.email || 'User'}
                </h1>
              </div>
              <p className="text-base sm:text-lg lg:text-xl text-gray-600">
                View available wishlists
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center sm:items-end gap-3 sm:gap-4 sm:absolute sm:top-0 sm:right-0">
              <div className="w-full sm:w-auto">
                <UserSearch />
              </div>
              <AuthButton />
            </div>
          </div>
        </div>

        {/* Wishlists Grid */}
        {wishlists.length === 0 ? (
          <div className="text-center py-12 sm:py-20">
            <div className="text-4xl sm:text-6xl mb-4">📋</div>
            <h3 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-2">
              No wishlists available
            </h3>
            <p className="text-sm sm:text-base text-gray-600">
              This user has no public wishlists or wishlists you have access to
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
            {wishlists.map((wishlist) => (
              <WishlistCard
                key={wishlist._id.toString()}
                wishlist={wishlist}
                showOwner={true}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

