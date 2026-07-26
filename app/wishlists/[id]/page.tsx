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
import AppHeader from '@/components/AppHeader';
import ConfirmDialog from '@/components/ConfirmDialog';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import InviteMemberForm from '@/components/InviteMemberForm';
import BannerImage from '@/components/BannerImage';
import ShareButton from '@/components/ShareButton';
import ImageUpload from '@/components/ImageUpload';
import Select from '@/components/Select';
import { SkeletonGrid, MemberRowSkeleton } from '@/components/Skeleton';
import Avatar from '@/components/Avatar';
import { coverGradient } from '@/lib/utils/cover';
import { getVisibility, visibilityMeta, type Visibility } from '@/lib/utils/visibility';
import { currencySelectOptions } from '@/lib/utils/currencies';
import { useToast } from '@/components/ToastProvider';
import { ApiItem } from '@/types/api';
import { IWishlist } from '@/models/Wishlist';
import {
  sortItems,
  calculateStats,
  filterItemsMulti,
  searchItemsByName,
  type FilterOption,
  type SortType,
} from '@/lib/utils/itemFilters';
import FilterDropdown from '@/components/FilterDropdown';
import { useFetchItems, useUpdateItem, useCreateItem, useDeleteItem } from '@/lib/hooks/useItems';

interface WishlistMember {
  _id: string;
  user: {
    _id: string;
    username?: string;
    image?: string | null;
  };
  role: 'owner' | 'admin' | 'member'; // 'owner' is only used when representing the original owner from wishlist.owner
  createdAt: string;
}

interface PendingInvite {
  _id: string;
  role: 'admin' | 'member';
  username: string | null;
  image: string | null;
}

