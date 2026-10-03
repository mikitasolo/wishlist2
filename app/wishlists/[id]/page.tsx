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
import SaveToListModal from '@/components/SaveToListModal';
import AuthButton from '@/components/AuthButton';
import AppHeader from '@/components/AppHeader';
import ConfirmDialog from '@/components/ConfirmDialog';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import InviteMemberForm, { type InviteMemberFormHandle } from '@/components/InviteMemberForm';
import Cover from '@/components/Cover';
import ShareButton from '@/components/ShareButton';
import ImageUpload from '@/components/ImageUpload';
import Select from '@/components/Select';
import OccasionField from '@/components/OccasionField';
import OccasionLabel from '@/components/OccasionLabel';
import { SkeletonGrid, MemberRowSkeleton } from '@/components/Skeleton';
import Avatar from '@/components/Avatar';
import LoadError from '@/components/LoadError';
import WishlistUnavailable from '@/components/WishlistUnavailable';
import { readResource, ReadRefusedError } from '@/lib/utils/resourceRead';
import { coverBadge, visibilityMeta, type Visibility } from '@/lib/utils/visibility';
import { currencySelectOptions } from '@/lib/utils/currencies';
import { missingFromDraft } from '@/lib/utils/occasion';
import {
  rebaseSettingsForm,
  settingsChanges,
  settingsFormFor,
  wishlistSettings,
  type WishlistSettings,
  type WishlistSettingsForm,
} from '@/lib/utils/wishlistSettings';
import {
  createMutationTracker,
  prependCreatedItem,
  updateItemOptimistically,
} from '@/lib/utils/itemListMerge';
import { RequestTimeoutError, withRequestTimeout } from '@/lib/utils/requestTimeout';
import { canCopyItem } from '@/lib/utils/itemCopy';
import {
  DELETE_LIST_WARNING,
  deleteListCopy,
  leftListToast,
  memberLeaveCopy,
  ownerLeaveCopy,
  removeFromListCopy,
} from '@/lib/utils/confirmationCopy';
import {
  createOwnerRemovalLog,
  shownOwnersOf,
  withoutOwner,
  type RemovedOwner,
  type ShownOwners,
} from '@/lib/utils/shownOwners';
import { useToast } from '@/components/ToastProvider';
import { ApiItem, ApiResponse } from '@/types/api';
import { IWishlist } from '@/models/Wishlist';
import {
  sortItems,
  calculateStats,
  filterItemsMulti,
  searchItemsByName,
  savedWishlistSort,
  DEFAULT_WISHLIST_SORT,
  SORT_OPTIONS,
  WISHLIST_SORT_STORAGE_KEY,
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
  // Owners have no membership row — their `_id` is their *user* id, which is what
  // the /owners/[userId] endpoints take.
  role: 'owner' | 'member';
  createdAt: string;
}

interface PendingInvite {
  _id: string;
  role: 'owner' | 'member';
  username: string | null;
  image: string | null;
}

// What archiving does, where it's offered and again when it's confirmed. An
// archived list is owner-only: everyone else gets the answer a missing list
// gets, so a link already shared stops working for them.
const ARCHIVE_EXPLANATION =
  "Only owners can open it. Members and anyone with the link will see that it isn't available. Items and reservations are kept, and you can unarchive anytime.";

type PageLoad = 'loading' | 'ready' | 'unavailable' | 'failed';

