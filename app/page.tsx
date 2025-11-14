'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AuthButton from '@/components/AuthButton';
import UserSearch from '@/components/UserSearch';
import CreateWishlistModal from '@/components/CreateWishlistModal';
import WishlistCard from '@/components/WishlistCard';
import { useToast } from '@/components/ToastProvider';
import { IWishlist } from '@/models/Wishlist';

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const [ownedWishlists, setOwnedWishlists] = useState<IWishlist[]>([]);
  const [memberWishlists, setMemberWishlists] = useState<IWishlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'owned' | 'member'>('owned');

  useEffect(() => {
    async function fetchWishlists() {
      if (status === 'loading') return;
      
      if (!session?.user) {
        setLoading(false);
        return;
      }

      try {
        const response = await fetch('/api/wishlists', { cache: 'no-store' });
        const result = await response.json();
        
        if (result.success) {
          setOwnedWishlists(result.data?.owned || []);
          setMemberWishlists(result.data?.member || []);
        } else {
          showToast('Failed to load wishlists', 'error');
        }
      } catch (error) {
        console.error('Error fetching wishlists:', error);
        showToast('Failed to load wishlists', 'error');
      } finally {
        setLoading(false);
      }
    }

    fetchWishlists();
  }, [session, status, showToast]);


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

  if (!session?.user) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-b from-primary-100 to-white px-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <Link href="/" className="inline-block text-6xl mb-4 hover:scale-110 transition-transform cursor-pointer">
              🎁
            </Link>
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Welcome to Wishlist</h1>
            <p className="text-gray-600 mb-8">
              Sign in to view and manage your wishlists
            </p>
          </div>

          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <UserSearch />
          </div>

          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1 h-px bg-gray-300"></div>
            <span className="text-sm text-gray-500">or</span>
            <div className="flex-1 h-px bg-gray-300"></div>
          </div>

          <div className="text-center">
            <button
              onClick={() => router.push('/auth/signin')}
              className="bg-primary-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-700 transition-colors cursor-pointer"
            >
              Sign In
            </button>
          </div>
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
                  My Wishlists
                </h1>
              </div>
              <p className="text-base sm:text-lg lg:text-xl text-gray-600">
                Manage your wishlists and view items
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

        {/* Create Wishlist Button */}
        <div className="mb-6 sm:mb-8">
          <button
            onClick={() => setShowCreateModal(true)}
            className="bg-primary-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-700 transition-colors cursor-pointer"
          >
            + Create New Wishlist
          </button>
        </div>

        {/* Create Wishlist Modal */}
        <CreateWishlistModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
        />

        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex gap-4">
            <button
              onClick={() => setActiveTab('owned')}
              className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors cursor-pointer ${
                activeTab === 'owned'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Created by Me
            </button>
            <button
              onClick={() => setActiveTab('member')}
              className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors cursor-pointer ${
                activeTab === 'member'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Invited To
            </button>
          </nav>
        </div>

        {/* Owned Wishlists Tab */}
        {activeTab === 'owned' && (
          <>
            {ownedWishlists.length === 0 ? (
              <div className="text-center py-12 sm:py-20">
                <div className="text-4xl sm:text-6xl mb-4">📋</div>
                <h3 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-2">
                  No wishlists created yet
                </h3>
                <p className="text-sm sm:text-base text-gray-600">
                  Create your first wishlist to get started
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
                {ownedWishlists.map((wishlist) => (
                  <WishlistCard
                    key={wishlist._id.toString()}
                    wishlist={wishlist}
                    showOwner={false}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Member Wishlists Tab */}
        {activeTab === 'member' && (
          <>
            {memberWishlists.length === 0 ? (
              <div className="text-center py-12 sm:py-20">
                <div className="text-4xl sm:text-6xl mb-4">📋</div>
                <h3 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-2">
                  No invitations yet
                </h3>
                <p className="text-sm sm:text-base text-gray-600">
                  Wait for someone to invite you to their wishlist
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
                {memberWishlists.map((wishlist) => (
                  <WishlistCard
                    key={wishlist._id.toString()}
                    wishlist={wishlist}
                    showOwner={true}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
