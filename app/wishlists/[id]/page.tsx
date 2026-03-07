'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import WishlistItem from '@/components/WishlistItem';
import EditItemModal from '@/components/EditItemModal';
import AddItemModal from '@/components/AddItemModal';
import ProposeItemModal from '@/components/ProposeItemModal';
import ReviewItemModal from '@/components/ReviewItemModal';
import AuthButton from '@/components/AuthButton';
import UserSearch from '@/components/UserSearch';
import ConfirmDialog from '@/components/ConfirmDialog';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import { ApiItem } from '@/types/api';
import { IWishlist } from '@/models/Wishlist';
import {
  sortItems,
  calculateStats,
  filterItemsMulti,
  type FilterOption,
  type SortType,
} from '@/lib/utils/itemFilters';
import FilterDropdown from '@/components/FilterDropdown';
import { useFetchItems, useUpdateItem, useCreateItem, useDeleteItem } from '@/lib/hooks/useItems';

type TabType = 'items' | 'users' | 'settings';

interface WishlistMember {
  _id: string;
  user: {
    _id: string;
    email: string;
  };
  role: 'owner' | 'admin' | 'member'; // 'owner' is only used when representing the original owner from wishlist.owner
  createdAt: string;
}

export default function WishlistDetail() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const { showToast } = useToast();
  const wishlistId = typeof params?.id === 'string' ? params.id : null;

  const [wishlist, setWishlist] = useState<IWishlist | null>(null);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [items, setItems] = useState<ApiItem[]>([]);
  const [members, setMembers] = useState<WishlistMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('items');
  const [selectedFilters, setSelectedFilters] = useState<FilterOption[]>([]);
  const [sortBy, setSortBy] = useState<SortType>('name-asc');
  const [itemToEdit, setItemToEdit] = useState<ApiItem | null>(null);
  const [itemToReview, setItemToReview] = useState<ApiItem | null>(null);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showProposeItemModal, setShowProposeItemModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [isInviting, setIsInviting] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    name: '',
    description: '',
    isPublic: true,
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: 'member' | 'leave' | 'wishlist';
    memberId?: string;
    memberEmail?: string;
  } | null>(null);
  const [isDeletingWishlist, setIsDeletingWishlist] = useState(false);
  const settingsFormDirtyRef = useRef(false);

  const fetchItemsHook = useFetchItems();

  // Get filter options based on user role
  const getFilterOptions = useCallback((): FilterOption[] => {
    if (isOwner) {
      return ['all', 'draft', 'available', 'completed', 'proposed'];
    } else if (isMember) {
      return ['all', 'available', 'bookedByMe', 'bookedByOthers', 'completed', 'proposedByMe'];
    } else {
      return ['all', 'available', 'completed'];
    }
  }, [isOwner, isMember]);

  // Get default filter values based on user role
  const getDefaultFilters = useCallback((): FilterOption[] => {
    if (isOwner) {
      return ['draft', 'available', 'proposed'];
    } else if (isMember) {
      return ['available', 'bookedByMe', 'proposedByMe'];
    } else {
      return ['available'];
    }
  }, [isOwner, isMember]);

  // Get localStorage key based on user role
  const getFilterStorageKey = useCallback((): string => {
    if (isOwner) {
      return 'wishlist-filters-owner';
    } else if (isMember) {
      return 'wishlist-filters-member';
    } else {
      return 'wishlist-filters-nonmember';
    }
  }, [isOwner, isMember]);

  // Get localStorage key for sort (single key for all roles)
  const getSortStorageKey = useCallback((): string => {
    return 'wishlist-sort';
  }, []);

  // Load filters from localStorage or use defaults
  // Only run after we've loaded the wishlist and determined the role
  useEffect(() => {
    // Wait until loading is complete and we have a wishlist
    if (!wishlistId || loading || !wishlist) return;

    const storageKey = getFilterStorageKey();
    const stored = localStorage.getItem(storageKey);

    if (stored) {
      try {
        const parsed = JSON.parse(stored) as FilterOption[];
        const validOptions = getFilterOptions();
        // Validate stored filters are still valid for current role
        const validFilters = parsed.filter((f) => validOptions.includes(f));
        if (validFilters.length > 0) {
          setSelectedFilters(validFilters);
          return;
        }
      } catch (e) {
        // Invalid stored data, use defaults
      }
    }

    // Use defaults if no stored value or invalid
    setSelectedFilters(getDefaultFilters());
  }, [
    wishlistId,
    loading,
    wishlist,
    isOwner,
    isMember,
    getFilterOptions,
    getDefaultFilters,
    getFilterStorageKey,
  ]);

  // Save filters to localStorage when they change
  // Only save after initial load is complete to avoid overwriting with defaults
  useEffect(() => {
    // Don't save during initial load
    if (!wishlistId || loading || !wishlist || selectedFilters.length === 0) return;

    const storageKey = getFilterStorageKey();
    localStorage.setItem(storageKey, JSON.stringify(selectedFilters));
  }, [wishlistId, loading, wishlist, selectedFilters, getFilterStorageKey]);

  // Load sort from localStorage or use default
  // Only run after we've loaded the wishlist
  useEffect(() => {
    // Wait until loading is complete and we have a wishlist
    if (!wishlistId || loading || !wishlist) return;

    const storageKey = getSortStorageKey();
    const stored = localStorage.getItem(storageKey);

    if (stored) {
      try {
        const parsed = stored as SortType;
        // Validate stored sort value is valid
        const validSortTypes: SortType[] = [
          'name-asc',
          'name-desc',
          'price-asc',
          'price-desc',
          'date-asc',
          'date-desc',
        ];
        if (validSortTypes.includes(parsed)) {
          setSortBy(parsed);
          return;
        }
      } catch (e) {
        // Invalid stored data, use default
      }
    }

    // Use default if no stored value or invalid
    setSortBy('name-asc');
  }, [wishlistId, loading, wishlist, getSortStorageKey]);

  // Save sort to localStorage when it changes
  // Only save after initial load is complete
  useEffect(() => {
    // Don't save during initial load
    if (!wishlistId || loading || !wishlist) return;

    const storageKey = getSortStorageKey();
    localStorage.setItem(storageKey, sortBy);
  }, [wishlistId, loading, wishlist, sortBy, getSortStorageKey]);

  // Fetch wishlist and determine role
  useEffect(() => {
    async function fetchWishlist() {
      if (!wishlistId) return;

      try {
        const response = await fetch(`/api/wishlists/${wishlistId}`, { cache: 'no-store' });
        const result = await response.json();

        if (result.success && result.data) {
          const w = result.data;
          // Type guard to check if data has extended properties
          if (typeof w === 'object' && w !== null && 'name' in w && 'owner' in w) {
            // Type guard function to check if it's an IWishlist
            const wishlistData = w as IWishlist;
            setWishlist(wishlistData);

            // Check for extended properties
            const hasExtendedProps = 'userRole' in w || 'ownerEmail' in w;
            if (hasExtendedProps) {
              const extendedWishlist = w as IWishlist & {
                userRole?: 'owner' | 'admin' | 'member' | null;
                ownerEmail?: string | null;
              };
              setOwnerEmail(
                'ownerEmail' in extendedWishlist ? extendedWishlist.ownerEmail || null : null
              );

              // Check user role from API response
              const userRole = 'userRole' in extendedWishlist ? extendedWishlist.userRole : null;
              setIsOwner(userRole === 'owner');
              setIsAdmin(userRole === 'admin');
              setIsMember(userRole === 'member' || userRole === 'admin');
            }

            if (!settingsFormDirtyRef.current) {
              setSettingsForm({
                name: wishlistData.name,
                description: wishlistData.description || '',
                isPublic: wishlistData.isPublic,
              });
            }

            // Only set loading to false after successfully setting the wishlist
            // This prevents the "wishlist not found" flash
            setLoading(false);
          } else {
            setLoading(false);
            showToast('Failed to load wishlist', 'error');
            router.push('/');
          }
        } else {
          setLoading(false);
          showToast('Failed to load wishlist', 'error');
          router.push('/');
        }
      } catch (error) {
        console.error('Error fetching wishlist:', error);
        setLoading(false);
        showToast('Failed to load wishlist', 'error');
        router.push('/');
      }
    }

    if (status !== 'loading') {
      fetchWishlist();
    }
  }, [wishlistId, status, router, showToast]);

  // Fetch members (only for owners and admins)
  useEffect(() => {
    async function fetchMembers() {
      if (!wishlistId || (!isOwner && !isAdmin)) return;

      setLoadingMembers(true);
      try {
        const response = await fetch(`/api/wishlists/${wishlistId}/members`, { cache: 'no-store' });
        const result = await response.json();

        if (result.success) {
          setMembers(result.data || []);
        }
      } catch (error) {
        console.error('Error fetching members:', error);
      } finally {
        setLoadingMembers(false);
      }
    }

    if ((isOwner || isAdmin) && activeTab === 'users') {
      fetchMembers();
    }
  }, [wishlistId, isOwner, isAdmin, activeTab]);

  const fetchItems = useCallback(
    async (silent = false) => {
      if (!wishlistId) return;

      if (!silent) {
        setLoadingItems(true);
      }

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
          setLoadingItems(false);
        }
      }
    },
    [fetchItemsHook, wishlistId, showToast]
  );

  useEffect(() => {
    if (wishlistId && activeTab === 'items') {
      // Reset loading state when switching to items tab
      setLoadingItems(true);
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
    } else if (activeTab !== 'items') {
      // Reset loading state when switching away from items tab
      setLoadingItems(false);
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
    () => {
      // Refetch items to get properly sorted and enriched list with priceInUsdCents
      fetchItems(true);
    },
    (error) => {
      fetchItems(true);
      showToast(error, 'error');
    }
  );

  // Update hook dependencies when fetchItems changes
  // Note: updateItemHook is created by useUpdateItem hook, so we can't directly add dependencies
  // But fetchItems is stable (useCallback), so this should work fine

  const deleteItemHook = useDeleteItem(
    () => {
      showToast('Item deleted successfully', 'success');
    },
    (error) => {
      showToast(error, 'error');
    }
  );

  const handleCreateItem = useCallback(
    async (itemData: {
      name: string;
      imageUrl?: string | null;
      price?: { value: number; currency: string } | null;
      link?: string | null;
      notes?: string | null;
      status?: 'draft' | 'available';
    }) => {
      if (!wishlistId) return;
      const createFn = createItemHook;
      await createFn(wishlistId, itemData);
      setShowAddItemModal(false);
    },
    [createItemHook, wishlistId]
  );

  const handleUpdateItem = useCallback(
    async (id: string, updates: Partial<ApiItem>) => {
      setItems((prevItems) =>
        prevItems.map((item) => {
          if (item._id !== id) return item;
          const optimistic = { ...item, ...updates };
          if (updates.status === 'booked' && session?.user?.id) {
            optimistic.bookedBy = session.user.id;
          } else if (updates.status === 'available' && item.status === 'booked') {
            optimistic.bookedBy = null;
          }
          return optimistic;
        })
      );
      await updateItemHook(id, updates);
    },
    [updateItemHook, session?.user?.id]
  );

  const handleProposeItem = useCallback(
    async (itemData: {
      name: string;
      imageUrl?: string | null;
      price?: { value: number; currency: string } | null;
      link?: string | null;
      notes?: string | null;
      status: 'proposed';
    }) => {
      if (!wishlistId) return;
      try {
        const response = await fetch(`/api/wishlists/${wishlistId}/items`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(itemData),
        });

        const result = await response.json();

        if (result.success) {
          setItems((prevItems) => [result.data, ...prevItems]);
          showToast('Item proposed successfully', 'success');
          setShowProposeItemModal(false);
        } else {
          showToast(result.error || 'Failed to propose item', 'error');
        }
      } catch (error) {
        console.error('Error proposing item:', error);
        showToast('Failed to propose item', 'error');
      }
    },
    [wishlistId, showToast]
  );

  const handleReviewItem = useCallback(
    async (updates: Partial<ApiItem> & { status: 'draft' | 'available' }) => {
      if (!itemToReview) return;
      const itemId = itemToReview._id;
      await handleUpdateItem(itemId, updates);
      setItemToReview(null);
      showToast('Item approved successfully', 'success');
    },
    [itemToReview, handleUpdateItem, showToast]
  );

  const handleDeleteProposedItem = useCallback(async () => {
    if (!itemToReview) return;
    const itemId = itemToReview._id;
    await deleteItemHook(itemId);
    setItems((prevItems) => prevItems.filter((item) => item._id !== itemId));
    setItemToReview(null);
    showToast('Proposed item deleted', 'success');
  }, [itemToReview, deleteItemHook, showToast]);

  const handleEditItem = useCallback((item: ApiItem) => {
    setItemToEdit(item);
  }, []);

  const handleSaveEdit = useCallback(
    async (updates: Partial<ApiItem>) => {
      if (!itemToEdit) return;
      const itemId = itemToEdit._id;
      await handleUpdateItem(itemId, updates);
      setItemToEdit(null);
    },
    [itemToEdit, handleUpdateItem]
  );

  const handleDeleteItem = useCallback(async () => {
    if (!itemToEdit) return;
    const itemId = itemToEdit._id;
    await deleteItemHook(itemId);
    setItems((prevItems) => prevItems.filter((item) => item._id !== itemId));
    setItemToEdit(null);
  }, [itemToEdit, deleteItemHook]);

  const handleInviteUser = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!wishlistId || !inviteEmail.trim()) return;

      setIsInviting(true);
      try {
        const response = await fetch(`/api/wishlists/${wishlistId}/members`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
        });

        const result = await response.json();

        if (result.success) {
          showToast('Invitation sent successfully', 'success');
          setInviteEmail('');
          setInviteRole('member');
          // Refresh members list
          const membersResponse = await fetch(`/api/wishlists/${wishlistId}/members`, {
            cache: 'no-store',
          });
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
    },
    [wishlistId, inviteEmail, inviteRole, showToast]
  );

  const handleKickMember = useCallback((memberId: string, memberEmail: string) => {
    setDeleteConfirm({
      type: 'member',
      memberId,
      memberEmail,
    });
  }, []);

  const confirmKickMember = useCallback(async () => {
    if (!wishlistId || !deleteConfirm || deleteConfirm.type !== 'member' || !deleteConfirm.memberId)
      return;

    try {
      const response = await fetch(
        `/api/wishlists/${wishlistId}/members/${deleteConfirm.memberId}`,
        {
          method: 'DELETE',
        }
      );

      const result = await response.json();

      if (result.success) {
        showToast('Member removed successfully', 'success');
        // Refresh members list
        const membersResponse = await fetch(`/api/wishlists/${wishlistId}/members`, {
          cache: 'no-store',
        });
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
    } finally {
      setDeleteConfirm(null);
    }
  }, [wishlistId, deleteConfirm, showToast]);

  const handleLeaveWishlist = useCallback(() => {
    setDeleteConfirm({
      type: 'leave',
    });
  }, []);

  const confirmLeaveWishlist = useCallback(async () => {
    if (!wishlistId || !deleteConfirm || deleteConfirm.type !== 'leave') return;

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
    } finally {
      setDeleteConfirm(null);
    }
  }, [wishlistId, deleteConfirm, router, showToast]);

  const handleDeleteWishlist = useCallback(() => {
    setDeleteConfirm({
      type: 'wishlist',
    });
  }, []);

  const confirmDeleteWishlist = useCallback(async () => {
    if (!wishlistId || !deleteConfirm || deleteConfirm.type !== 'wishlist') return;

    setIsDeletingWishlist(true);
    try {
      const response = await fetch(`/api/wishlists/${wishlistId}`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (result.success) {
        showToast('Wishlist deleted successfully', 'success');
        router.push('/');
      } else {
        showToast(result.error || 'Failed to delete wishlist', 'error');
      }
    } catch (error) {
      console.error('Error deleting wishlist:', error);
      showToast('Failed to delete wishlist', 'error');
    } finally {
      setDeleteConfirm(null);
      setIsDeletingWishlist(false);
    }
  }, [wishlistId, deleteConfirm, router, showToast]);

  const stats = useMemo(() => calculateStats(items, session?.user?.id), [items, session?.user?.id]);

  const filteredItems = useMemo(
    () =>
      filterItemsMulti(
        items,
        selectedFilters,
        session?.user?.id,
        isOwner || (!isOwner && !isMember) // Include booked in "available" for owner and non-member
      ),
    [items, selectedFilters, session?.user?.id, isOwner, isMember]
  );

  const sortedItems = useMemo(() => sortItems(filteredItems, sortBy), [filteredItems, sortBy]);

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
                {isMember && !isOwner && (
                  <Button
                    variant="danger"
                    onClick={handleLeaveWishlist}
                    className="whitespace-nowrap text-xs sm:text-sm"
                    size="sm"
                  >
                    Leave
                  </Button>
                )}
                <AuthButton />
              </div>
            </div>

            {/* Title and description */}
            <div className="mb-4">
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-gray-900 mb-2 break-words">
                {wishlist.name}
              </h1>
              {ownerEmail && (
                <p className="text-sm sm:text-base text-gray-600">
                  by{' '}
                  {isOwner ? (
                    <span className="text-gray-500">you</span>
                  ) : (
                    <Link
                      href={`/users/${wishlist.owner}`}
                      className="text-primary-600 hover:text-primary-700 hover:underline cursor-pointer break-all"
                    >
                      {ownerEmail}
                    </Link>
                  )}
                </p>
              )}
              {wishlist.description && (
                <p className="text-sm sm:text-base lg:text-lg text-gray-600 mt-2 break-words">
                  {wishlist.description}
                </p>
              )}
            </div>

            {/* Search bar */}
            <div className="w-full">
              <UserSearch />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex gap-1 sm:gap-4 overflow-x-auto pb-2 -mb-2 scrollbar-hide">
            <button
              onClick={() => setActiveTab('items')}
              className={`px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm border-b-2 transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 ${
                activeTab === 'items'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Items
            </button>
            {(isOwner || isAdmin) && (
              <>
                <button
                  onClick={() => setActiveTab('users')}
                  className={`px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm border-b-2 transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 ${
                    activeTab === 'users'
                      ? 'border-primary-600 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Users
                </button>
                <button
                  onClick={() => setActiveTab('settings')}
                  className={`px-3 sm:px-4 py-2 font-medium text-xs sm:text-sm border-b-2 transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 ${
                    activeTab === 'settings'
                      ? 'border-primary-600 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Settings
                </button>
              </>
            )}
          </nav>
        </div>

        {/* Items Tab */}
        {activeTab === 'items' && (
          <>
            {/* Stats */}
            <div
              className={`grid ${isOwner ? 'grid-cols-2 md:grid-cols-4 lg:grid-cols-5' : isMember ? 'grid-cols-2 md:grid-cols-4 lg:grid-cols-5' : 'grid-cols-2 md:grid-cols-3'} gap-3 sm:gap-4 mb-6 sm:mb-8`}
            >
              <div className="bg-white rounded-xl p-3 sm:p-4 shadow-md">
                <p className="text-xs sm:text-sm text-gray-600 mb-1 truncate">Total Items</p>
                <p className="text-2xl sm:text-3xl font-bold text-gray-900">{stats.total}</p>
              </div>
              {(isOwner || isAdmin) && (
                <>
                  <div className="bg-white rounded-xl p-3 sm:p-4 shadow-md">
                    <p className="text-xs sm:text-sm text-gray-600 mb-1 truncate">Draft</p>
                    <p className="text-2xl sm:text-3xl font-bold text-gray-500">{stats.draft}</p>
                  </div>
                  <div className="bg-white rounded-xl p-3 sm:p-4 shadow-md">
                    <p className="text-xs sm:text-sm text-gray-600 mb-1 truncate">Proposed</p>
                    <p className="text-2xl sm:text-3xl font-bold text-blue-500">{stats.proposed}</p>
                  </div>
                </>
              )}
              <div className="bg-white rounded-xl p-3 sm:p-4 shadow-md">
                <p className="text-xs sm:text-sm text-gray-600 mb-1 truncate">Available</p>
                <p className="text-2xl sm:text-3xl font-bold text-gray-900">{stats.available}</p>
              </div>
              {isMember && (
                <>
                  <div className="bg-white rounded-xl p-3 sm:p-4 shadow-md">
                    <p className="text-xs sm:text-sm text-gray-600 mb-1 truncate">Booked by You</p>
                    <p className="text-2xl sm:text-3xl font-bold text-green-700">
                      {stats.bookedByYou}
                    </p>
                  </div>
                  {stats.proposedByYou > 0 && (
                    <div className="bg-white rounded-xl p-3 sm:p-4 shadow-md">
                      <p className="text-xs sm:text-sm text-gray-600 mb-1 truncate">
                        Proposed by You
                      </p>
                      <p className="text-2xl sm:text-3xl font-bold text-blue-500">
                        {stats.proposedByYou}
                      </p>
                    </div>
                  )}
                </>
              )}
              <div className="bg-white rounded-xl p-3 sm:p-4 shadow-md">
                <p className="text-xs sm:text-sm text-gray-600 mb-1 truncate">Completed</p>
                <p className="text-2xl sm:text-3xl font-bold text-green-400">{stats.completed}</p>
              </div>
            </div>

            {/* Filter and Sort Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-6 sm:mb-8">
              <div className="w-full sm:w-auto">
                <FilterDropdown
                  options={getFilterOptions()}
                  selectedFilters={selectedFilters}
                  onChange={setSelectedFilters}
                  label="Filter"
                />
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-shrink-0 w-full sm:w-auto">
                <label
                  htmlFor="sort"
                  className="text-xs sm:text-sm font-medium text-gray-700 whitespace-nowrap"
                >
                  Sort by:
                </label>
                <select
                  id="sort"
                  value={sortBy}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (
                      value === 'name-asc' ||
                      value === 'name-desc' ||
                      value === 'price-asc' ||
                      value === 'price-desc' ||
                      value === 'date-asc' ||
                      value === 'date-desc'
                    ) {
                      setSortBy(value);
                    }
                  }}
                  className="w-full sm:w-auto pl-3 pr-8 sm:pr-12 py-2 text-sm sm:text-base border border-gray-300 rounded-lg bg-white text-gray-700 font-medium focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.5em_1.5em] bg-[right_0.5rem_center] bg-no-repeat cursor-pointer"
                >
                  <option value="name-asc">Name (A-Z)</option>
                  <option value="name-desc">Name (Z-A)</option>
                  <option value="price-asc">Price (Low to High)</option>
                  <option value="price-desc">Price (High to Low)</option>
                  <option value="date-asc">Date Created (Oldest First)</option>
                  <option value="date-desc">Date Created (Newest First)</option>
                </select>
              </div>
            </div>

            {/* Add Item Button */}
            <div className="mb-6 sm:mb-8">
              {(isOwner || isAdmin) && (
                <Button onClick={() => setShowAddItemModal(true)} size="md">
                  + Add Item
                </Button>
              )}
              {isMember && !isOwner && !isAdmin && (
                <Button onClick={() => setShowProposeItemModal(true)} size="md">
                  + Propose Item
                </Button>
              )}
            </div>

            {/* Items Grid */}
            {loadingItems ? (
              <div className="text-center py-12 sm:py-20">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
                <p className="mt-4 text-sm text-gray-600">Loading items...</p>
              </div>
            ) : sortedItems.length === 0 ? (
              <div className="text-center py-12 sm:py-20">
                <div className="text-4xl sm:text-6xl mb-4">📦</div>
                <h3 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-2">
                  No items found
                </h3>
                <p className="text-sm sm:text-base text-gray-600 px-4">
                  {selectedFilters.length === 0 || selectedFilters.includes('all')
                    ? 'No wishlist items yet.'
                    : 'No items match the selected filters.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
                {sortedItems.map((item) => (
                  <WishlistItem
                    key={item._id}
                    item={item}
                    onUpdate={handleUpdateItem}
                    onEdit={
                      // Owners and admins can edit non-proposed items
                      // Proposers can edit their own proposed items
                      ((isOwner || isAdmin) && item.status !== 'proposed') ||
                      (item.status === 'proposed' &&
                        item.proposedBy?.toString() === session?.user?.id)
                        ? handleEditItem
                        : undefined
                    }
                    onReview={
                      (isOwner || isAdmin) && item.status === 'proposed'
                        ? () => setItemToReview(item)
                        : undefined
                    }
                    isAuthenticated={!!session?.user}
                    isOwner={isOwner || isAdmin}
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
            {(isOwner || isAdmin) && (
              <div className="bg-white rounded-xl p-4 sm:p-6 shadow-md">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Invite User</h2>
                <form
                  onSubmit={handleInviteUser}
                  className="flex flex-col sm:flex-row gap-2"
                  autoComplete="off"
                >
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="user@example.com"
                    required
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none text-sm sm:text-base"
                    disabled={isInviting}
                    autoComplete="email"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                    className="pl-4 pr-8 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none appearance-none text-sm sm:text-base bg-white bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.5em_1.5em] bg-[right_0.5rem_center] bg-no-repeat cursor-pointer"
                    disabled={isInviting}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    type="submit"
                    disabled={isInviting}
                    className="px-6 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-sm sm:text-base whitespace-nowrap"
                  >
                    {isInviting ? 'Inviting...' : 'Invite'}
                  </button>
                </form>
              </div>
            )}

            <div className="bg-white rounded-xl shadow-md overflow-hidden">
              <div className="px-4 sm:px-6 py-4 border-b border-gray-200">
                <h2 className="text-xl font-bold text-gray-900">Members</h2>
              </div>
              {loadingMembers ? (
                <div className="px-4 sm:px-6 py-12 flex items-center justify-center">
                  <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                    <p className="mt-4 text-sm text-gray-600">Loading members...</p>
                  </div>
                </div>
              ) : members.length === 0 ? (
                <div className="px-4 sm:px-6 py-12 text-center">
                  <p className="text-gray-600">No members yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {members.map((member) => {
                    const memberUserId = String(member.user._id);
                    const isCurrentUser = memberUserId === session?.user?.id;
                    const isOriginalOwner = wishlist?.owner.toString() === memberUserId;
                    // Role is only 'owner' if it's the original owner (from wishlist.owner), otherwise check membership role
                    const memberRole = isOriginalOwner
                      ? 'owner'
                      : (member.role as 'admin' | 'member');
                    const isAdminMember = memberRole === 'admin';
                    const isRegularMember = memberRole === 'member';

                    return (
                      <div
                        key={member._id}
                        className="px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/users/${memberUserId}`}
                              className="font-medium text-gray-900 hover:text-primary-600 transition-colors cursor-pointer break-words"
                            >
                              {member.user.email}
                            </Link>
                            {isOriginalOwner && (
                              <span className="px-2 py-1 text-xs font-semibold rounded-full bg-primary-100 text-primary-800 whitespace-nowrap">
                                Owner
                              </span>
                            )}
                            {isAdminMember && !isOriginalOwner && (
                              <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 whitespace-nowrap">
                                Admin
                              </span>
                            )}
                            {isRegularMember && (
                              <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800 whitespace-nowrap">
                                Member
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isCurrentUser && (
                            <span className="text-sm text-gray-500 whitespace-nowrap">You</span>
                          )}
                          {(isOwner || isAdmin) && !isOriginalOwner && (
                            <>
                              <select
                                value={memberRole}
                                onChange={async (e) => {
                                  const newRole = e.target.value as 'admin' | 'member';
                                  try {
                                    const response = await fetch(
                                      `/api/wishlists/${wishlistId}/members/${member._id}`,
                                      {
                                        method: 'PATCH',
                                        headers: {
                                          'Content-Type': 'application/json',
                                        },
                                        body: JSON.stringify({ role: newRole }),
                                      }
                                    );

                                    const result = await response.json();

                                    if (result.success) {
                                      showToast('Member role updated successfully', 'success');
                                      // Refresh members list
                                      const membersResponse = await fetch(
                                        `/api/wishlists/${wishlistId}/members`,
                                        { cache: 'no-store' }
                                      );
                                      const membersResult = await membersResponse.json();
                                      if (membersResult.success) {
                                        setMembers(membersResult.data || []);
                                      }
                                    } else {
                                      showToast(result.error || 'Failed to update role', 'error');
                                    }
                                  } catch (error) {
                                    console.error('Error updating role:', error);
                                    showToast('Failed to update role', 'error');
                                  }
                                }}
                                className="pl-3 pr-8 py-1 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none appearance-none bg-white bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.5em_1.5em] bg-[right_0.5rem_center] bg-no-repeat cursor-pointer"
                              >
                                <option value="member">Member</option>
                                <option value="admin">Admin</option>
                              </select>
                              <button
                                onClick={() => handleKickMember(member._id, member.user.email)}
                                className="px-3 sm:px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                              >
                                Remove
                              </button>
                            </>
                          )}
                          {isMember && !isOwner && !isAdmin && isCurrentUser && (
                            <button
                              onClick={handleLeaveWishlist}
                              className="px-3 sm:px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                            >
                              Leave
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (isOwner || isAdmin) && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl p-6 shadow-md">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Wishlist Settings</h3>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setIsSavingSettings(true);

                  try {
                    const response = await fetch(`/api/wishlists/${wishlistId}`, {
                      method: 'PATCH',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify(settingsForm),
                    });

                    const result = await response.json();

                    if (result.success) {
                      setWishlist(result.data);
                      settingsFormDirtyRef.current = false;
                      showToast('Wishlist updated successfully', 'success');
                    } else {
                      showToast(result.error || 'Failed to update wishlist', 'error');
                    }
                  } catch (error) {
                    console.error('Error updating wishlist:', error);
                    showToast('Failed to update wishlist', 'error');
                  } finally {
                    setIsSavingSettings(false);
                  }
                }}
                className="space-y-4"
                autoComplete="off"
              >
                <div>
                  <label
                    htmlFor="settings-name"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Wishlist Name *
                  </label>
                  <input
                    type="text"
                    id="settings-name"
                    required
                    value={settingsForm.name}
                    onChange={(e) => {
                      setSettingsForm({ ...settingsForm, name: e.target.value });
                      settingsFormDirtyRef.current = true;
                    }}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                    disabled={isSavingSettings}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label
                    htmlFor="settings-description"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    Description
                  </label>
                  <textarea
                    id="settings-description"
                    value={settingsForm.description}
                    onChange={(e) => {
                      setSettingsForm({ ...settingsForm, description: e.target.value });
                      settingsFormDirtyRef.current = true;
                    }}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
                    rows={3}
                    disabled={isSavingSettings}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Visibility</label>
                  <p className="text-xs text-gray-500 mb-2">
                    Controls whether the wishlist will be visible on your profile page for
                    non-members
                  </p>
                  <div className="relative flex items-center justify-between p-1 bg-gray-100 rounded-lg">
                    {/* Sliding indicator */}
                    <div
                      className={`absolute top-1 bottom-1 bg-white rounded-md shadow-sm transition-all duration-300 ease-in-out ${
                        settingsForm.isPublic
                          ? 'left-1 right-[calc(50%+0.25rem)]'
                          : 'left-[calc(50%+0.25rem)] right-1'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setSettingsForm({ ...settingsForm, isPublic: true });
                        settingsFormDirtyRef.current = true;
                      }}
                      disabled={isSavingSettings}
                      className={`relative z-10 flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors duration-300 cursor-pointer ${
                        settingsForm.isPublic
                          ? 'text-gray-900'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      Public
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSettingsForm({ ...settingsForm, isPublic: false });
                        settingsFormDirtyRef.current = true;
                      }}
                      disabled={isSavingSettings}
                      className={`relative z-10 flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors duration-300 cursor-pointer ${
                        !settingsForm.isPublic
                          ? 'text-gray-900'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      Private
                    </button>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-4">
                  <button
                    type="submit"
                    disabled={isSavingSettings}
                    className="w-full sm:w-auto px-6 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-sm sm:text-base"
                  >
                    {isSavingSettings ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>

              {/* Delete Wishlist Section - Only for original owner */}
              {isOwner && (
                <div className="mt-6 sm:mt-8 pt-6 sm:pt-8 border-t border-gray-200">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900 mb-2">
                    Danger Zone
                  </h3>
                  <p className="text-xs sm:text-sm text-gray-600 mb-4">
                    Once you delete a wishlist, there is no going back. All items and memberships
                    will be permanently deleted.
                  </p>
                  <Button
                    variant="danger"
                    onClick={handleDeleteWishlist}
                    disabled={isDeletingWishlist}
                    fullWidth
                    className="sm:w-auto"
                  >
                    {isDeletingWishlist ? 'Deleting...' : 'Delete Wishlist'}
                  </Button>
                </div>
              )}
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

      {showProposeItemModal && (
        <ProposeItemModal
          isOpen={showProposeItemModal}
          onClose={() => setShowProposeItemModal(false)}
          onPropose={handleProposeItem}
        />
      )}

      {itemToEdit && (
        <EditItemModal
          isOpen={!!itemToEdit}
          onClose={() => setItemToEdit(null)}
          onSave={handleSaveEdit}
          onDelete={handleDeleteItem}
          item={itemToEdit}
        />
      )}

      {itemToReview && (
        <ReviewItemModal
          isOpen={!!itemToReview}
          onClose={() => setItemToReview(null)}
          onApprove={handleReviewItem}
          onDelete={handleDeleteProposedItem}
          item={itemToReview}
        />
      )}

      {/* Confirmation Dialogs */}
      {deleteConfirm && deleteConfirm.type === 'member' && deleteConfirm.memberEmail && (
        <ConfirmDialog
          isOpen={!!deleteConfirm}
          title="Remove Member"
          message={`Are you sure you want to remove ${deleteConfirm.memberEmail} from this wishlist?`}
          onConfirm={confirmKickMember}
          onCancel={() => setDeleteConfirm(null)}
          confirmText="Remove"
          cancelText="Cancel"
          type="danger"
        />
      )}

      {deleteConfirm && deleteConfirm.type === 'leave' && (
        <ConfirmDialog
          isOpen={!!deleteConfirm}
          title="Leave Wishlist"
          message="Are you sure you want to leave this wishlist? All your bookings will be removed."
          onConfirm={confirmLeaveWishlist}
          onCancel={() => setDeleteConfirm(null)}
          confirmText="Leave"
          cancelText="Cancel"
          type="danger"
        />
      )}

      {deleteConfirm && deleteConfirm.type === 'wishlist' && (
        <ConfirmDialog
          isOpen={!!deleteConfirm}
          title="Delete Wishlist"
          message="Are you sure you want to delete this wishlist? This action cannot be undone. All items, memberships, and bookings will be permanently deleted."
          onConfirm={confirmDeleteWishlist}
          onCancel={() => setDeleteConfirm(null)}
          confirmText="Delete"
          cancelText="Cancel"
          type="danger"
        />
      )}
    </main>
  );
}
