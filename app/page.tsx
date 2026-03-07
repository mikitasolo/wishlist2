'use client';

import { useEffect, useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import Link from 'next/link';
import AuthButton from '@/components/AuthButton';
import UserSearch from '@/components/UserSearch';
import CreateWishlistModal from '@/components/CreateWishlistModal';
import WishlistCard from '@/components/WishlistCard';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import { IWishlist } from '@/models/Wishlist';

export default function Home() {
  const { data: session, status } = useSession();
  const { showToast } = useToast();
  const [ownedWishlists, setOwnedWishlists] = useState<IWishlist[]>([]);
  const [memberWishlists, setMemberWishlists] = useState<IWishlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'owned' | 'member'>('owned');

  useEffect(() => {
    async function fetchWishlists() {
      if (status === 'loading') return;

      if (status !== 'authenticated') {
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
  }, [status, showToast]);

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
      <main className="min-h-screen bg-gradient-to-b from-primary-100 to-white">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:py-6 lg:py-8 sm:px-6 lg:px-8">
          {/* Landing Section */}
          <div className="max-w-5xl mx-auto">
            {/* Hero Section */}
            <div className="text-center mb-12 sm:mb-16">
              <Link
                href="/"
                className="inline-block text-6xl sm:text-7xl mb-6 hover:scale-110 transition-transform cursor-pointer"
              >
                🎁
              </Link>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 mb-4 sm:mb-6">
                Never forget what you want
              </h1>
              <p className="text-lg sm:text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
                Organize your wishes, share with loved ones, and make gift-giving easier for
                everyone
              </p>
            </div>

            {/* Features Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 mb-12 sm:mb-16">
              <div className="bg-white rounded-xl shadow-md p-6 sm:p-8 text-center hover:shadow-lg transition-shadow">
                <div className="text-5xl sm:text-6xl mb-4">📝</div>
                <h3 className="text-xl sm:text-2xl font-semibold text-gray-900 mb-3">
                  Create Wishlists
                </h3>
                <p className="text-gray-600 text-sm sm:text-base">
                  Organize your wishes into multiple wishlists for different occasions or purposes
                </p>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6 sm:p-8 text-center hover:shadow-lg transition-shadow">
                <div className="text-5xl sm:text-6xl mb-4">👥</div>
                <h3 className="text-xl sm:text-2xl font-semibold text-gray-900 mb-3">
                  Share & Collaborate
                </h3>
                <p className="text-gray-600 text-sm sm:text-base">
                  Invite friends and family to view your wishlists and let them propose items
                </p>
              </div>

              <div className="bg-white rounded-xl shadow-md p-6 sm:p-8 text-center hover:shadow-lg transition-shadow">
                <div className="text-5xl sm:text-6xl mb-4">🎯</div>
                <h3 className="text-xl sm:text-2xl font-semibold text-gray-900 mb-3">
                  Track Items
                </h3>
                <p className="text-gray-600 text-sm sm:text-base">
                  Keep track of item availability, prices, and links all in one place
                </p>
              </div>
            </div>

            {/* CTA Section */}
            <div className="text-center bg-gradient-to-r from-primary-500 to-primary-600 rounded-xl shadow-lg p-8 sm:p-12 text-white mb-12 sm:mb-16">
              <h3 className="text-2xl sm:text-3xl font-bold mb-4">Ready to get started?</h3>
              <p className="text-lg sm:text-xl mb-2 opacity-90">
                Sign up in seconds - no password needed!
              </p>
              <p className="text-base sm:text-lg mb-6 opacity-80">
                ✨ Just enter your email and we'll send you a magic link to sign in
              </p>
              <button
                onClick={() => signIn()}
                className="bg-white text-primary-600 px-6 py-3 rounded-lg font-medium hover:bg-gray-100 transition-colors cursor-pointer inline-block"
              >
                Sign In / Sign Up
              </button>
            </div>

            {/* User Search Section */}
            <div className="bg-white rounded-xl shadow-md p-6 sm:p-8 mb-8">
              <h3 className="text-xl sm:text-2xl font-semibold text-gray-900 mb-4 text-center">
                Find someone's wishlist
              </h3>
              <p className="text-gray-600 mb-6 text-center text-sm sm:text-base">
                Search for users to view their public wishlists
              </p>
              <div className="max-w-md mx-auto">
                <UserSearch />
              </div>
            </div>
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
          <div className="relative mb-6 sm:mb-8">
            {/* Top row: Logo and action buttons */}
            <div className="flex items-center justify-between mb-4 gap-3">
              <Link
                href="/"
                className="text-4xl sm:text-5xl hover:scale-110 transition-transform cursor-pointer flex-shrink-0"
              >
                🎁
              </Link>
              <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                <AuthButton />
              </div>
            </div>
            
            {/* Title and description */}
            <div className="mb-4">
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 mb-2 break-words">
                My Wishlists
              </h1>
              <p className="text-sm sm:text-base lg:text-lg text-gray-600 break-words">
                Manage your wishlists and view items
              </p>
            </div>
            
            {/* Search bar */}
            <div className="w-full">
              <UserSearch />
            </div>
          </div>
        </div>

        {/* Create Wishlist Button */}
        <div className="mb-6 sm:mb-8">
          <Button onClick={() => setShowCreateModal(true)} size="lg">
            + Create New Wishlist
          </Button>
        </div>

        {/* Create Wishlist Modal */}
        <CreateWishlistModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />

        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex gap-1 sm:gap-4 overflow-x-auto pb-2 -mb-2 scrollbar-hide">
            <button
              onClick={() => setActiveTab('owned')}
              className={`px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm border-b-2 transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 ${
                activeTab === 'owned'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Created by Me
            </button>
            <button
              onClick={() => setActiveTab('member')}
              className={`px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm border-b-2 transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 ${
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
