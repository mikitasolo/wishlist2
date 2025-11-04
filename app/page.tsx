'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import WishlistItem from '@/components/WishlistItem';
import AuthButton from '@/components/AuthButton';
import { useToast } from '@/components/ToastProvider';
import { IItem } from '@/models/Item';

export default function Home() {
  const { data: session } = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const [items, setItems] = useState<IItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'available' | 'booked' | 'bookedByYou' | 'completed'>('all');

  useEffect(() => {
    fetchItems();

    // Poll for updates every 5 seconds when tab is active
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchItems(true); // Silent fetch (don't show loading state)
      }
    }, 5000);

    // Refresh when tab becomes visible again
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchItems(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup
    return () => {
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchItems = async (silent = false) => {
    try {
      const response = await fetch('/api/items', { cache: 'no-store' });
      const data = await response.json();
      if (data.success) {
        setItems(data.data);
      }
    } catch (error) {
      console.error('Error fetching items:', error);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const handleUpdateItem = async (id: string, updates: Partial<IItem>) => {
    try {
      const response = await fetch(`/api/items/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      });

      const data = await response.json();
      
      if (data.success) {
        setItems(items.map((item) => (item._id === id ? data.data : item)));
      } else if (response.status === 403 && data.error?.includes('archived')) {
        // User has been archived - show message and reload to log them out
        showToast(data.error, 'error');
        setTimeout(() => window.location.reload(), 2000);
      }
    } catch (error) {
      console.error('Error updating item:', error);
    }
  };

  const filteredItems = items.filter((item) => {
    if (filter === 'available') return item.status === 'available';
    if (filter === 'booked') return item.status === 'booked';
    if (filter === 'bookedByYou') return item.status === 'booked' && item.bookedBy === session?.user?.id;
    if (filter === 'completed') return item.status === 'completed';
    return true;
  });

  const stats = {
    total: items.length,
    available: items.filter((item) => item.status === 'available').length,
    booked: items.filter((item) => item.status === 'booked').length,
    bookedByYou: items.filter((item) => item.status === 'booked' && item.bookedBy === session?.user?.id).length,
    completed: items.filter((item) => item.status === 'completed').length,
  };

  return (
    <main className="min-h-screen">
      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-8">
            <div className="text-center flex-1">
              <h1 className="text-5xl font-bold text-gray-900 mb-4">
                My Wishlist
              </h1>
              <p className="text-xl text-gray-600">
                {session?.user?.role === 'admin' 
                  ? 'Manage your wishlist items'
                  : session?.user 
                    ? 'Book items you plan to gift'
                    : 'View wishlist items'}
              </p>
            </div>
            <div className="absolute top-8 right-8">
              <AuthButton />
            </div>
          </div>

          {/* Public mode message */}
          {!session?.user && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
              <p className="text-sm text-blue-800 text-center">
                👋 You're viewing in <strong>public mode</strong>. 
                <button 
                  onClick={() => router.push('/auth/signin')}
                  className="ml-2 text-blue-600 font-semibold hover:underline"
                >
                  Sign in
                </button>
                {' '}to book items you plan to gift.
              </p>
            </div>
          )}

          {/* Admin panel link */}
          {session?.user?.role === 'admin' && (
            <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 mb-8">
              <p className="text-sm text-primary-800 text-center">
                👑 You're signed in as <strong>admin</strong>. 
                <button 
                  onClick={() => router.push('/admin')}
                  className="ml-2 text-primary-600 font-semibold hover:underline"
                >
                  Go to Admin Panel
                </button>
              </p>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl p-4 shadow-md">
            <p className="text-sm text-gray-600 mb-1">Total Items</p>
            <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-md">
            <p className="text-sm text-gray-600 mb-1">Available</p>
            <p className="text-3xl font-bold text-blue-600">{stats.available}</p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-md">
            <p className="text-sm text-gray-600 mb-1">
              {session?.user && session.user.role !== 'admin' ? 'Booked by You' : 'Booked'}
            </p>
            <p className="text-3xl font-bold text-amber-600">
              {session?.user && session.user.role !== 'admin' ? stats.bookedByYou : stats.booked}
            </p>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-md">
            <p className="text-sm text-gray-600 mb-1">Completed</p>
            <p className="text-3xl font-bold text-green-600">{stats.completed}</p>
          </div>
        </div>

        {/* Filter Buttons */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-8">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
              filter === 'all'
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('available')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
              filter === 'available'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            Available
          </button>
          {/* Show "Booked by You" filter for regular users */}
          {session?.user && session.user.role !== 'admin' && (
            <button
              onClick={() => setFilter('bookedByYou')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
                filter === 'bookedByYou'
                  ? 'bg-amber-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-100'
              }`}
            >
              Booked by You
            </button>
          )}
          <button
            onClick={() => setFilter('completed')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap ${
              filter === 'completed'
                ? 'bg-green-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            Completed
          </button>
        </div>

        {/* Items Grid */}
        {loading ? (
          <div className="text-center py-20">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
            <p className="mt-4 text-gray-600">Loading items...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📦</div>
            <h3 className="text-2xl font-semibold text-gray-800 mb-2">
              No items found
            </h3>
            <p className="text-gray-600">
              {filter === 'all'
                ? 'No wishlist items yet. Check back soon!'
                : `No ${filter} items at the moment.`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredItems.map((item) => (
              <WishlistItem
                key={item._id}
                item={item}
                onUpdate={handleUpdateItem}
                isAuthenticated={!!session?.user}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