export default function WishlistDetail() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const { showToast } = useToast();
  const wishlistId = typeof params?.id === 'string' ? params.id : null;

  const [wishlist, setWishlist] = useState<IWishlist | null>(null);
  const [ownerUsername, setOwnerUsername] = useState<string | null>(null);
  const [items, setItems] = useState<ApiItem[]>([]);
  const [members, setMembers] = useState<WishlistMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState<FilterOption[]>([]);
  const [sortBy, setSortBy] = useState<SortType>('name-asc');
  const [searchQuery, setSearchQuery] = useState('');
  // 'original' shows each item's own currency; any code converts all prices to it.
  const [priceCurrency, setPriceCurrency] = useState<string>('original');
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [itemToEdit, setItemToEdit] = useState<ApiItem | null>(null);
  const [itemToReview, setItemToReview] = useState<ApiItem | null>(null);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showProposeItemModal, setShowProposeItemModal] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [settingsForm, setSettingsForm] = useState<{
    name: string;
    slug: string;
    description: string;
    visibility: Visibility;
    bannerUrl: string;
    currency: string;
  }>({
    name: '',
    slug: '',
    description: '',
    visibility: 'everyone',
    bannerUrl: '',
    currency: 'USD',
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
  // Order matches the stat-card order rendered above the list, so the filter
  // dropdown and the clickable cards line up one-to-one.
  const getFilterOptions = useCallback((): FilterOption[] => {
    if (isOwner) {
      return ['all', 'draft', 'proposed', 'available', 'completed'];
    } else if (isMember) {
      return ['all', 'available', 'bookedByMe', 'bookedByOthers', 'proposedByMe', 'completed'];
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
            const hasExtendedProps = 'userRole' in w || 'ownerUsername' in w;
            if (hasExtendedProps) {
              const extendedWishlist = w as IWishlist & {
                userRole?: 'owner' | 'admin' | 'member' | null;
                ownerUsername?: string | null;
              };
              setOwnerUsername(
                'ownerUsername' in extendedWishlist ? extendedWishlist.ownerUsername || null : null
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
                slug: wishlistData.slug || '',
                description: wishlistData.description || '',
                visibility: getVisibility(wishlistData),
                bannerUrl: wishlistData.bannerUrl || '',
                currency: wishlistData.currency || 'USD',
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

  // Refresh the pending-invites list (owner/admin only).
  const refreshInvites = useCallback(async () => {
    if (!wishlistId) return;
    try {
      const res = await fetch(`/api/wishlists/${wishlistId}/invites`, { cache: 'no-store' });
      const result = await res.json();
      if (result.success) setPendingInvites(result.data || []);
    } catch {
      /* ignore */
    }
  }, [wishlistId]);

  // Fetch members + pending invites (only for owners and admins)
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

    if ((isOwner || isAdmin) && manageOpen) {
      fetchMembers();
      refreshInvites();
    }
  }, [wishlistId, isOwner, isAdmin, manageOpen, refreshInvites]);

  // Timestamp of the most recent local mutation. A background poll whose read
  // was in flight across a mutation is stale and must be discarded, otherwise it
  // clobbers the optimistic state and the UI flickers.
  const lastMutationAt = useRef(0);

  const fetchItems = useCallback(
    async (silent = false) => {
      if (!wishlistId) return;

      if (!silent) {
        setLoadingItems(true);
      }

      const startedAt = Date.now();
      try {
        const data = await fetchItemsHook(wishlistId);
        // Drop a poll result that raced with a mutation (started before the
        // mutation settled) so it can't overwrite fresher local state.
        if (silent && lastMutationAt.current > startedAt) return;
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
    if (wishlistId && !manageOpen) {
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
    } else if (manageOpen) {
      // Reset loading state when switching away from items tab
      setLoadingItems(false);
    }
  }, [wishlistId, manageOpen, fetchItems]);

  const createItemHook = useCreateItem(
    (newItem) => {
      setItems((prevItems) => [newItem, ...prevItems]);
      showToast('Item added successfully', 'success');
    },
    (error) => {
      showToast(error, 'error');
    }
  );

  // No success refetch here — handleUpdateItem merges the server response into
  // the single item, avoiding a full-list refetch that races with polling.
  const updateItemHook = useUpdateItem(undefined, (error) => {
    showToast(error, 'error');
  });

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
      lastMutationAt.current = Date.now();
      // Optimistic: reflect the change immediately.
      setItems((prevItems) =>
        prevItems.map((item) => {
          if (item._id !== id) return item;
          const optimistic = { ...item, ...updates };
          if (updates.status === 'booked' && session?.user?.id) {
            optimistic.bookedBy = session.user.id;
          } else if (
            (updates.status === 'available' ||
              updates.status === 'draft' ||
              updates.status === 'completed') &&
            item.status === 'booked'
          ) {
            optimistic.bookedBy = null;
          }
          return optimistic;
        })
      );

      const updated = await updateItemHook(id, updates);
      // Mark the settle time so any poll that read across this mutation is dropped.
      lastMutationAt.current = Date.now();

      if (updated) {
        // Merge authoritative server fields into just this item (keeps enriched
        // fields like priceInUsdCents that the PATCH response doesn't include).
        setItems((prevItems) =>
          prevItems.map((item) => (item._id === id ? { ...item, ...updated } : item))
        );
      } else {
        // Mutation failed — reconcile this list with the server.
        fetchItems(true);
      }
    },
    [updateItemHook, session?.user?.id, fetchItems]
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

  const handleInvite = useCallback(
    async (payload: { username: string; role: 'admin' | 'member' }) => {
      if (!wishlistId) return;

      setIsInviting(true);
      try {
        const response = await fetch(`/api/wishlists/${wishlistId}/members`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const result = await response.json();

        if (result.success) {
          showToast('Invitation sent', 'success');
          // Membership is created only when they accept — refresh pending invites.
          await refreshInvites();
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
    [wishlistId, showToast, refreshInvites]
  );

  const cancelInvite = useCallback(
    async (inviteId: string) => {
      if (!wishlistId) return;
      // Optimistic removal.
      setPendingInvites((prev) => prev.filter((i) => i._id !== inviteId));
      try {
        const res = await fetch(`/api/wishlists/${wishlistId}/invites/${inviteId}`, {
          method: 'DELETE',
        });
        const result = await res.json();
        if (result.success) {
          showToast('Invitation cancelled', 'success');
        } else {
          showToast(result.error || 'Failed to cancel invitation', 'error');
          refreshInvites();
        }
      } catch {
        showToast('Failed to cancel invitation', 'error');
        refreshInvites();
      }
    },
    [wishlistId, showToast, refreshInvites]
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

  const searchedItems = useMemo(
    () => searchItemsByName(filteredItems, searchQuery),
    [filteredItems, searchQuery]
  );

  const sortedItems = useMemo(() => sortItems(searchedItems, sortBy), [searchedItems, sortBy]);

  // Clear the item search when switching to a different wishlist.
  useEffect(() => setSearchQuery(''), [wishlistId]);

  // The viewer's preferred currency, offered near the top of the price selector.
  const viewerCurrency = session?.user?.defaultCurrency || 'USD';

  // Exchange rates for the "show prices in…" selector (fetched once).
  useEffect(() => {
    let cancelled = false;
    fetch('/api/currency-rates', { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (!cancelled && res.success) setRates(res.data.rates as Record<string, number>);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Price-currency options: Original, then the viewer's default, then the rest.
  const priceOptions = useMemo(() => {
    const opts = [{ value: 'original', label: 'Each item’s currency' }];
    const def = currencySelectOptions.find((o) => o.value === viewerCurrency);
    if (def) opts.push({ value: def.value, label: `${def.label} · your default` });
    else opts.push({ value: viewerCurrency, label: `${viewerCurrency} · your default` });
    for (const o of currencySelectOptions) {
      if (o.value !== viewerCurrency) opts.push(o);
    }
    return opts;
  }, [viewerCurrency]);

  // Clicking a stat card narrows the list to that one status ('all' selects
  // every option). The dropdown and the cards share getFilterOptions()' order.
  const applyCardFilter = useCallback(
    (key: FilterOption) => {
      setSelectedFilters(key === 'all' ? [...getFilterOptions()] : [key]);
    },
    [getFilterOptions]
  );

  // Which card (if any) reflects the current filter selection, for highlighting.
  const activeCardKey = useMemo<FilterOption | null>(() => {
    const nonAll = getFilterOptions().filter((o) => o !== 'all');
    if (nonAll.length > 0 && nonAll.every((o) => selectedFilters.includes(o))) return 'all';
    if (selectedFilters.length === 1) return selectedFilters[0];
    return null;
  }, [selectedFilters, getFilterOptions]);

  const cardMeta: Record<FilterOption, { label: string; value: number; valueClass: string }> = {
    all: { label: 'Total Items', value: stats.total, valueClass: 'text-foreground' },
    draft: { label: 'Draft', value: stats.draft, valueClass: 'text-muted-foreground' },
    proposed: { label: 'Proposed', value: stats.proposed, valueClass: 'text-blue-500' },
    available: { label: 'Available', value: stats.available, valueClass: 'text-foreground' },
    bookedByMe: {
      label: 'Booked by You',
      value: stats.bookedByYou,
      valueClass: 'text-green-600 dark:text-green-500',
    },
    bookedByOthers: {
      label: 'Booked by Others',
      value: Math.max(0, stats.booked - stats.bookedByYou),
      valueClass: 'text-green-600 dark:text-green-500',
    },
    proposedByMe: {
      label: 'Proposed by You',
      value: stats.proposedByYou,
      valueClass: 'text-blue-500',
    },
    completed: { label: 'Completed', value: stats.completed, valueClass: 'text-emerald-500' },
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <AppHeader actions={<AuthButton />} />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          {/* Header: title + author on the left, actions on the right */}
          <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-baseline gap-3">
              <div className="skeleton h-9 w-56 rounded-md sm:h-10" />
              <div className="skeleton h-4 w-20 rounded-md" />
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <div className="skeleton h-9 w-24 rounded-full" />
              <div className="skeleton h-9 w-24 rounded-full" />
            </div>
          </div>
          {/* Image + description row */}
          <div className="mb-6 grid gap-4 sm:mb-8 sm:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] sm:items-start">
            <div className="skeleton aspect-[16/9] rounded-3xl" />
            <div className="skeleton hidden h-full min-h-[8rem] rounded-2xl sm:block" />
          </div>
          {/* Stat cards (full-width auto-fit row) */}
          <div
            className="mb-6 grid gap-3 sm:mb-8 sm:gap-4"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))' }}
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton h-[70px] rounded-xl sm:h-[78px]" />
            ))}
          </div>
          <SkeletonGrid count={8} variant="item" />
        </main>
      </div>
    );
  }

  if (!wishlist) {
    return (
      <div className="min-h-screen">
        <AppHeader actions={<AuthButton />} />
        <main className="flex min-h-[60vh] items-center justify-center px-4">
          <div className="text-center">
            <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Icon name="package" size={28} />
            </span>
            <h2 className="mb-2 text-xl font-semibold text-foreground">Wishlist not found</h2>
            <p className="mb-6 text-sm text-muted-foreground">
              It may have been deleted or you don&apos;t have access.
            </p>
            <Link
              href="/"
              className="inline-flex h-10 items-center rounded-xl bg-primary-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-700"
            >
              Back to wishlists
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {/* Header: title + meta on the left, wishlist-scoped actions on the right.
            The title used to sit on the banner; it moved here so the banner can shrink
            into a side panel next to the stat cards below. */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-baseline gap-3">
            <h1 className="min-w-0 truncate text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {wishlist.name}
            </h1>
            {ownerUsername && (
              <span className="flex-shrink-0 whitespace-nowrap text-sm text-muted-foreground">
                by{' '}
                {isOwner ? (
                  'you'
                ) : (
                  <Link
                    href={`/users/${ownerUsername}`}
                    className="font-semibold text-foreground underline-offset-2 hover:underline"
                  >
                    @{ownerUsername}
                  </Link>
                )}
              </span>
            )}
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <ShareButton />
            {isMember && !isOwner && (
              <button
                onClick={handleLeaveWishlist}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[13px] font-semibold text-foreground shadow-xs transition-colors hover:bg-surface-hover"
              >
                <Icon name="logout" size={15} />
                Leave
              </button>
            )}
            {(isOwner || isAdmin) && (
              <button
                onClick={() => setManageOpen((v) => !v)}
                aria-label={manageOpen ? 'Back to items' : 'Manage wishlist'}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[13px] font-semibold text-foreground shadow-xs transition-colors hover:bg-surface-hover"
              >
                <Icon name={manageOpen ? 'close' : 'settings'} size={15} />
                {manageOpen ? 'Done' : 'Manage'}
              </button>
            )}
          </div>
        </div>

        {/* Manage header (owner/admin) */}
        {manageOpen && (isOwner || isAdmin) && (
          <div className="mb-6 flex items-center gap-3">
            <button
              onClick={() => setManageOpen(false)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground shadow-xs transition-colors hover:bg-surface-hover hover:text-foreground"
              aria-label="Back to items"
            >
              <Icon name="chevron-down" size={18} className="rotate-90" />
            </button>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              Manage wishlist
            </h2>
          </div>
        )}

        {/* Items Tab */}
        {!manageOpen && (
          <>
            {/* Image + description row */}
            <div
              className={`mb-6 grid gap-4 sm:mb-8 ${
                wishlist.description
                  ? 'sm:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] sm:items-start'
                  : 'sm:max-w-md'
              }`}
            >
              <div
                className="relative aspect-[16/9] overflow-hidden rounded-3xl border border-border bg-surface-2 shadow-md"
                style={{
                  background: wishlist.bannerUrl
                    ? undefined
                    : coverGradient(wishlist._id.toString()),
                }}
              >
                {wishlist.bannerUrl && (
                  <BannerImage
                    src={wishlist.bannerUrl}
                    alt=""
                    priority
                    sizes="(max-width: 1024px) 100vw, 26rem"
                  />
                )}
                <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/20 px-2.5 py-1 text-[11.5px] font-semibold text-white backdrop-blur-md">
                  <Icon name={visibilityMeta[getVisibility(wishlist)].icon} size={12} />
                  {visibilityMeta[getVisibility(wishlist)].label}
                </span>
              </div>
              {wishlist.description && (
                <div className="rounded-2xl border border-border bg-surface p-5">
                  <p className="whitespace-pre-line break-words text-[15px] text-muted-foreground">
                    {wishlist.description}
                  </p>
                </div>
              )}
            </div>

            {/* Stat cards — full-width row; click to filter the list by that status */}
            <div
              className="mb-6 grid gap-3 sm:mb-8 sm:gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))' }}
            >
              {getFilterOptions().map((key) => {
                const meta = cardMeta[key];
                const active = activeCardKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyCardFilter(key)}
                    aria-pressed={active}
                    title={`Show ${meta.label.toLowerCase()}`}
                    className={`rounded-xl border bg-surface p-3 text-left shadow-sm transition-all sm:p-4 ${
                      active
                        ? 'border-accent ring-1 ring-accent'
                        : 'border-border hover:border-border-strong hover:bg-surface-hover'
                    }`}
                  >
                    <p className="mb-1 truncate text-xs text-muted-foreground sm:text-sm">
                      {meta.label}
                    </p>
                    <p className={`text-2xl font-bold sm:text-3xl ${meta.valueClass}`}>
                      {meta.value}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Search + controls */}
            <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:gap-4">
              {/* Search — its own full-width row */}
              <div className="flex h-10 items-center gap-2 rounded-xl border border-border-strong bg-surface px-3.5">
                <Icon name="search" size={18} className="flex-shrink-0 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search items by name…"
                  aria-label="Search items by name"
                  className="h-full min-w-0 flex-1 border-0 bg-transparent text-sm outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Icon name="close" size={15} />
                  </button>
                )}
              </div>

              {/* Status · Sort · Currency — equal labelled fields */}
              <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
                <div className="flex flex-col gap-1.5 sm:flex-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Status
                  </span>
                  <FilterDropdown
                    options={getFilterOptions()}
                    selectedFilters={selectedFilters}
                    onChange={setSelectedFilters}
                    ariaLabel="Filter by status"
                    className="w-full"
                  />
                </div>

                <div className="flex flex-col gap-1.5 sm:flex-1">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Sort
                  </span>
                  <Select
                    value={sortBy}
                    onChange={(v) => setSortBy(v as SortType)}
                    ariaLabel="Sort items by"
                    triggerClassName="w-full"
                    options={[
                      { value: 'name-asc', label: 'Name (A-Z)' },
                      { value: 'name-desc', label: 'Name (Z-A)' },
                      { value: 'price-asc', label: 'Price (Low to High)' },
                      { value: 'price-desc', label: 'Price (High to Low)' },
                      { value: 'date-asc', label: 'Date Created (Oldest First)' },
                      { value: 'date-desc', label: 'Date Created (Newest First)' },
                    ]}
                  />
                </div>

                {session?.user && (
                  <div className="flex flex-col gap-1.5 sm:flex-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Show prices in
                    </span>
                    <Select
                      value={priceCurrency}
                      onChange={setPriceCurrency}
                      options={priceOptions}
                      ariaLabel="Show prices in"
                      triggerClassName="w-full"
                    />
                  </div>
                )}
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
              <SkeletonGrid count={8} variant="item" />
            ) : sortedItems.length === 0 ? (
              <div className="flex flex-col items-center rounded-2xl border border-dashed border-border-strong py-16 text-center sm:py-20">
                <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                  <Icon name="package" size={28} />
                </span>
                <h3 className="text-lg font-semibold text-foreground sm:text-xl">No items found</h3>
                <p className="mx-auto mt-1.5 max-w-sm px-4 text-sm text-muted-foreground">
                  {searchQuery.trim()
                    ? `No items match “${searchQuery.trim()}”.`
                    : selectedFilters.length === 0 || selectedFilters.includes('all')
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
                    priceCurrency={priceCurrency}
                    rates={rates}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Users Tab */}
        {manageOpen && (
          <div className="space-y-6">
            {(isOwner || isAdmin) && (
              <InviteMemberForm onInvite={handleInvite} isInviting={isInviting} />
            )}

            <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
              <div className="px-4 sm:px-6 py-4 border-b border-border">
                <h2 className="text-xl font-bold text-foreground">Members</h2>
              </div>
              {loadingMembers ? (
                <div className="divide-y divide-border">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <MemberRowSkeleton key={i} />
                  ))}
                </div>
              ) : members.length === 0 ? (
                <div className="px-4 sm:px-6 py-12 text-center">
                  <p className="text-muted-foreground">No members yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
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
                        className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <Avatar
                            name={member.user.username || 'user'}
                            src={member.user.image}
                            size="md"
                          />
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <Link
                              href={`/users/${member.user.username || ''}`}
                              className="break-words font-medium text-foreground transition-colors hover:text-accent dark:hover:text-primary-400"
                            >
                              @{member.user.username || 'user'}
                            </Link>
                            {isOriginalOwner && (
                              <span className="whitespace-nowrap rounded-full bg-primary-500/12 px-2 py-1 text-xs font-semibold text-primary-700 dark:text-primary-400">
                                Owner
                              </span>
                            )}
                            {isAdminMember && !isOriginalOwner && (
                              <span className="whitespace-nowrap rounded-full bg-blue-500/12 px-2 py-1 text-xs font-semibold text-blue-700 dark:text-blue-400">
                                Admin
                              </span>
                            )}
                            {isRegularMember && (
                              <span className="px-2 py-1 text-xs font-semibold rounded-full bg-muted text-foreground whitespace-nowrap">
                                Member
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isCurrentUser && (
                            <span className="text-sm text-muted-foreground whitespace-nowrap">
                              You
                            </span>
                          )}
                          {(isOwner || isAdmin) && !isOriginalOwner && (
                            <>
                              <Select
                                value={memberRole}
                                ariaLabel="Member role"
                                menuAlign="right"
                                triggerClassName="w-28"
                                options={[
                                  { value: 'member', label: 'Member' },
                                  { value: 'admin', label: 'Admin' },
                                ]}
                                onChange={async (v) => {
                                  const newRole = v as 'admin' | 'member';
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
                              />
                              <button
                                onClick={() =>
                                  handleKickMember(member._id, member.user.username || 'user')
                                }
                                className="px-3 sm:px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                              >
                                Remove
                              </button>
                            </>
                          )}
                          {isMember && !isOwner && !isAdmin && isCurrentUser && (
                            <button
                              onClick={handleLeaveWishlist}
                              className="px-3 sm:px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
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

            {/* Pending invites */}
            {(isOwner || isAdmin) && pendingInvites.length > 0 && (
              <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
                <div className="border-b border-border px-4 py-4 sm:px-6">
                  <h2 className="text-xl font-bold text-foreground">Pending invites</h2>
                </div>
                <div className="divide-y divide-border">
                  {pendingInvites.map((inv) => (
                    <div
                      key={inv._id}
                      className="flex items-center justify-between gap-3 px-4 py-4 sm:px-6"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={inv.username || 'invite'} src={inv.image} size="md" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">
                            {inv.username ? `@${inv.username}` : 'Invited user'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Invited as {inv.role} · awaiting response
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => cancelInvite(inv._id)}
                        className="flex-shrink-0 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10 sm:px-4"
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {manageOpen && (isOwner || isAdmin) && (
          <div className="mt-6 space-y-6">
            <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-foreground mb-4">Wishlist Settings</h3>

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
                      // Keep the URL in sync when the slug changes (or upgrade
                      // an id-based URL to the slug).
                      const newSlug = result.data?.slug as string | undefined;
                      if (newSlug && newSlug !== wishlistId) {
                        router.replace(`/wishlists/${newSlug}`);
                      }
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
                    className="block text-sm font-medium text-foreground mb-1"
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
                    className="w-full px-4 py-2 border border-border-strong rounded-xl outline-none"
                    disabled={isSavingSettings}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label
                    htmlFor="settings-slug"
                    className="block text-sm font-medium text-foreground mb-1"
                  >
                    Link
                  </label>
                  <div className="flex items-center gap-1.5 rounded-xl border border-border-strong bg-surface px-3.5 focus-within:border-border-strong">
                    <span className="flex-shrink-0 text-sm text-muted-foreground">/wishlists/</span>
                    <input
                      type="text"
                      id="settings-slug"
                      value={settingsForm.slug}
                      onChange={(e) => {
                        setSettingsForm({
                          ...settingsForm,
                          slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                        });
                        settingsFormDirtyRef.current = true;
                      }}
                      className="h-11 min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-none"
                      disabled={isSavingSettings}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The wishlist&apos;s web address. Lowercase letters, numbers, and hyphens.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="settings-description"
                    className="block text-sm font-medium text-foreground mb-1"
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
                    className="w-full px-4 py-2 border border-border-strong rounded-xl outline-none"
                    rows={3}
                    disabled={isSavingSettings}
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">Currency</label>
                  <Select
                    value={settingsForm.currency}
                    onChange={(v) => {
                      setSettingsForm({ ...settingsForm, currency: v });
                      settingsFormDirtyRef.current = true;
                    }}
                    options={currencySelectOptions}
                    ariaLabel="Wishlist currency"
                    size="md"
                    triggerClassName="w-full"
                    disabled={isSavingSettings}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Default currency for prices in this wishlist.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Banner image <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <ImageUpload
                    value={settingsForm.bannerUrl || null}
                    onChange={(url) => {
                      setSettingsForm({ ...settingsForm, bannerUrl: url ?? '' });
                      settingsFormDirtyRef.current = true;
                    }}
                    disabled={isSavingSettings}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Used as the cover instead of the gradient. Remove it to use the gradient.
                  </p>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Visibility
                  </label>
                  <p className="mb-2 text-xs text-muted-foreground">
                    {settingsForm.visibility === 'everyone'
                      ? 'Anyone can find and view this wishlist.'
                      : settingsForm.visibility === 'friends'
                        ? 'Only your friends (mutual follows) and members can view it.'
                        : 'Only you and people you invite can view it.'}
                  </p>
                  <div className="relative flex rounded-xl border border-border bg-surface-2 p-1">
                    <span
                      aria-hidden
                      className="absolute bottom-1 top-1 rounded-lg bg-surface shadow-sm transition-[left] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
                      style={{
                        width: 'calc((100% - 0.5rem) / 3)',
                        left: `calc(${['everyone', 'friends', 'private'].indexOf(settingsForm.visibility)} * ((100% - 0.5rem) / 3) + 0.25rem)`,
                      }}
                    />
                    {(['everyone', 'friends', 'private'] as Visibility[]).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => {
                          setSettingsForm({ ...settingsForm, visibility: v });
                          settingsFormDirtyRef.current = true;
                        }}
                        disabled={isSavingSettings}
                        className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors ${
                          settingsForm.visibility === v
                            ? 'text-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <Icon name={visibilityMeta[v].icon} size={14} />
                        {v === 'private' ? 'Only me' : visibilityMeta[v].label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-4">
                  <Button type="submit" disabled={isSavingSettings} fullWidth className="sm:w-auto">
                    {isSavingSettings ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </form>

              {/* Archive Section */}
              <div className="mt-6 border-t border-border pt-6 sm:mt-8 sm:pt-8">
                <h3 className="mb-2 text-base font-semibold text-foreground sm:text-lg">
                  {wishlist.archived ? 'Unarchive wishlist' : 'Archive wishlist'}
                </h3>
                <p className="mb-4 text-xs text-muted-foreground sm:text-sm">
                  {wishlist.archived
                    ? 'This wishlist is archived and tucked away in a separate section. Unarchive it to bring it back.'
                    : 'Hide this wishlist from the top of your dashboard without deleting anything. You can unarchive it anytime.'}
                </p>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/wishlists/${wishlistId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ archived: !wishlist.archived }),
                      });
                      const result = await res.json();
                      if (result.success) {
                        setWishlist((prev) =>
                          prev ? { ...prev, archived: !wishlist.archived } : prev
                        );
                        showToast(
                          wishlist.archived ? 'Wishlist unarchived' : 'Wishlist archived',
                          'success'
                        );
                      } else {
                        showToast(result.error || 'Failed to update wishlist', 'error');
                      }
                    } catch {
                      showToast('Failed to update wishlist', 'error');
                    }
                  }}
                  className="sm:w-auto"
                  fullWidth
                >
                  <Icon name="package" size={16} />
                  {wishlist.archived ? 'Unarchive' : 'Archive'}
                </Button>
              </div>

              {/* Featured Section - owner only */}
              {isOwner && (
                <div className="mt-6 border-t border-border pt-6 sm:mt-8 sm:pt-8">
                  <h3 className="mb-2 text-base font-semibold text-foreground sm:text-lg">
                    {wishlist.featured ? 'Featured on your dashboard' : 'Feature on your dashboard'}
                  </h3>
                  <p className="mb-4 text-xs text-muted-foreground sm:text-sm">
                    {wishlist.featured
                      ? 'This list is pinned as the highlight at the top of your dashboard.'
                      : 'Pin this list as the highlight at the top of your dashboard. Otherwise your list with the most items is featured automatically.'}
                  </p>
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/wishlists/${wishlistId}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ featured: !wishlist.featured }),
                        });
                        const result = await res.json();
                        if (result.success) {
                          setWishlist((prev) =>
                            prev ? { ...prev, featured: !wishlist.featured } : prev
                          );
                          showToast(
                            wishlist.featured
                              ? 'Removed from your dashboard highlight'
                              : 'Featured on your dashboard',
                            'success'
                          );
                        } else {
                          showToast(result.error || 'Failed to update wishlist', 'error');
                        }
                      } catch {
                        showToast('Failed to update wishlist', 'error');
                      }
                    }}
                    fullWidth
                    className="sm:w-auto"
                  >
                    <Icon name="sparkles" size={16} />
                    {wishlist.featured ? 'Unfeature' : 'Feature this list'}
                  </Button>
                </div>
              )}

              {/* Delete Wishlist Section - Only for original owner */}
              {isOwner && (
                <div className="mt-6 sm:mt-8 pt-6 sm:pt-8 border-t border-border">
                  <h3 className="text-base sm:text-lg font-semibold text-foreground mb-2">
                    Danger Zone
                  </h3>
                  <p className="text-xs sm:text-sm text-muted-foreground mb-4">
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
      </main>

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
    </div>
  );
}
