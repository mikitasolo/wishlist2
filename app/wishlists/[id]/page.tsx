'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import WishlistItem from '@/components/WishlistItem';
import EditItemModal from '@/components/EditItemModal';
import AddItemModal from '@/components/AddItemModal';
import AuthButton from '@/components/AuthButton';
import UserSearch from '@/components/UserSearch';
import { useToast } from '@/components/ToastProvider';
import { IItem } from '@/models/Item';
import { IWishlist } from '@/models/Wishlist';
import { filterItems, sortItems, calculateStats, type FilterType, type SortType } from '@/lib/utils/itemFilters';
import { useFetchItems, useUpdateItem, useCreateItem } from '@/lib/hooks/useItems';

type TabType = 'items' | 'users';

interface WishlistMember {
  _id: string;
  user: {
    _id: string;
    email: string;
  };
  role: 'owner' | 'member';
  createdAt: string;
}

export default function WishlistDetail() {
  const { data: session } = useSession();
  const router = useRouter();
  const params = useParams();
  const { showToast } = useToast();
  const wishlistId = params?.id as string;
  
  const [wishlist, setWishlist] = useState<IWishlist | null>(null);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [items, setItems] = useState<IItem[]>([]);
  const [members, setMembers] = useState<WishlistMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('items');
  const [filter, setFilter] = useState<FilterType>('all');
  const [sortBy, setSortBy] = useState<SortType>('name-asc');
  const [itemToEdit, setItemToEdit] = useState<IItem | null>(null);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [isInviting, setIsInviting] = useState(false);

  const fetchItemsHook = useFetchItems();

  // Fetch wishlist and determine role
  useEffect(() => {
    async function fetchWishlist() {
      if (!wishlistId) return;

      try {
        const response = await fetch(`/api/wishlists/${wishlistId}`, { cache: 'no-store' });
        const result = await response.json();
        
        if (result.success) {
          const w = result.data as IWishlist & { userRole?: 'owner' | 'member' | null; ownerEmail?: string | null };
          setWishlist(w);
          setOwnerEmail(w.ownerEmail || null);
          
          // Check user role from API response
          const userRole = w.userRole;
          setIsOwner(userRole === 'owner');
          setIsMember(userRole === 'member');
        } else {
          showToast('Failed to load wishlist', 'error');
          router.push('/');
        }
      } catch (error) {
        console.error('Error fetching wishlist:', error);
        showToast('Failed to load wishlist', 'error');
        router.push('/');
      } finally {
        setLoading(false);
      }
    }

    if (session !== undefined) {
      fetchWishlist();
    }
  }, [wishlistId, session, router, showToast]);

  // Fetch members (only for owners)
  useEffect(() => {
    async function fetchMembers() {
      if (!wishlistId || !isOwner) return;

      try {
        const response = await fetch(`/api/wishlists/${wishlistId}/members`, { cache: 'no-store' });
        const result = await response.json();
        
        if (result.success) {
          setMembers(result.data || []);
        }
      } catch (error) {
        console.error('Error fetching members:', error);
      }
    }

    if (isOwner && activeTab === 'users') {
      fetchMembers();
    }
  }, [wishlistId, isOwner, activeTab]);


  const fetchItems = useCallback(async (silent = false) => {
    if (!wishlistId) return;

    try {
      const data = await fetchItemsHook(wishlistId);
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
  }, [fetchItemsHook, wishlistId, showToast]);

  useEffect(() => {
    if (wishlistId && activeTab === 'items') {
      fetchItems();

      // Poll for updates every 5 seconds when tab is active
      const pollInterval = setInterval(() => {
        if (document.visibilityState === 'visible') {
          fetchItems(true);
        }
      }, 5000);

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          fetchItems(true);
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        clearInterval(pollInterval);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [wishlistId, activeTab, fetchItems]);

  const createItemHook = useCreateItem(
    (newItem) => {
      setItems((prevItems) => [newItem, ...prevItems]);
      showToast('Item added successfully', 'success');
    },
    (error) => {
      showToast(error, 'error');
    }
  );

  const updateItemHook = useUpdateItem(
    (updatedItem) => {
      setItems((prevItems) =>
        prevItems.map((item) =>
          item._id.toString() === updatedItem._id.toString() ? updatedItem : item
        )
      );
    },
    (error) => {
      fetchItems(true);
      showToast(error, 'error');
    }
  );

  const handleCreateItem = useCallback(async (itemData: {
    name: string;
    imageUrl: string;
    priceInCents?: number;
    link?: string;
  }) => {
    if (!wishlistId) return;
    const createFn = createItemHook;
    await createFn(wishlistId, itemData);
    setShowAddItemModal(false);
  }, [createItemHook, wishlistId]);

  const handleUpdateItem = useCallback(async (id: string, updates: Partial<IItem>) => {
    setItems((prevItems) =>
      prevItems.map((item) => (item._id.toString() === id ? { ...item, ...updates } : item))
    );
    await updateItemHook(id, updates);
  }, [updateItemHook]);

  const handleEditItem = useCallback((item: IItem) => {
    setItemToEdit(item);
  }, []);

  const handleSaveEdit = useCallback(async (updates: Partial<IItem>) => {
    if (!itemToEdit) return;
    const itemId = itemToEdit._id.toString();
    await handleUpdateItem(itemId, updates);
    setItemToEdit(null);
  }, [itemToEdit, handleUpdateItem]);

  const handleInviteUser = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wishlistId || !inviteEmail.trim()) return;

    setIsInviting(true);
    try {
      const response = await fetch(`/api/wishlists/${wishlistId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });

      const result = await response.json();

      if (result.success) {
        showToast('Invitation sent successfully', 'success');
        setInviteEmail('');
        // Refresh members list
        const membersResponse = await fetch(`/api/wishlists/${wishlistId}/members`, { cache: 'no-store' });
        const membersResult = await membersResponse.json();
        if (membersResult.success) {
          setMembers(membersResult.data || []);
        }
      } else {
        showToast(result.error || 'Failed to send invitation', 'error');
      }
    } catch (error) {
      console.error('Error inviting user:', error);
      showToast('Failed to send invitation', 'error');
    } finally {
      setIsInviting(false);
    }
  }, [wishlistId, inviteEmail, showToast]);

  const handleKickMember = useCallback(async (memberId: string, memberEmail: string) => {
    if (!wishlistId || !confirm(`Are you sure you want to remove ${memberEmail} from this wishlist?`)) return;

    try {
      const response = await fetch(`/api/wishlists/${wishlistId}/members/${memberId}`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (result.success) {
        showToast('Member removed successfully', 'success');
        // Refresh members list
        const membersResponse = await fetch(`/api/wishlists/${wishlistId}/members`, { cache: 'no-store' });
        const membersResult = await membersResponse.json();
        if (membersResult.success) {
          setMembers(membersResult.data || []);
        }
      } else {
        showToast(result.error || 'Failed to remove member', 'error');
      }
    } catch (error) {
      console.error('Error removing member:', error);
      showToast('Failed to remove member', 'error');
    }
  }, [wishlistId, showToast]);

  const handleLeaveWishlist = useCallback(async () => {
    if (!wishlistId || !confirm('Are you sure you want to leave this wishlist? All your bookings will be removed.')) return;

    try {
      const response = await fetch(`/api/wishlists/${wishlistId}/members/me`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (result.success) {
        showToast('Left wishlist successfully', 'success');
        router.push('/');
      } else {
        showToast(result.error || 'Failed to leave wishlist', 'error');
      }
    } catch (error) {
      console.error('Error leaving wishlist:', error);
      showToast('Failed to leave wishlist', 'error');
    }
  }, [wishlistId, router, showToast]);

  const stats = useMemo(
    () => calculateStats(items, session?.user?.id),
    [items, session?.user?.id]
  );

  const filteredItems = useMemo(
    () => filterItems(items, filter, session?.user?.id),
    [items, filter, session?.user?.id]
  );

  const sortedItems = useMemo(
    () => sortItems(filteredItems, sortBy),
    [filteredItems, sortBy]
  );

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
          <p className="mt-4 text-sm text-gray-600">Loading wishlist...</p>
        </div>
      </main>
    );
  }

  if (!wishlist) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Wishlist not found</h2>
          <Link href="/" className="text-primary-600 hover:underline">
            Go back to wishlists
          </Link>
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
                  {wishlist.name}
                  {ownerEmail && (
                    <>
                      {' '}by{' '}
                      {isOwner ? (
                        <span className="text-gray-500">you</span>
                      ) : (
                        <Link 
                          href={`/users/${wishlist.owner}`} 
                          className="text-primary-600 hover:text-primary-700 hover:underline cursor-pointer"
                        >
                          {ownerEmail}
                        </Link>
                      )}
                    </>
                  )}
                </h1>
              </div>
              {wishlist.description && (
                <p className="text-base sm:text-lg lg:text-xl text-gray-600">
                  {wishlist.description}
                </p>
              )}
            </div>
            <div className="flex flex-col sm:flex-row items-center sm:items-end gap-3 sm:gap-4 sm:absolute sm:top-0 sm:right-0">
              <div className="w-full sm:w-auto">
                <UserSearch />
              </div>
              <AuthButton />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex gap-4">
            <button
              onClick={() => setActiveTab('items')}
              className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors cursor-pointer ${
                activeTab === 'items'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Items
            </button>
            {isOwner && (
              <button
                onClick={() => setActiveTab('users')}
                className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors cursor-pointer ${
                  activeTab === 'users'
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Users
              </button>
            )}
          </nav>
        </div>

        {/* Items Tab */}
        {activeTab === 'items' && (
          <>
            {/* Stats */}
            <div className={`grid ${isMember ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2 md:grid-cols-3'} gap-3 sm:gap-4 mb-6 sm:mb-8`}>
              <div className="bg-white rounded-xl p-3 sm:p-4 shadow-md">
                <p className="text-xs sm:text-sm text-gray-600 mb-1">Total Items</p>
                <p className="text-2xl sm:text-3xl font-bold text-gray-900">{stats.total}</p>
              </div>
              <div className="bg-white rounded-xl p-3 sm:p-4 shadow-md">
                <p className="text-xs sm:text-sm text-gray-600 mb-1">Available</p>
                <p className="text-2xl sm:text-3xl font-bold text-blue-600">{stats.available}</p>
              </div>
              {isMember && (
                <div className="bg-white rounded-xl p-3 sm:p-4 shadow-md">
                  <p className="text-xs sm:text-sm text-gray-600 mb-1">Booked by You</p>
                  <p className="text-2xl sm:text-3xl font-bold text-amber-600">{stats.bookedByYou}</p>
                </div>
              )}
              <div className="bg-white rounded-xl p-3 sm:p-4 shadow-md">
                <p className="text-xs sm:text-sm text-gray-600 mb-1">Completed</p>
                <p className="text-2xl sm:text-3xl font-bold text-green-600">{stats.completed}</p>
              </div>
            </div>

            {/* Filter and Sort Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-6 sm:mb-8">
              <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0">
                <button
                  onClick={() => setFilter('all')}
                  className={`px-3 sm:px-4 py-2 rounded-lg text-sm sm:text-base font-medium transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${
                    filter === 'all'
                      ? 'bg-primary-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setFilter('available')}
                  className={`px-3 sm:px-4 py-2 rounded-lg text-sm sm:text-base font-medium transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${
                    filter === 'available'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  Available
                </button>
                {isMember && (
                  <button
                    onClick={() => setFilter('bookedByYou')}
                    className={`px-3 sm:px-4 py-2 rounded-lg text-sm sm:text-base font-medium transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${
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
                  className={`px-3 sm:px-4 py-2 rounded-lg text-sm sm:text-base font-medium transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${
                    filter === 'completed'
                      ? 'bg-green-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  Completed
                </button>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <label htmlFor="sort" className="text-xs sm:text-sm font-medium text-gray-700 whitespace-nowrap">
                  Sort by:
                </label>
                <select
                  id="sort"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="pl-3 pr-8 sm:pr-12 py-2 text-sm sm:text-base border border-gray-300 rounded-lg bg-white text-gray-700 font-medium focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.5em_1.5em] bg-[right_0.5rem_center] bg-no-repeat cursor-pointer"
                >
                  <option value="name-asc">Name (A-Z)</option>
                  <option value="name-desc">Name (Z-A)</option>
                  <option value="price-asc">Price (Low to High)</option>
                  <option value="price-desc">Price (High to Low)</option>
                </select>
              </div>
            </div>

            {/* Add Item Button */}
            {isOwner && (
              <div className="mb-6 sm:mb-8">
                <button
                  onClick={() => setShowAddItemModal(true)}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors text-sm sm:text-base cursor-pointer"
                >
                  + Add Item
                </button>
              </div>
            )}

            {/* Items Grid */}
            {sortedItems.length === 0 ? (
              <div className="text-center py-12 sm:py-20">
                <div className="text-4xl sm:text-6xl mb-4">📦</div>
                <h3 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-2">
                  No items found
                </h3>
                <p className="text-sm sm:text-base text-gray-600 px-4">
                  {filter === 'all'
                    ? 'No wishlist items yet.'
                    : `No ${filter} items at the moment.`}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
                {sortedItems.map((item) => (
                  <WishlistItem
                    key={item._id.toString()}
                    item={item}
                    onUpdate={handleUpdateItem}
                    onEdit={isOwner ? handleEditItem : undefined}
                    isAuthenticated={!!session?.user}
                    isOwner={isOwner}
                    isMember={isMember}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            {isOwner && (
              <div className="bg-white rounded-xl p-6 shadow-md">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Invite User</h2>
                <form onSubmit={handleInviteUser} className="flex gap-2">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="user@example.com"
                    required
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                    disabled={isInviting}
                  />
                  <button
                    type="submit"
                    disabled={isInviting}
                    className="px-6 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isInviting ? 'Inviting...' : 'Invite'}
                  </button>
                </form>
              </div>
            )}

            <div className="bg-white rounded-xl shadow-md overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-xl font-bold text-gray-900">Members</h2>
              </div>
              <div className="divide-y divide-gray-200">
                {members.map((member) => {
                  const memberUserId = String(member.user._id);
                  const isCurrentUser = memberUserId === session?.user?.id;
                  const isOwnerMember = member.role === 'owner';
                  
                  return (
                    <div key={member._id} className="px-6 py-4 flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/users/${memberUserId}`}
                            className="font-medium text-gray-900 hover:text-primary-600 transition-colors cursor-pointer"
                          >
                            {member.user.email}
                          </Link>
                          {isOwnerMember && (
                            <span className="px-2 py-1 text-xs font-semibold rounded-full bg-primary-100 text-primary-800">
                              Owner
                            </span>
                          )}
                          {!isOwnerMember && (
                            <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">
                              Member
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isOwnerMember && isCurrentUser && (
                          <span className="text-sm text-gray-500">You</span>
                        )}
                        {isOwner && !isOwnerMember && (
                          <button
                            onClick={() => handleKickMember(member._id, member.user.email)}
                            className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                          >
                            Remove
                          </button>
                        )}
                        {isMember && !isOwner && isCurrentUser && (
                          <button
                            onClick={handleLeaveWishlist}
                            className="px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                          >
                            Leave
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* Modals */}
      {showAddItemModal && (
        <AddItemModal
          isOpen={showAddItemModal}
          onClose={() => setShowAddItemModal(false)}
          onAdd={handleCreateItem}
        />
      )}

      {itemToEdit && (
        <EditItemModal
          isOpen={!!itemToEdit}
          onClose={() => setItemToEdit(null)}
          onSave={handleSaveEdit}
          item={itemToEdit}
        />
      )}
    </main>
  );
}