export default function WishlistDetail() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const { showToast } = useToast();
  const wishlistId = typeof params?.id === 'string' ? params.id : null;

  const [wishlist, setWishlist] = useState<IWishlist | null>(null);
  // The list's owners, counted and credited from here rather than from
  // `wishlist.owners`: a settings save answers with the list as its own write
  // left it, which can predate a demotion landing meanwhile, and without their
  // names. Only a read of the list sets them, less any owner the page has taken
  // off since that read was sent (`ownerRemovals`), and a demotion or removal
  // takes its owner off at once.
  const [owners, setOwners] = useState<ShownOwners>({ ids: [], usernames: [] });
  const [ownerRemovals] = useState(createOwnerRemovalLog);
  const ownerUsernames = owners.usernames;
  const [items, setItems] = useState<ApiItem[]>([]);
  const [members, setMembers] = useState<WishlistMember[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  // Where the page stands with the list. `unavailable`: a read of the list or
  // its items was refused (the list is missing, or hidden from this viewer),
  // which the page shows in place. `failed`: the first read of the list failed
  // for some other reason (a 5xx, the network), with a Try again that reads it
  // afresh (`attempt`). The items are polled only while the list is loading or
  // on screen.
  const [pageLoad, setPageLoad] = useState<PageLoad>('loading');
  const [attempt, setAttempt] = useState(0);
  const loading = pageLoad === 'loading';
  const refused = pageLoad === 'unavailable';
  const polling = pageLoad === 'loading' || pageLoad === 'ready';
  // Reads of the list and its items, numbered as they're sent, and the numbers
  // of the latest refused one and the latest list read that loaded. Whichever
  // was sent later decides: a read sent before the list was refused can't bring
  // it back (it may predate what hid it), and one sent before it loaded can't
  // take it away (the viewer signed in elsewhere since, say).
  const readsSent = useRef(0);
  const refusedAt = useRef(0);
  const loadedAt = useRef(0);
  // The id of the list on screen, once read. The page's reads go by its URL,
  // which an owner can change (a new slug), so a refusal is checked by id.
  const listId = useRef<string | null>(null);
  // Set while this page leaves or deletes the list itself: what a poll says
  // about it then, before the page moves on, doesn't matter any more.
  const departed = useRef(false);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [selectedFilters, setSelectedFilters] = useState<FilterOption[]>([]);
  const [sortBy, setSortBy] = useState<SortType>(DEFAULT_WISHLIST_SORT);
  const [searchQuery, setSearchQuery] = useState('');
  // 'original' shows each item's own currency; any code converts all prices to it.
  const [priceCurrency, setPriceCurrency] = useState<string>('original');
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [itemToEdit, setItemToEdit] = useState<ApiItem | null>(null);
  const [itemToReview, setItemToReview] = useState<ApiItem | null>(null);
  // "Save to my list": the item being copied to one of the viewer's own lists.
  const [itemToSave, setItemToSave] = useState<ApiItem | null>(null);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showProposeItemModal, setShowProposeItemModal] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  // The settings form, and the list's settings as it was last filled from them
  // (`saved`). A save sends only what the form changed from `saved`
  // (`settingsChanges`), so it can't undo a setting a co-owner changed in the
  // meantime. Kept together, so a reload or a save's answer can refill the form
  // and move its baseline in one update (`refillSettings`).
  const [settings, setSettings] = useState<{
    form: WishlistSettingsForm;
    saved: WishlistSettings;
  }>(() => {
    const saved = wishlistSettings({ name: '', visibility: 'everyone' });
    return { form: settingsFormFor(saved), saved };
  });
  const { form: settingsForm, saved: settingsBaseline } = settings;
  // Onto the form as it is by then: a banner upload can finish after the
  // render that started it.
  const editSettings = useCallback((change: Partial<WishlistSettingsForm>) => {
    setSettings((s) => ({ ...s, form: { ...s.form, ...change } }));
  }, []);
  // Take in the list as the server now has it. Every field the owner hasn't
  // edited since `base` (by default: since the form was last filled) shows the
  // list's value, and the next save diffs against it.
  const refillSettings = useCallback((list: WishlistSettings, base?: WishlistSettingsForm) => {
    setSettings((s) => ({
      form: rebaseSettingsForm(s.form, base ?? settingsFormFor(s.saved), list),
      saved: list,
    }));
  }, []);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: 'member' | 'owner' | 'leave' | 'wishlist';
    memberId?: string;
    memberUsername?: string | null;
  } | null>(null);
  // Promoting someone to co-owner is destructive for them (it cancels the
  // reservations they hold here) and irreversible without their consent, so it
  // always goes through an explicit warning first.
  const [promoteConfirm, setPromoteConfirm] = useState<{
    userId: string;
    username: string;
  } | null>(null);
  // Making a co-owner a member asks first too: it notifies them, it sits right
  // next to Remove, and only they can undo it (making them an owner again is an
  // invite they have to accept).
  const [demoteConfirm, setDemoteConfirm] = useState<{
    userId: string;
    username: string | null;
  } | null>(null);
  const [isDeletingWishlist, setIsDeletingWishlist] = useState(false);
  // Archiving shuts everyone but the owners out of the list, so it's confirmed
  // first. Unarchiving only gives back the access they had, so it isn't.
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  // The ref turns a second click away before the disabled state has rendered.
  const archivingRef = useRef(false);
  const [isArchiving, setIsArchiving] = useState(false);
  // The sole owner's Leave (on their own row in Manage) explains why they can't
  // and offers the way out instead: make someone else an owner (a member, with
  // Make owner, or an invited co-owner), then leave. Nothing in it leaves or
  // deletes anything.
  const [soleOwnerNotice, setSoleOwnerNotice] = useState(false);
  const inviteFormRef = useRef<InviteMemberFormHandle>(null);
  // Set by the notice's "Invite a co-owner", so the invite form is set up once
  // the notice has closed: by then its scroll lock is gone (it puts the page
  // back where it was) and focus can stay on the form.
  const inviteOwnerOnClose = useRef(false);

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

  // Restore the visitor's saved sort, else the default. It's one setting for
  // every list, so it's read once rather than per wishlist.
  useEffect(() => {
    setSortBy(savedWishlistSort(localStorage));
  }, []);

  // Save only a sort the visitor picks, so the default can change for everyone
  // who never chose one.
  const handleSortChange = useCallback((value: string) => {
    const next = value as SortType;
    setSortBy(next);
    localStorage.setItem(WISHLIST_SORT_STORAGE_KEY, next);
  }, []);

  // The list is missing, or hidden from this viewer: say so, and stop polling.
  // `sentNo` is the refused read's number (see `readsSent`).
  const markRefused = useCallback((sentNo: number) => {
    if (departed.current || sentNo < loadedAt.current) return;
    refusedAt.current = Math.max(refusedAt.current, sentNo);
    setPageLoad('unavailable');
  }, []);

  // Read through a ref, so the reads that use it don't change with it.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const recheckingRefusal = useRef(false);

  // A read of the list or its items, by this page's URL, was refused. That's
  // the list's answer (both follow the same rules), unless the URL has gone
  // stale: a co-owner gave the list a new slug since it loaded, and the old one
  // leads nowhere. So a page with the list on screen, opened by a slug, asks
  // again by the list's id. Refused again: not available. Still open: it
  // follows the list to its new URL, as the owner's own save does. Anything
  // else: it keeps the list, and the polls carry on.
  const readRefused = useCallback(
    async (sentNo: number) => {
      const id = listId.current;
      if (!id || id === wishlistId) {
        markRefused(sentNo);
        return;
      }
      if (sentNo < loadedAt.current || recheckingRefusal.current) return;
      recheckingRefusal.current = true;
      try {
        const recheckNo = ++readsSent.current;
        const read = await readResource<{ slug?: string | null }>(`/api/wishlists/${id}`);
        if (read.outcome === 'refused') {
          markRefused(recheckNo);
        } else if (read.outcome === 'loaded' && !departed.current) {
          const url = read.data.slug || id;
          if (url !== wishlistId) routerRef.current.replace(`/wishlists/${url}`);
        }
      } finally {
        recheckingRefusal.current = false;
      }
    },
    [wishlistId, markRefused]
  );

  // Fetch wishlist and determine role. Whatever the answer, the page stays at
  // this URL and says where things stand (see `pageLoad`), with no toast.
  useEffect(() => {
    if (!wishlistId || status === 'loading') return;
    // A read outdated by another (the session changed, Try again) is dropped.
    let current = true;

    async function fetchWishlist(id: string) {
      const sentAt = ownerRemovals.stamp();
      const sentNo = ++readsSent.current;
      const read = await readResource<unknown>(`/api/wishlists/${id}`);
      if (!current) return;

      // Missing, private, friends-only or archived: all the same to the page,
      // whichever status and wording the route refused it with.
      if (read.outcome === 'refused') {
        void readRefused(sentNo);
        return;
      }
      // Sent before a read was refused, so it may predate what hid the list.
      if (sentNo < refusedAt.current) return;
      const w = read.outcome === 'loaded' ? read.data : null;
      if (typeof w !== 'object' || w === null || !('name' in w) || !('owners' in w)) {
        console.error(
          'Error fetching wishlist:',
          read.outcome === 'failed' ? read.error : 'unexpected answer'
        );
        // Only a first load (or Try again) has nothing better to show. A later
        // read (the session changed) keeps what's on screen.
        setPageLoad((prev) => (prev === 'loading' ? 'failed' : prev));
        return;
      }

      const wishlistData = w as IWishlist & {
        userRole?: 'owner' | 'member' | null;
        ownerUsernames?: string[];
      };
      listId.current = String(wishlistData._id);
      loadedAt.current = Math.max(loadedAt.current, sentNo);
      setWishlist(wishlistData);

      // Without an owner this page took off since the read was sent.
      const readOwners = ownerRemovals.land(sentAt, shownOwnersOf(wishlistData));
      if (readOwners) setOwners(readOwners);

      // Check for extended properties
      if ('userRole' in wishlistData || 'ownerUsernames' in wishlistData) {
        // Check user role from API response
        const userRole = wishlistData.userRole ?? null;
        setIsOwner(userRole === 'owner');
        setIsMember(userRole === 'member');
      }

      // Edits the owner hasn't saved yet stay in the form.
      refillSettings(wishlistSettings(wishlistData));

      // Only once the wishlist is set, so the page never renders without it.
      setPageLoad('ready');
    }

    fetchWishlist(wishlistId);
    return () => {
      current = false;
    };
  }, [wishlistId, status, refillSettings, ownerRemovals, readRefused, attempt]);

  // Try again, after the list couldn't be read: the skeleton, then a fresh
  // read of the list and its items.
  const retryLoad = useCallback(() => {
    setPageLoad('loading');
    setAttempt((n) => n + 1);
  }, []);

  // Refresh the pending-invites list (owners only).
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

  // Fetch members + pending invites (owners only)
  useEffect(() => {
    async function fetchMembers() {
      if (!wishlistId || !isOwner) return;

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

    if (isOwner && manageOpen) {
      fetchMembers();
      refreshInvites();
    }
  }, [wishlistId, isOwner, manageOpen, refreshInvites]);

  // The page's item mutations. A background poll that lands while one is in
  // flight, or whose read was in flight across one, is stale and must be
  // discarded, otherwise it clobbers the optimistic state and the UI flickers;
  // the list is read again once they've settled. Every item mutation's request
  // goes through `mutations.track`, and is given up on after
  // ITEM_REQUEST_TIMEOUT_MS (`withRequestTimeout`), so a stalled one can't hold
  // off the polls for longer than that.
  const [mutations] = useState(createMutationTracker);

  // Whether a read of the list has landed yet. Until one has, an empty `items`
  // means the list couldn't be loaded, not that it has no items.
  const [itemsLoaded, setItemsLoaded] = useState(false);
  // Failed items reads the page showed the skeleton for (the first, or the one
  // after leaving Manage), and how many of them have been answered (see the
  // effect after `fetchItems`).
  const [itemsReadFailures, setItemsReadFailures] = useState(0);
  const itemsReadFailuresSeen = useRef(0);

  const fetchItems = useCallback(
    async (silent = false) => {
      if (!wishlistId) return;

      if (!silent) {
        setLoadingItems(true);
      }

      // The number the request went out as (see `readsSent`). It stays 0 for a
      // call that joins a read already on its way, whose own caller answers
      // for that read's refusal.
      let sentNo = 0;
      try {
        // Rejects when the read fails, so a failed poll or reconcile keeps the
        // list on screen: only a successful read replaces it. A call that joins
        // a read already in flight gets that read's `sentAt`, not a later one.
        const read = await fetchItemsHook(wishlistId, () => {
          sentNo = ++readsSent.current;
          return mutations.stamp();
        });
        // A read that raced with a mutation (landed while one was in flight, or
        // was sent before one settled) may predate fresher local state, so the
        // list is read again once no mutation is in flight. A background read's
        // result is dropped; a non-silent one (the first load, or the one after
        // leaving Manage) still lands, so the list isn't left empty.
        if (mutations.isStale(read.sentAt)) {
          mutations.rereadWhenIdle();
          if (silent) return;
        }
        setItems(read.items);
        setItemsLoaded(true);
      } catch (error) {
        // The list was deleted, archived or made private, or the viewer taken
        // off it, since the page loaded (or it never was theirs to see): the
        // list read's own answer, so the same state, and no more polls.
        if (error instanceof ReadRefusedError) {
          if (sentNo) void readRefused(sentNo);
          return;
        }
        console.error('Error fetching items:', error);
        if (!silent) {
          setItemsReadFailures((n) => n + 1);
        }
      } finally {
        if (!silent) {
          setLoadingItems(false);
        }
      }
    },
    [fetchItemsHook, wishlistId, mutations, readRefused]
  );

  // A failed items read the page showed the skeleton for is toasted, but only
  // about a list on screen. It can land before the list read, so it waits for
  // that: a list that turns out unavailable, or couldn't be read, says so itself.
  useEffect(() => {
    if (pageLoad === 'loading' || itemsReadFailures === itemsReadFailuresSeen.current) return;
    itemsReadFailuresSeen.current = itemsReadFailures;
    if (pageLoad === 'ready') showToast('Failed to load items', 'error');
  }, [pageLoad, itemsReadFailures, showToast]);

  useEffect(() => {
    // Not while the list is unavailable (every read would be refused again) or
    // couldn't be read: Try again starts it over.
    if (!polling) return;
    if (wishlistId && !manageOpen) {
      // Reset loading state when switching to items tab
      setLoadingItems(true);
      // While this tab polls, a read that turns out stale is followed by a
      // background one (see fetchItems).
      mutations.setReread(() => fetchItems(true));
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
        // Coming back to the items tab reads the list anyway, and a read still
        // in flight from here mustn't send another.
        mutations.setReread(null);
      };
    } else if (manageOpen) {
      // Reset loading state when switching away from items tab
      setLoadingItems(false);
    }
  }, [wishlistId, manageOpen, fetchItems, mutations, polling]);

  const createItemHook = useCreateItem(
    (newItem) => {
      // handleCreateItem tracks the request until after this runs, so a poll
      // whose read started before it settled is dropped instead of replacing
      // the list without the new item. One that read after the write may
      // already list it: don't add a second copy.
      setItems((prevItems) => prependCreatedItem(prevItems, newItem));
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

  // No success toast here — each delete handler says what it removed, and only
  // once the delete has succeeded.
  const deleteItemHook = useDeleteItem(undefined, (error) => {
    showToast(error, 'error');
  });

  const handleCreateItem = useCallback(
    async (itemData: {
      name: string;
      imageUrl?: string | null;
      price?: { value: number; currency: string } | null;
      link?: string | null;
      notes?: string | null;
      mostWanted?: boolean;
      status?: 'draft' | 'available';
    }) => {
      if (!wishlistId) return;
      // The hook toasts a failure and resolves null. Reject so AddItemModal
      // stays open with the user's input; it closes itself on success.
      const created = await mutations.track(() => createItemHook(wishlistId, itemData));
      if (!created) throw new Error('Failed to create item');
    },
    [createItemHook, wishlistId, mutations]
  );

  // Every item update (edit, book, publish, approve, ...) goes through here.
  // On success the server's item is merged into just this one: the PATCH
  // response carries a fresh priceInUsdCents, so a re-priced item sorts by its
  // new price straight away. On failure the hook has toasted the error, the
  // change is undone at once, the list is reconciled with the server, and this
  // resolves null (see updateItemOptimistically).
  const handleUpdateItem = useCallback(
    (id: string, updates: Partial<ApiItem>) =>
      updateItemOptimistically({
        id,
        apply: (item) => {
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
        },
        request: () => updateItemHook(id, updates),
        setItems,
        mutations,
        reconcile: () => fetchItems(true),
      }),
    [updateItemHook, session?.user?.id, fetchItems, mutations]
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
      const result = await mutations.track(async (): Promise<ApiResponse<ApiItem> | null> => {
        try {
          // Given up on after ITEM_REQUEST_TIMEOUT_MS, like the hooks' requests.
          return await withRequestTimeout(async (signal) => {
            const response = await fetch(`/api/wishlists/${wishlistId}/items`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(itemData),
              signal,
            });

            return await response.json();
          });
        } catch (error) {
          console.error('Error proposing item:', error);
          // A timeout says so; any other failure gets the generic message.
          return {
            success: false,
            error: error instanceof RequestTimeoutError ? error.message : undefined,
          };
        }
      });

      // Every failure rejects after its toast, so ProposeItemModal stays open
      // with the user's input; it closes itself on success.
      const proposed = result?.success ? result.data : undefined;
      if (!proposed) {
        const message = result?.error || 'Failed to propose item';
        showToast(message, 'error');
        throw new Error(message);
      }
      // Same poll guards as an owner's add (see createItemHook).
      setItems((prevItems) => prependCreatedItem(prevItems, proposed));
      showToast('Item proposed successfully', 'success');
    },
    [wishlistId, showToast, mutations]
  );

  const handleReviewItem = useCallback(
    async (updates: Partial<ApiItem> & { status: 'draft' | 'available' }) => {
      if (!itemToReview) return;
      // A failed approve is toasted and the proposal put back by
      // handleUpdateItem. Reject so ReviewItemModal stays open with the edits
      // (it closes itself on success): the owner is told "approved" only once
      // the server agreed.
      const approved = await handleUpdateItem(itemToReview._id, updates);
      if (!approved) throw new Error('Failed to approve item');
      showToast('Item approved successfully', 'success');
    },
    [itemToReview, handleUpdateItem, showToast]
  );

  const handleDeleteProposedItem = useCallback(async () => {
    if (!itemToReview) return;
    const itemId = itemToReview._id;
    // The hook toasts a failure and resolves false. Reject so ReviewItemModal
    // stays open and the item stays listed; it closes itself on success. The
    // request is tracked, so a poll whose read started before the delete
    // settled is dropped instead of bringing the deleted item back.
    const deleted = await mutations.track(() => deleteItemHook(itemId));
    if (!deleted) throw new Error('Failed to delete item');
    setItems((prevItems) => prevItems.filter((item) => item._id !== itemId));
    showToast('Proposed item deleted', 'success');
  }, [itemToReview, deleteItemHook, showToast, mutations]);

  const handleEditItem = useCallback((item: ApiItem) => {
    setItemToEdit(item);
  }, []);

  const handleSaveEdit = useCallback(
    async (updates: Partial<ApiItem>) => {
      if (!itemToEdit) return;
      const itemId = itemToEdit._id;
      // handleUpdateItem toasts a failure, puts the item back as it was and
      // resolves null. Reject so EditItemModal stays open with the user's
      // changes; it closes itself on success.
      const updated = await handleUpdateItem(itemId, updates);
      if (!updated) throw new Error('Failed to update item');
    },
    [itemToEdit, handleUpdateItem]
  );

  const handleDeleteItem = useCallback(async () => {
    if (!itemToEdit) return;
    const itemId = itemToEdit._id;
    // The hook toasts a failure and resolves false. Reject so EditItemModal
    // stays open and the item stays listed; it closes itself on success.
    // Same poll guard as handleDeleteProposedItem.
    const deleted = await mutations.track(() => deleteItemHook(itemId));
    if (!deleted) throw new Error('Failed to delete item');
    setItems((prevItems) => prevItems.filter((item) => item._id !== itemId));
    showToast('Item deleted successfully', 'success');
  }, [itemToEdit, deleteItemHook, showToast, mutations]);

  const handleInvite = useCallback(
    async (payload: { username: string; role: 'owner' | 'member' }) => {
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

  const refreshMembers = useCallback(async () => {
    if (!wishlistId) return;
    try {
      const res = await fetch(`/api/wishlists/${wishlistId}/members`, { cache: 'no-store' });
      const result = await res.json();
      if (result.success) setMembers(result.data || []);
    } catch {
      /* ignore */
    }
  }, [wishlistId]);

  const handleKickMember = useCallback(
    (memberId: string, username: string | undefined, isOwnerRow: boolean) => {
      setDeleteConfirm({
        // Owners aren't memberships — they're removed through the owners endpoint.
        type: isOwnerRow ? 'owner' : 'member',
        memberId,
        memberUsername: username || null,
      });
    },
    []
  );

  // An owner the page has just demoted or removed: off the count and the byline
  // at once, so the sole remaining owner isn't offered Leave. Recorded too, so a
  // read of the list the server answered before this landed can't put them back.
  const dropOwner = useCallback(
    (owner: RemovedOwner) => {
      ownerRemovals.removed(owner);
      setOwners((prev) => withoutOwner(prev, owner));
    },
    [ownerRemovals]
  );

  // Read the list's owners again after the page has changed them, so the count
  // and the byline are the server's (a co-owner's change since the page loaded,
  // a renamed owner). Only the owners: the rest of the list, and the settings
  // form, stay as they are.
  const refreshOwners = useCallback(async () => {
    if (!wishlistId) return;
    const sentAt = ownerRemovals.stamp();
    try {
      const res = await fetch(`/api/wishlists/${wishlistId}`, { cache: 'no-store' });
      const result = await res.json();
      if (!result.success || !result.data) return;
      const read = ownerRemovals.land(sentAt, shownOwnersOf(result.data));
      if (read) setOwners(read);
    } catch {
      /* the page keeps the owners it has */
    }
  }, [wishlistId, ownerRemovals]);

  // Opening Manage reads the owners again too, as it does the members: a
  // co-owner who accepted an invite since the page loaded then counts, so a
  // sole owner who invited one (as their Leave's notice says to) can leave
  // without reloading the page.
  useEffect(() => {
    if (isOwner && manageOpen) refreshOwners();
  }, [isOwner, manageOpen, refreshOwners]);

  const confirmKickMember = useCallback(async () => {
    if (
      !wishlistId ||
      !deleteConfirm ||
      (deleteConfirm.type !== 'member' && deleteConfirm.type !== 'owner') ||
      !deleteConfirm.memberId
    )
      return;

    const path =
      deleteConfirm.type === 'owner'
        ? `/api/wishlists/${wishlistId}/owners/${deleteConfirm.memberId}`
        : `/api/wishlists/${wishlistId}/members/${deleteConfirm.memberId}`;

    try {
      const response = await fetch(path, { method: 'DELETE' });
      const result = await response.json();

      if (result.success) {
        showToast(
          deleteConfirm.type === 'owner' ? 'Owner removed' : 'Member removed successfully',
          'success'
        );
        // Removing someone also cancels any invite they still had pending here.
        if (deleteConfirm.type === 'owner') {
          dropOwner({ id: deleteConfirm.memberId, username: deleteConfirm.memberUsername ?? null });
          await Promise.all([refreshMembers(), refreshInvites(), refreshOwners()]);
        } else {
          await Promise.all([refreshMembers(), refreshInvites()]);
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
  }, [
    wishlistId,
    deleteConfirm,
    showToast,
    refreshMembers,
    refreshInvites,
    dropOwner,
    refreshOwners,
  ]);

  /**
   * Send a member an invitation to become a co-owner. It's an invite, not a role
   * write: ownership puts the list on their profile and cancels the reservations
   * they hold here, so they have to accept it themselves. `member._id` on an owner
   * row is a *user* id — that's what the owners endpoints take.
   */
  const inviteAsOwner = useCallback(
    async (userId: string, username: string) => {
      if (!wishlistId) return;
      try {
        const res = await fetch(`/api/wishlists/${wishlistId}/owners/${userId}`, {
          method: 'POST',
        });
        const result = await res.json();
        if (result.success) {
          showToast(`Invitation sent — @${username} becomes an owner once they accept`, 'success');
          await refreshInvites();
        } else {
          showToast(result.error || 'Failed to send owner invitation', 'error');
        }
      } catch (error) {
        console.error('Error inviting owner:', error);
        showToast('Failed to send owner invitation', 'error');
      }
    },
    [wishlistId, showToast, refreshInvites]
  );

  // Owners whose demotion is still in flight. Tracked per row, so demoting one
  // owner doesn't lock or unlock another's buttons. The ref turns a second
  // demotion of the same owner away, whatever sent it: it's set before the
  // disabled state has rendered.
  const demotingRef = useRef<Set<string>>(new Set());
  const [demotingIds, setDemotingIds] = useState<ReadonlySet<string>>(() => new Set());

  /** Step an owner down to a plain member, once their row's dialog is confirmed. */
  const demoteOwner = useCallback(
    async (userId: string, username: string | null) => {
      if (!wishlistId || demotingRef.current.has(userId)) return;
      demotingRef.current.add(userId);
      setDemotingIds(new Set(demotingRef.current));
      try {
        const res = await fetch(`/api/wishlists/${wishlistId}/owners/${userId}`, {
          method: 'PATCH',
        });
        const result = await res.json();
        if (result.success) {
          showToast(`@${username || 'user'} is now a member`, 'success');
          dropOwner({ id: userId, username });
          // Demoting also cancels any invite they still had pending here.
          await Promise.all([refreshMembers(), refreshInvites(), refreshOwners()]);
        } else {
          showToast(result.error || 'Failed to update owner', 'error');
        }
      } catch (error) {
        console.error('Error demoting owner:', error);
        showToast('Failed to update owner', 'error');
      } finally {
        // After a success the refresh above has usually moved the row to
        // Members by now. After a failure this gives the buttons back, so the
        // owner can try again.
        demotingRef.current.delete(userId);
        setDemotingIds(new Set(demotingRef.current));
      }
    },
    [wishlistId, showToast, refreshMembers, refreshInvites, dropOwner, refreshOwners]
  );

  const confirmPromoteToOwner = useCallback(async () => {
    if (!promoteConfirm) return;
    const { userId, username } = promoteConfirm;
    // Closed once the invite settles, so the dialog shows it being sent meanwhile.
    try {
      await inviteAsOwner(userId, username);
    } finally {
      setPromoteConfirm(null);
    }
  }, [promoteConfirm, inviteAsOwner]);

  const confirmDemoteOwner = useCallback(async () => {
    if (!demoteConfirm) return;
    const { userId, username } = demoteConfirm;
    // Closed once the demotion and the reads after it settle, as Remove's is, so
    // the dialog shows it running meanwhile and the row has moved when it closes.
    try {
      await demoteOwner(userId, username);
    } finally {
      setDemoteConfirm(null);
    }
  }, [demoteConfirm, demoteOwner]);

  const handleLeaveWishlist = useCallback(() => {
    setDeleteConfirm({
      type: 'leave',
    });
  }, []);

  const inviteCoOwnerInstead = useCallback(() => {
    inviteOwnerOnClose.current = true;
    setSoleOwnerNotice(false);
  }, []);

  useEffect(() => {
    if (soleOwnerNotice || !inviteOwnerOnClose.current) return;
    inviteOwnerOnClose.current = false;
    inviteFormRef.current?.startOwnerInvite();
  }, [soleOwnerNotice]);

  const confirmLeaveWishlist = useCallback(async () => {
    if (!wishlistId || !deleteConfirm || deleteConfirm.type !== 'leave') return;

    // From the moment the leave may land: a poll refused because of it must
    // not show "not available" before the page moves on.
    departed.current = true;
    let left = false;
    try {
      const response = await fetch(`/api/wishlists/${wishlistId}/members/me`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (result.success) {
        left = true;
        // The count goes back to the gifter who left, and only to them.
        showToast(leftListToast(wishlist?.name, result.data?.unbookedItemsCount), 'success');
        router.push('/');
      } else {
        showToast(result.error || 'Failed to leave wishlist', 'error');
      }
    } catch (error) {
      console.error('Error leaving wishlist:', error);
      showToast('Failed to leave wishlist', 'error');
    } finally {
      if (!left) departed.current = false;
      setDeleteConfirm(null);
    }
  }, [wishlistId, deleteConfirm, wishlist?.name, router, showToast]);

  const handleDeleteWishlist = useCallback(() => {
    setDeleteConfirm({
      type: 'wishlist',
    });
  }, []);

  const confirmDeleteWishlist = useCallback(async () => {
    if (!wishlistId || !deleteConfirm || deleteConfirm.type !== 'wishlist') return;

    setIsDeletingWishlist(true);
    // As for leaving: the delete may land before its answer does.
    departed.current = true;
    let deleted = false;
    try {
      const response = await fetch(`/api/wishlists/${wishlistId}`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (result.success) {
        deleted = true;
        showToast('Wishlist deleted successfully', 'success');
        router.push('/');
      } else {
        showToast(result.error || 'Failed to delete wishlist', 'error');
      }
    } catch (error) {
      console.error('Error deleting wishlist:', error);
      showToast('Failed to delete wishlist', 'error');
    } finally {
      if (!deleted) departed.current = false;
      setDeleteConfirm(null);
      setIsDeletingWishlist(false);
    }
  }, [wishlistId, deleteConfirm, router, showToast]);

  // Archive or unarchive the list: from Manage, from the confirmation, or from
  // the archived banner's Unarchive.
  const setArchived = useCallback(
    async (archived: boolean) => {
      if (!wishlistId || archivingRef.current) return;
      archivingRef.current = true;
      setIsArchiving(true);
      try {
        const res = await fetch(`/api/wishlists/${wishlistId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archived }),
        });
        const result = await res.json();
        if (result.success) {
          setWishlist((prev) => (prev ? { ...prev, archived } : prev));
          showToast(archived ? 'Wishlist archived' : 'Wishlist unarchived', 'success');
        } else {
          showToast(result.error || 'Failed to update wishlist', 'error');
        }
      } catch {
        showToast('Failed to update wishlist', 'error');
      } finally {
        archivingRef.current = false;
        setIsArchiving(false);
      }
    },
    [wishlistId, showToast]
  );

  // Closed once the request settles, so the dialog shows it running meanwhile.
  const confirmArchive = useCallback(async () => {
    try {
      await setArchived(true);
    } finally {
      setArchiveConfirm(false);
    }
  }, [setArchived]);

  const ownerCount = owners.ids.length;
  // A co-owner may step down. The sole owner can't: their Leave in Manage
  // explains that they'd have to make someone else an owner first, or delete
  // the list.
  const canLeave = isOwner ? ownerCount > 1 : isMember;

  // The members endpoint returns one list; the UI shows the two relationships
  // separately, because they aren't rungs on a ladder.
  const ownerRows = useMemo(() => members.filter((m) => m.role === 'owner'), [members]);
  const memberRows = useMemo(() => members.filter((m) => m.role !== 'owner'), [members]);

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
    // "All", not "Total Items": an owner's includes drafts and proposals, and
    // "N items" means published items only (lib/utils/itemCounts.ts).
    all: { label: 'All', value: stats.total, valueClass: 'text-foreground' },
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

  // Not available, or not loaded: said in place, at this URL. Which way to put
  // "not available" depends only on whether the viewer is signed in, so it
  // waits for the session to be known.
  if ((refused && status !== 'loading') || pageLoad === 'failed') {
    return (
      <div className="min-h-screen">
        <AppHeader actions={<AuthButton />} />
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {refused ? (
            <WishlistUnavailable signedIn={status === 'authenticated'} />
          ) : (
            <LoadError level={1} title="Couldn’t load this wishlist" onRetry={retryLoad} />
          )}
        </main>
      </div>
    );
  }

  if (pageLoad !== 'ready' || !wishlist) {
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

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {/* Header: title + meta on the left, wishlist-scoped actions on the right.
            The title used to sit on the banner; it moved here so the banner can shrink
            into a side panel next to the stat cards below. */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          {/* With an occasion the row wraps, so on a phone its label can go under
              the name rather than squeeze it down to nothing. */}
          <div
            className={`flex min-w-0 flex-1 items-baseline ${
              wishlist.occasion ? 'flex-wrap gap-x-3 gap-y-1' : 'gap-3'
            }`}
          >
            <h1 className="min-w-0 truncate text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {wishlist.name}
            </h1>
            {/* Credit every owner: a co-owned list is equally each owner's. */}
            {ownerUsernames.length > 0 && (
              <span className="flex-shrink-0 whitespace-nowrap text-sm text-muted-foreground">
                by{' '}
                {ownerUsernames.slice(0, 2).map((name, i) => (
                  <span key={name}>
                    {i > 0 && ' & '}
                    {isOwner && name === session?.user?.username ? (
                      'you'
                    ) : (
                      <Link
                        href={`/users/${name}`}
                        className="font-semibold text-foreground underline-offset-2 hover:underline"
                      >
                        @{name}
                      </Link>
                    )}
                  </span>
                ))}
                {ownerUsernames.length > 2 && ` +${ownerUsernames.length - 2}`}
              </span>
            )}
            <OccasionLabel occasion={wishlist.occasion} />
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {/* An archived list's link opens for its owners only: anyone they'd
                share it with gets the answer a missing list gets. */}
            {!wishlist.archived && <ShareButton />}
            {canLeave && (
              <button
                onClick={handleLeaveWishlist}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[13px] font-semibold text-foreground shadow-xs transition-colors hover:bg-surface-hover"
              >
                <Icon name="logout" size={15} />
                Leave
              </button>
            )}
            {isOwner && (
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

        {/* Manage header (owners only) */}
        {manageOpen && isOwner && (
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
            {/* Archived: say so before anything else, with the way back. Only an
                owner ever gets an archived list, but the banner checks anyway. */}
            {isOwner && wishlist.archived && (
              <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-2.5 text-sm font-medium text-foreground">
                  <Icon
                    name="archive"
                    size={18}
                    className="flex-shrink-0 text-amber-600 dark:text-amber-400"
                  />
                  Archived. Only owners can see this list.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setArchived(false)}
                  disabled={isArchiving}
                  className="self-start sm:self-auto"
                >
                  Unarchive
                </Button>
              </div>
            )}

            {/* Image + description row */}
            <div
              className={`mb-6 grid gap-4 sm:mb-8 ${
                wishlist.description
                  ? 'sm:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] sm:items-start'
                  : 'sm:max-w-md'
              }`}
            >
              <Cover
                src={wishlist.bannerUrl}
                seed={wishlist._id.toString()}
                priority
                sizes="(max-width: 1024px) 100vw, 26rem"
                className="relative aspect-[16/9] overflow-hidden rounded-3xl border border-border bg-surface-2 shadow-md"
              >
                {/* Archived instead of the visibility on an archived list: it's
                    owner-only, whatever the visibility says. */}
                <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/20 px-2.5 py-1 text-[11.5px] font-semibold text-white backdrop-blur-md">
                  <Icon name={coverBadge(wishlist).icon} size={12} />
                  {coverBadge(wishlist).label}
                </span>
              </Cover>
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
                    onChange={handleSortChange}
                    ariaLabel="Sort items by"
                    triggerClassName="w-full"
                    options={SORT_OPTIONS}
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
              {isOwner && (
                <Button onClick={() => setShowAddItemModal(true)} size="md">
                  + Add Item
                </Button>
              )}
              {isMember && !isOwner && (
                <Button onClick={() => setShowProposeItemModal(true)} size="md">
                  + Propose Item
                </Button>
              )}
            </div>

            {/* Items Grid */}
            {loadingItems ? (
              <SkeletonGrid count={8} variant="item" />
            ) : !itemsLoaded && items.length === 0 ? (
              // No read has landed yet (the failed one toasted). Don't claim the
              // list is empty: the poll keeps retrying, and fills it in if one lands.
              <div className="flex flex-col items-center rounded-2xl border border-dashed border-border-strong py-16 text-center sm:py-20">
                <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/12 text-red-600 dark:text-red-400">
                  <Icon name="alert" size={28} />
                </span>
                <h3 className="text-lg font-semibold text-foreground sm:text-xl">
                  Failed to load items
                </h3>
                <p className="mx-auto mt-1.5 max-w-sm px-4 text-sm text-muted-foreground">
                  Try reloading the page.
                </p>
              </div>
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
                      // Owners can edit non-proposed items
                      // Proposers can edit their own proposed items
                      (isOwner && item.status !== 'proposed') ||
                      (item.status === 'proposed' &&
                        item.proposedBy?.toString() === session?.user?.id)
                        ? handleEditItem
                        : undefined
                    }
                    onReview={
                      isOwner && item.status === 'proposed'
                        ? () => setItemToReview(item)
                        : undefined
                    }
                    onSaveToList={
                      // Any signed-in viewer, owners too (to copy between their lists)
                      canCopyItem(item, session?.user?.id) ? setItemToSave : undefined
                    }
                    isAuthenticated={!!session?.user}
                    isOwner={isOwner}
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
            {isOwner && (
              <InviteMemberForm
                ref={inviteFormRef}
                onInvite={handleInvite}
                isInviting={isInviting}
              />
            )}

            {/* Owners and members are two different relationships to the list, not
                two points on a scale — so they get their own blocks with their own
                actions, rather than one list behind a role dropdown. */}
            <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
              <div className="border-b border-border px-4 py-4 sm:px-6">
                <h2 className="text-xl font-bold text-foreground">Owners</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Full control of this list, and it shows on each of their profiles. Owners never
                  see what&apos;s been booked.
                </p>
              </div>
              {loadingMembers ? (
                <div className="divide-y divide-border">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <MemberRowSkeleton key={i} />
                  ))}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {ownerRows.map((member) => {
                    const memberUserId = String(member.user._id);
                    const isCurrentUser = memberUserId === session?.user?.id;
                    // Owner changes are owners-only, never on yourself, and never on
                    // the last owner (a list must always keep one).
                    const canEditRow = isOwner && !isCurrentUser && ownerCount > 1;

                    return (
                      <div
                        key={memberUserId}
                        className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <Avatar
                            name={member.user.username || 'user'}
                            src={member.user.image}
                            size="md"
                          />
                          <Link
                            href={`/users/${member.user.username || ''}`}
                            className="break-words font-medium text-foreground transition-colors hover:text-accent dark:hover:text-primary-400"
                          >
                            @{member.user.username || 'user'}
                          </Link>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2">
                          {isCurrentUser && (
                            <span className="whitespace-nowrap text-sm text-muted-foreground">
                              You
                            </span>
                          )}
                          {canEditRow && (
                            <>
                              <button
                                onClick={() =>
                                  setDemoteConfirm({
                                    userId: memberUserId,
                                    username: member.user.username || null,
                                  })
                                }
                                disabled={demotingIds.has(memberUserId)}
                                className="cursor-pointer whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 sm:px-4"
                              >
                                Make member
                              </button>
                              <button
                                onClick={() =>
                                  handleKickMember(memberUserId, member.user.username, true)
                                }
                                disabled={demotingIds.has(memberUserId)}
                                className="cursor-pointer whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/10 sm:px-4"
                              >
                                Remove
                              </button>
                            </>
                          )}
                          {/* The sole owner can't leave (a list keeps an owner), so
                              theirs explains how to instead of asking to confirm. */}
                          {isCurrentUser && isOwner && (
                            <button
                              onClick={
                                canLeave ? handleLeaveWishlist : () => setSoleOwnerNotice(true)
                              }
                              className="cursor-pointer whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10 sm:px-4"
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

            <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
              <div className="border-b border-border px-4 py-4 sm:px-6">
                <h2 className="text-xl font-bold text-foreground">Members</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  They can browse the list, propose items, and reserve gifts. Making someone an
                  owner releases whatever they&apos;ve reserved here, since owners can&apos;t see
                  bookings.
                </p>
              </div>
              {loadingMembers ? (
                <div className="divide-y divide-border">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <MemberRowSkeleton key={i} />
                  ))}
                </div>
              ) : memberRows.length === 0 ? (
                <div className="px-4 py-12 text-center sm:px-6">
                  <p className="text-muted-foreground">No members yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {memberRows.map((member) => {
                    const memberUserId = String(member.user._id);
                    const isCurrentUser = memberUserId === session?.user?.id;

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
                          <Link
                            href={`/users/${member.user.username || ''}`}
                            className="break-words font-medium text-foreground transition-colors hover:text-accent dark:hover:text-primary-400"
                          >
                            @{member.user.username || 'user'}
                          </Link>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2">
                          {isCurrentUser && (
                            <span className="whitespace-nowrap text-sm text-muted-foreground">
                              You
                            </span>
                          )}
                          {isOwner && !isCurrentUser && (
                            <>
                              <button
                                onClick={() =>
                                  setPromoteConfirm({
                                    userId: memberUserId,
                                    username: member.user.username || 'this person',
                                  })
                                }
                                className="cursor-pointer whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted sm:px-4"
                              >
                                Make owner
                              </button>
                              <button
                                onClick={() =>
                                  handleKickMember(member._id, member.user.username, false)
                                }
                                className="cursor-pointer whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10 sm:px-4"
                              >
                                Remove
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Pending invites */}
            {isOwner && pendingInvites.length > 0 && (
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
        {manageOpen && isOwner && (
          <div className="mt-6 space-y-6">
            <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-foreground mb-4">Wishlist Settings</h3>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  // A one-off's date input is `required`; a yearly one's day
                  // and month pickers can't be, so they're checked here.
                  const missing = missingFromDraft(settingsForm.occasion);
                  if (missing) {
                    showToast(missing, 'error');
                    return;
                  }
                  // Only the settings changed here go, so a co-owner's change
                  // to any other one since the form was filled stays. With
                  // nothing changed there's nothing to write (and the API
                  // refuses an empty edit).
                  const sent = settingsForm;
                  const changes = settingsChanges(sent, settingsBaseline);
                  if (Object.keys(changes).length === 0) {
                    showToast('No changes to save', 'info');
                    return;
                  }
                  setIsSavingSettings(true);

                  try {
                    const response = await fetch(`/api/wishlists/${wishlistId}`, {
                      method: 'PATCH',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify(changes),
                    });

                    const result = await response.json();

                    if (result.success) {
                      setWishlist(result.data);
                      // Refill the form from the list as saved: what was sent,
                      // and a co-owner's change to anything that wasn't. The
                      // next save then diffs against that, not the first load.
                      refillSettings(wishlistSettings(result.data), sent);
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
                    onChange={(e) => editSettings({ name: e.target.value })}
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
                      onChange={(e) =>
                        editSettings({
                          slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                        })
                      }
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
                    onChange={(e) => editSettings({ description: e.target.value })}
                    className="w-full px-4 py-2 border border-border-strong rounded-xl outline-none"
                    rows={3}
                    disabled={isSavingSettings}
                    autoComplete="off"
                  />
                </div>

                <OccasionField
                  value={settingsForm.occasion}
                  saved={settingsBaseline.occasion}
                  onChange={(occasion) => editSettings({ occasion })}
                  disabled={isSavingSettings}
                />

                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">Currency</label>
                  <Select
                    value={settingsForm.currency}
                    onChange={(v) => editSettings({ currency: v })}
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
                    onChange={(url) => editSettings({ bannerUrl: url ?? '' })}
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
                        onClick={() => editSettings({ visibility: v })}
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
                    ? 'This wishlist is archived: only owners can see it. Unarchive it to open it again to members, and to anyone its visibility allows.'
                    : ARCHIVE_EXPLANATION}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => (wishlist.archived ? setArchived(false) : setArchiveConfirm(true))}
                  disabled={isArchiving}
                  className="sm:w-auto"
                  fullWidth
                >
                  <Icon name="archive" size={16} />
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
                    {ownerCount > 1 &&
                      ' Each owner pins their own highlight — this only affects yours.'}
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

              {/* Danger zone: deleting the list, for any owner */}
              {isOwner && (
                <div className="mt-6 sm:mt-8 pt-6 sm:pt-8 border-t border-border">
                  <h3 className="text-base sm:text-lg font-semibold text-foreground mb-2">
                    Danger zone
                  </h3>
                  <p className="text-xs sm:text-sm text-muted-foreground mb-4">
                    {DELETE_LIST_WARNING}
                  </p>
                  <Button
                    variant="danger"
                    onClick={handleDeleteWishlist}
                    disabled={isDeletingWishlist}
                    fullWidth
                    className="sm:w-auto"
                  >
                    {isDeletingWishlist ? 'Deleting...' : 'Delete wishlist'}
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
          wishlistCurrency={wishlist?.currency}
          userCurrency={session?.user?.defaultCurrency}
        />
      )}

      {showProposeItemModal && (
        <ProposeItemModal
          isOpen={showProposeItemModal}
          onClose={() => setShowProposeItemModal(false)}
          onPropose={handleProposeItem}
          wishlistCurrency={wishlist?.currency}
          userCurrency={session?.user?.defaultCurrency}
        />
      )}

      {itemToEdit && (
        <EditItemModal
          isOpen={!!itemToEdit}
          onClose={() => setItemToEdit(null)}
          onSave={handleSaveEdit}
          onDelete={handleDeleteItem}
          item={itemToEdit}
          wishlistCurrency={wishlist?.currency}
          userCurrency={session?.user?.defaultCurrency}
        />
      )}

      {itemToReview && (
        <ReviewItemModal
          isOpen={!!itemToReview}
          onClose={() => setItemToReview(null)}
          onApprove={handleReviewItem}
          onDelete={handleDeleteProposedItem}
          item={itemToReview}
          wishlistCurrency={wishlist?.currency}
          userCurrency={session?.user?.defaultCurrency}
        />
      )}

      {itemToSave && (
        <SaveToListModal
          item={itemToSave}
          userCurrency={session?.user?.defaultCurrency}
          mutations={mutations}
          onClose={() => setItemToSave(null)}
        />
      )}

      {/* Confirmation Dialogs. Each says what its action keeps as well as what it
          takes (lib/utils/confirmationCopy.ts). Only the leaving member's own
          dialog carries a count of reserved gifts: an owner's never does. */}
      {deleteConfirm &&
        (deleteConfirm.type === 'member' || deleteConfirm.type === 'owner') &&
        deleteConfirm.memberId && (
          <ConfirmDialog
            isOpen={!!deleteConfirm}
            {...removeFromListCopy(deleteConfirm.memberUsername, deleteConfirm.type)}
            onConfirm={confirmKickMember}
            onCancel={() => setDeleteConfirm(null)}
            confirmText="Remove"
            pendingText="Removing..."
            cancelText="Cancel"
            type="danger"
            icon="user-minus"
          />
        )}

      {deleteConfirm && deleteConfirm.type === 'leave' && (
        <ConfirmDialog
          isOpen={!!deleteConfirm}
          {...(isOwner
            ? ownerLeaveCopy(wishlist.name)
            : // Their own reservations, from the items already on the page.
              memberLeaveCopy(wishlist.name, itemsLoaded ? stats.bookedByYou : null))}
          onConfirm={confirmLeaveWishlist}
          onCancel={() => setDeleteConfirm(null)}
          confirmText="Leave"
          pendingText="Leaving..."
          cancelText="Cancel"
          type="danger"
          icon="logout"
        />
      )}

      {soleOwnerNotice && (
        <ConfirmDialog
          isOpen={soleOwnerNotice}
          title="You're the only owner"
          // A member is the likeliest successor, and inviting one is refused
          // ("promote them from the members list"), so the way to them comes first.
          message={
            memberRows.length > 0
              ? 'A wishlist needs at least one owner. To leave, make someone else an owner first: use Make owner next to one of your members, or invite a co-owner. Once they accept, you can leave. Or delete the wishlist instead.'
              : 'A wishlist needs at least one owner. To leave, invite a co-owner first; once they accept, you can leave. Or delete the wishlist instead.'
          }
          onConfirm={inviteCoOwnerInstead}
          onCancel={() => setSoleOwnerNotice(false)}
          confirmText="Invite a co-owner"
          cancelText="Cancel"
          type="info"
        />
      )}

      {promoteConfirm && (
        <ConfirmDialog
          isOpen={!!promoteConfirm}
          title="Make owner?"
          message={`@${promoteConfirm.username} will get the same full control you have — including deleting this wishlist — and it will appear on their profile as their own. Because owners can never see booking status, any items they've booked here will be released and their reservations cancelled. They have to accept the invitation first, and only another owner can undo it.`}
          onConfirm={confirmPromoteToOwner}
          onCancel={() => setPromoteConfirm(null)}
          confirmText="Send owner invite"
          pendingText="Sending..."
          cancelText="Cancel"
          type="warning"
        />
      )}

      {demoteConfirm && (
        <ConfirmDialog
          isOpen={!!demoteConfirm}
          title={`Make @${demoteConfirm.username || 'user'} a member?`}
          message="They keep access and can reserve gifts, but can no longer edit or manage the list. They'll be notified. Making them an owner again needs their acceptance."
          onConfirm={confirmDemoteOwner}
          onCancel={() => setDemoteConfirm(null)}
          confirmText="Make member"
          pendingText="Making member..."
          cancelText="Cancel"
          type="warning"
        />
      )}

      {archiveConfirm && (
        <ConfirmDialog
          isOpen={archiveConfirm}
          title="Archive wishlist?"
          message={ARCHIVE_EXPLANATION}
          onConfirm={confirmArchive}
          onCancel={() => setArchiveConfirm(false)}
          confirmText="Archive"
          pendingText="Archiving..."
          cancelText="Cancel"
          type="warning"
        />
      )}

      {deleteConfirm && deleteConfirm.type === 'wishlist' && (
        <ConfirmDialog
          isOpen={!!deleteConfirm}
          // Every item goes, drafts and proposals too. Reservations stay (they're
          // the gifters'), and an owner is told nothing about them.
          {...deleteListCopy(wishlist.name, itemsLoaded ? stats.total : null)}
          onConfirm={confirmDeleteWishlist}
          onCancel={() => setDeleteConfirm(null)}
          confirmText="Delete"
          pendingText="Deleting..."
          cancelText="Cancel"
          type="danger"
        />
      )}
    </div>
  );
}
