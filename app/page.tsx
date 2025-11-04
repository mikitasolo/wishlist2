'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import WishlistItem from '@/components/WishlistItem';
import AuthButton from '@/components/AuthButton';
import { useToast } from '@/components/ToastProvider';
import { IItem } from '@/models/Item';
import { filterItems, sortItems, calculateStats, type FilterType, type SortType } from '@/lib/utils/itemFilters';
import { useFetchItems, useUpdateItem } from '@/lib/hooks/useItems';

export default function Home() {
  const { data: session } = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const [items, setItems] = useState<IItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [sortBy, setSortBy] = useState<SortType>('name-asc');

  const fetchItemsHook = useFetchItems();

  const fetchItems = useCallback(async (silent = false) => {
    try {
      const data = await fetchItemsHook(silent);
      setItems(data);
    } catch (error) {
      console.error('Error fetching items:', error);
      if (!silent) {
        showToast('Failed to load items', 'error');
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [fetchItemsHook, showToast]);

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
  }, [fetchItems]);

  const updateItemHook = useUpdateItem(
    (updatedItem) => {
      // Success callback - update with server response
      setItems((prevItems) =>
        prevItems.map((item) => (item._id === updatedItem._id ? updatedItem : item))
      );
    },
    (error) => {
      // Error callback - rollback and show error
      fetchItems(true);
      if (error.includes('archived')) {
        // User has been archived - show message and reload to log them out
        showToast(error, 'error');
        setTimeout(() => window.location.reload(), 2000);
      } else {
        showToast(error, 'error');
      }
    }
  );

  const handleUpdateItem = useCallback(async (id: string, updates: Partial<IItem>) => {
    // Optimistic update
    setItems((prevItems) => {
      const updated = prevItems.map((item) => (item._id === id ? { ...item, ...updates } : item));
      return updated;
    });

    // Call the hook - it will handle success/error via callbacks
    await updateItemHook(id, updates);
  }, [updateItemHook]);

  // Optimized stats calculation using utility
  const stats = useMemo(
    () => calculateStats(items, session?.user?.id),
    [items, session?.user?.id]
  );

  // Memoized filtered items using utility
  const filteredItems = useMemo(
    () => filterItems(items, filter, session?.user?.id),
    [items, filter, session?.user?.id]
  );

  // Memoized sorted items using utility
  const sortedItems = useMemo(
    () => sortItems(filteredItems, sortBy),
    [filteredItems, sortBy]
  );

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
                  className="ml-2 text-blue-600 font-semibold hover:underline cursor-pointer"
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
                  className="ml-2 text-primary-600 font-semibold hover:underline cursor-pointer"
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

        {/* Filter and Sort Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          {/* Filter Buttons */}
          <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer ${
              filter === 'all'
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('available')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer ${
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
              className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer ${
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
            className={`px-4 py-2 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer ${
              filter === 'completed'
                ? 'bg-green-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            Completed
          </button>
          </div>

          {/* Sort Dropdown */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <label htmlFor="sort" className="text-sm font-medium text-gray-700 whitespace-nowrap">
              Sort by:
            </label>
            <select
              id="sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="pl-3 pr-12 py-2 border border-gray-300 rounded-lg bg-white text-gray-700 font-medium focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.5em_1.5em] bg-[right_0.5rem_center] bg-no-repeat"
            >
              <option value="name-asc">Name (A-Z)</option>
              <option value="name-desc">Name (Z-A)</option>
              <option value="price-asc">Price (Low to High)</option>
              <option value="price-desc">Price (High to Low)</option>
            </select>
          </div>
        </div>

        {/* Price Disclaimer */}
        <p className="text-xs text-gray-500 text-center mb-6 italic">
          ⚠️ Prices are approximate and may not reflect actual current prices
        </p>

        {/* Items Grid */}
        {loading ? (
          <div className="text-center py-20">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
            <p className="mt-4 text-gray-600">Loading items...</p>
          </div>
        ) : sortedItems.length === 0 ? (
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
            {sortedItems.map((item) => (
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

