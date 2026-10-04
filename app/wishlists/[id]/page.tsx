'use client';

import { useEffect, useState, useMemo, useCallback, useRef, useId, type FormEvent } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import WishlistItem from '@/components/WishlistItem';
import AddItemTile from '@/components/AddItemTile';
import EditItemModal from '@/components/EditItemModal';
import AddItemModal from '@/components/AddItemModal';
import ProposeItemModal from '@/components/ProposeItemModal';
import ReviewItemModal from '@/components/ReviewItemModal';
import SaveToListModal from '@/components/SaveToListModal';
import AuthButton from '@/components/AuthButton';
import AppHeader from '@/components/AppHeader';
import ConfirmDialog from '@/components/ConfirmDialog';
import Button from '@/components/Button';
import SearchField from '@/components/SearchField';
import Icon from '@/components/Icon';
import InviteMemberForm, { type InviteMemberFormHandle } from '@/components/InviteMemberForm';
import { listStatusByUsername } from '@/lib/utils/inviteSuggestions';
import ShareButton from '@/components/ShareButton';
import Select from '@/components/Select';
import WishlistHeader, { WishlistHeaderSkeleton } from '@/components/WishlistHeader';
import JoinListCallout from '@/components/JoinListCallout';
import WishlistCover from '@/components/WishlistCover';
import WishlistDescription from '@/components/WishlistDescription';
import WishlistTabs, { listTabId, listTabPanelId } from '@/components/WishlistTabs';
import WishlistPeopleTab, {
  type PendingInvite,
  type WishlistPerson,
} from '@/components/WishlistPeopleTab';
import WishlistSettingsTab, { ARCHIVE_EXPLANATION } from '@/components/WishlistSettingsTab';
import {
  ListControlsSkeleton,
  Skeleton,
  SkeletonGrid,
  ITEM_GRID_CLASSES,
} from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import LoadError from '@/components/LoadError';
import WishlistUnavailable from '@/components/WishlistUnavailable';
import { readResource, ReadRefusedError } from '@/lib/utils/resourceRead';
import { missingFromDraft } from '@/lib/utils/occasion';
import { getVisibility } from '@/lib/utils/visibility';
import { onCurrentListTab, useListTab, type ListTab } from '@/lib/hooks/useListTab';
import { useBusyIds } from '@/lib/hooks/useBusyIds';
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
  searchItemsByName,
  savedWishlistSort,
  forgetSavedStatusFilters,
  DEFAULT_WISHLIST_SORT,
  SORT_OPTIONS,
  SORT_SHORT_LABELS,
  WISHLIST_SORT_STORAGE_KEY,
  type SortType,
} from '@/lib/utils/itemFilters';
import FilterChips from '@/components/FilterChips';
import type { ViewerRole } from '@/lib/utils/itemStatus';
import {
  addTileFor,
  countListChips,
  isDimmedInAll,
  listChips,
  LIST_CHIP_LABELS,
  orderListItems,
} from '@/lib/utils/listChips';
import { useListChip } from '@/lib/hooks/useListChip';
import { useListPrices } from '@/lib/hooks/useListPrices';
import { TONE_CLASSES } from '@/lib/utils/statusTones';
import { useReceivedToast } from '@/lib/hooks/useReceivedToast';
import { useReserveToast } from '@/lib/hooks/useReserveToast';
import { useFetchItems, useUpdateItem, useCreateItem, useDeleteItem } from '@/lib/hooks/useItems';

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
  // Everyone on the list, owners and members (owners only ever read it).
  const [members, setMembers] = useState<WishlistPerson[]>([]);
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
  // Where the first read of the people on the list stands (owners only):
  // until it has landed there's no count on People and no rows in it, and if
  // it failed, People says so, with Try again.
  const [membersRead, setMembersRead] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [isOwner, setIsOwner] = useState(false);
  const [isMember, setIsMember] = useState(false);
  // The tab the URL is on (`?tab=`). Only an owner has tabs: anyone else is
  // shown Items whatever the URL says, and their URL is left as it is.
  const [urlTab, chooseTab] = useListTab();
  const tab: ListTab = isOwner ? urlTab : 'items';
  const onItems = tab === 'items';
  const tabsId = useId();
  const [sortBy, setSortBy] = useState<SortType>(DEFAULT_WISHLIST_SORT);
  const [searchQuery, setSearchQuery] = useState('');
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
    /** What the removal's route takes: an owner's user id, a member's membership id. */
    memberId?: string;
    /** Their user id, which their row's actions are held by. */
    memberUserId?: string;
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
  // The sole owner's Leave list… (in the title's ⋯ menu) explains why they
  // can't and offers the way out instead: make someone else an owner (a member,
  // with Make owner, or an invited co-owner), then leave. Nothing in it leaves
  // or deletes anything.
  const [soleOwnerNotice, setSoleOwnerNotice] = useState(false);
  const inviteFormRef = useRef<InviteMemberFormHandle>(null);
  // Set by the notice's "Invite a co-owner", so the invite form (in People,
  // opened for it if need be) is set up once the notice has closed: by then its
  // scroll lock is gone (it puts the page back where it was) and focus can stay
  // on the form.
  const inviteOwnerOnClose = useRef(false);
  // Pin to my dashboard: in flight. The ref turns a second pick away before
  // the held item has rendered.
  const pinningRef = useRef(false);
  const [isPinning, setIsPinning] = useState(false);

  const fetchItemsHook = useFetchItems();

  // The viewer's role decides which status chips they get (none for a visitor).
  const viewerRole: ViewerRole = isOwner ? 'owner' : isMember ? 'member' : 'visitor';
  const viewerId = session?.user?.id ?? null;

  // The status chip the list is shown on: All on every list the page opens
  // (or the URL's ?show=), kept only for this list and role, and never saved.
  const [activeChip, chooseChip] = useListChip(
    wishlist ? { id: String(wishlist._id), slug: wishlist.slug } : null,
    wishlistId,
    viewerRole
  );

  // Restore the visitor's saved sort, else the default. It's one setting for
  // every list, so it's read once rather than per wishlist. A status filter an
  // earlier version saved is deleted, so it can't come back.
  useEffect(() => {
    setSortBy(savedWishlistSort(localStorage));
    forgetSavedStatusFilters(localStorage);
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
          if (url !== wishlistId) routerRef.current.replace(onCurrentListTab(`/wishlists/${url}`));
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
  // Reads of the invites and of the people, numbered as they're sent, and the
  // number of the latest one whose answer the page took. Each is read again
  // after every change the page makes (an invite, a demotion, a removal), and
  // opening People reads them too, so an older read that answers late (say,
  // the one opening People, after a demotion's) would put back what the
  // change took away: an answer sent before the one on screen is dropped.
  const invitesReads = useRef({ sent: 0, landed: 0 });
  const membersReads = useRef({ sent: 0, landed: 0 });

  const refreshInvites = useCallback(async () => {
    if (!wishlistId) return;
    const sentNo = ++invitesReads.current.sent;
    try {
      const res = await fetch(`/api/wishlists/${wishlistId}/invites`, { cache: 'no-store' });
      const result = await res.json();
      if (!result.success || sentNo < invitesReads.current.landed) return;
      invitesReads.current.landed = sentNo;
      setPendingInvites(result.data || []);
    } catch {
      /* ignore */
    }
  }, [wishlistId]);

  // Read the people on the list again (owners only). Only the first read
  // failing is shown (People says so): a later one keeps the rows it has.
  const refreshMembers = useCallback(async () => {
    if (!wishlistId) return;
    const sentNo = ++membersReads.current.sent;
    let read = false;
    try {
      const res = await fetch(`/api/wishlists/${wishlistId}/members`, { cache: 'no-store' });
      const result = await res.json();
      if (result.success) {
        read = true;
        if (sentNo < membersReads.current.landed) return;
        membersReads.current.landed = sentNo;
        setMembers(result.data || []);
      }
    } catch (error) {
      console.error('Error fetching members:', error);
    } finally {
      setMembersRead((prev) => (read ? 'loaded' : prev === 'loaded' ? prev : 'failed'));
    }
  }, [wishlistId]);

  // For an owner: the people, read once when the page knows it's an owner's
  // (People's count), and with the pending invites whenever People opens.
  const peopleOpen = tab === 'people';
  const membersReadFor = useRef<string | null>(null);
  useEffect(() => {
    if (!isOwner || !wishlistId) return;
    if (peopleOpen) void refreshInvites();
    if (!peopleOpen && membersReadFor.current === wishlistId) return;
    membersReadFor.current = wishlistId;
    void refreshMembers();
  }, [wishlistId, isOwner, peopleOpen, refreshMembers, refreshInvites]);

  // Try again, after the first read of the people failed.
  const retryMembers = useCallback(() => {
    setMembersRead('loading');
    void refreshMembers();
    void refreshInvites();
  }, [refreshMembers, refreshInvites]);

  // The page's item mutations. A background poll that lands while one is in
  // flight, or whose read was in flight across one, is stale and must be
  // discarded, otherwise it clobbers the optimistic state and the UI flickers;
  // the list is read again once they've settled. Every item mutation's request
  // goes through `mutations.track`, and is given up on after
  // ITEM_REQUEST_TIMEOUT_MS (`withRequestTimeout`), so a stalled one can't hold
  // off the polls for longer than that.
  const [mutations] = useState(createMutationTracker);

  // Whether a read of the items has landed yet (`itemsShown` too, for
  // `fetchItems` to read). Until one has, an empty `items` doesn't mean the
  // list has no items, so the page shows no counts or controls for them: the
  // skeleton while the first read is on its way, and if it failed
  // (`itemsFailed`) a panel saying so, with Try again. A poll that lands
  // meanwhile fills the list in.
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const itemsShown = useRef(false);
  const [itemsFailed, setItemsFailed] = useState(false);
  // Failed items reads the page showed the skeleton for once the items had
  // been shown (the one after coming back to Items), and how many of them have been
  // answered (see the effect after `fetchItems`).
  const [itemsReadFailures, setItemsReadFailures] = useState(0);
  const itemsReadFailuresSeen = useRef(0);

  const fetchItems = useCallback(
    async (silent = false) => {
      if (!wishlistId) return;

      if (!silent) {
        setLoadingItems(true);
        // The skeleton again, not the panel, while this read is on its way.
        setItemsFailed(false);
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
        // coming back to Items) still lands, so the list isn't left empty.
        if (mutations.isStale(read.sentAt)) {
          mutations.rereadWhenIdle();
          if (silent) return;
        }
        setItems(read.items);
        setItemsLoaded(true);
        setItemsFailed(false);
        itemsShown.current = true;
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
          // Until the items have been shown, the panel in their place says so.
          if (itemsShown.current) setItemsReadFailures((n) => n + 1);
          else setItemsFailed(true);
        }
      } finally {
        if (!silent) {
          setLoadingItems(false);
        }
      }
    },
    [fetchItemsHook, wishlistId, mutations, readRefused]
  );

  // Try again, after the first items read failed: the skeleton, then a fresh read.
  const retryItems = useCallback(() => {
    void fetchItems();
  }, [fetchItems]);

  // A failed items read the page showed the skeleton for, once the items had
  // been shown, is toasted, but only about a list on screen. It waits for the
  // list read to have landed: a list that turns out unavailable, or couldn't be
  // read, says so itself.
  useEffect(() => {
    if (pageLoad === 'loading' || itemsReadFailures === itemsReadFailuresSeen.current) return;
    itemsReadFailuresSeen.current = itemsReadFailures;
    if (pageLoad === 'ready') showToast('Failed to load items', 'error');
  }, [pageLoad, itemsReadFailures, showToast]);

  useEffect(() => {
    // Not while the list is unavailable (every read would be refused again) or
    // couldn't be read: Try again starts it over.
    if (!polling) return;
    if (wishlistId && onItems) {
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
    } else if (!onItems) {
      // Reset loading state when switching away from items tab
      setLoadingItems(false);
    }
  }, [wishlistId, onItems, fetchItems, mutations, polling]);

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

  // A member's reserve says what it means and where it lives (WIS-260).
  const reserveOwnerNames = useMemo(
    () => (owners.ids.length === 1 ? owners.usernames : []),
    [owners]
  );
  const handleReservableUpdate = useReserveToast<ApiItem>(
    (id, updates) => handleUpdateItem(id, updates as Partial<ApiItem>),
    { isOwner, ownerUsernames: reserveOwnerNames }
  );
  const handleCardUpdate = useReceivedToast<ApiItem>(handleReservableUpdate);

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
      showToast(updates.status === 'draft' ? 'Added as a draft' : 'Added to the list', 'success');
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
    showToast('Proposal declined', 'success');
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

  // The People rows with an action in flight: by user id for an owner's or a
  // member's row, by invite id for an invite's. A row's actions are held until
  // its own request settles, and a second one for it is turned away, whatever
  // sent it (a double click on a dialog's confirm included).
  const { busy: rowBusy, run: runRowAction } = useBusyIds();

  /** Cancel a pending invite: an invite's row, or a member's owner invite (`busyId`: its row). */
  const cancelInvite = useCallback(
    (inviteId: string, busyId: string) =>
      runRowAction(busyId, async () => {
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
            await refreshInvites();
          }
        } catch {
          showToast('Failed to cancel invitation', 'error');
          await refreshInvites();
        }
      }),
    [wishlistId, showToast, refreshInvites, runRowAction]
  );

  const handleKickMember = useCallback(
    (person: { id: string; userId: string; username: string | null; role: 'owner' | 'member' }) => {
      setDeleteConfirm({
        // Owners aren't memberships — they're removed through the owners endpoint.
        type: person.role,
        memberId: person.id,
        memberUserId: person.userId,
        memberUsername: person.username,
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
  // Resolves with the owners it read, or `null` when it read none the page took.
  const refreshOwners = useCallback(async (): Promise<ShownOwners | null> => {
    if (!wishlistId) return null;
    const sentAt = ownerRemovals.stamp();
    try {
      const res = await fetch(`/api/wishlists/${wishlistId}`, { cache: 'no-store' });
      const result = await res.json();
      if (!result.success || !result.data) return null;
      const read = ownerRemovals.land(sentAt, shownOwnersOf(result.data));
      if (read) setOwners(read);
      return read;
    } catch {
      /* the page keeps the owners it has */
      return null;
    }
  }, [wishlistId, ownerRemovals]);

  // Opening People reads the owners again too, as it does the members: a
  // co-owner who accepted an invite since the page loaded then counts, so a
  // sole owner who invited one (as their Leave's notice says to) can leave
  // without reloading the page.
  useEffect(() => {
    if (isOwner && peopleOpen) refreshOwners();
  }, [isOwner, peopleOpen, refreshOwners]);

  const confirmKickMember = useCallback(async () => {
    if (
      !wishlistId ||
      !deleteConfirm ||
      (deleteConfirm.type !== 'member' && deleteConfirm.type !== 'owner') ||
      !deleteConfirm.memberId
    )
      return;

    const { type, memberId, memberUsername } = deleteConfirm;
    const path =
      type === 'owner'
        ? `/api/wishlists/${wishlistId}/owners/${memberId}`
        : `/api/wishlists/${wishlistId}/members/${memberId}`;

    try {
      await runRowAction(deleteConfirm.memberUserId ?? memberId, async () => {
        try {
          const response = await fetch(path, { method: 'DELETE' });
          const result = await response.json();

          if (result.success) {
            showToast(
              type === 'owner' ? 'Owner removed' : 'Member removed successfully',
              'success'
            );
            // Removing someone also cancels any invite they still had pending here.
            if (type === 'owner') {
              dropOwner({ id: memberId, username: memberUsername ?? null });
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
        }
      });
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
    runRowAction,
  ]);

  /**
   * Send a member an invitation to become a co-owner. It's an invite, not a role
   * write: ownership puts the list on their profile and cancels the reservations
   * they hold here, so they have to accept it themselves. `member._id` on an owner
   * row is a *user* id — that's what the owners endpoints take.
   */
  const inviteAsOwner = useCallback(
    (userId: string, username: string) =>
      runRowAction(userId, async () => {
        if (!wishlistId) return;
        try {
          const res = await fetch(`/api/wishlists/${wishlistId}/owners/${userId}`, {
            method: 'POST',
          });
          const result = await res.json();
          if (result.success) {
            showToast(
              `Invitation sent — @${username} becomes an owner once they accept`,
              'success'
            );
            await refreshInvites();
          } else {
            showToast(result.error || 'Failed to send owner invitation', 'error');
          }
        } catch (error) {
          console.error('Error inviting owner:', error);
          showToast('Failed to send owner invitation', 'error');
        }
      }),
    [wishlistId, showToast, refreshInvites, runRowAction]
  );

  /**
   * Step an owner down to a plain member, once their row's dialog is confirmed.
   * Held on their row while it runs, so a second demotion of the same owner is
   * turned away, whatever sent it, and a failed one gives the row back.
   */
  const demoteOwner = useCallback(
    (userId: string, username: string | null) =>
      runRowAction(userId, async () => {
        if (!wishlistId) return;
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
        }
      }),
    [wishlistId, showToast, refreshMembers, refreshInvites, dropOwner, refreshOwners, runRowAction]
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
    // The invite form is on People, which renders it as the notice closes.
    chooseTab('people');
    setSoleOwnerNotice(false);
  }, [chooseTab]);

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

  // Archive or unarchive the list: from Settings, from the confirmation, or
  // from the archived banner's Unarchive.
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
  // A co-owner may step down. The sole owner can't: their Leave list…
  // explains that they'd have to make someone else an owner first, or delete
  // the list.
  const canLeave = isOwner ? ownerCount > 1 : isMember;

  // Leave list…, from the title's ⋯ menu: confirm, or for the sole owner, why
  // not. The page counted its owners when it last read them, which can predate
  // a co-owner accepting the invite the notice pointed the sole owner to, so
  // their owners are read again first: once that co-owner counts, they're asked
  // to confirm instead of being told they can't. Its members are read too
  // (People may never have been opened), since the notice points to Make owner
  // only when there's a member to make one, and People opens behind the notice,
  // so the members' Make owner it points to is there once it closes. A read
  // that fails leaves them the sole owner, as the page counted. The ref turns
  // a second pick away while the reads are out.
  const checkingLeaveRef = useRef(false);
  const startLeave = useCallback(async () => {
    if (canLeave) {
      handleLeaveWishlist();
      return;
    }
    if (!isOwner || checkingLeaveRef.current) return;
    checkingLeaveRef.current = true;
    try {
      const [fresh] = await Promise.all([refreshOwners(), refreshMembers()]);
      if (fresh && fresh.ids.length > 1) {
        handleLeaveWishlist();
      } else {
        chooseTab('people');
        setSoleOwnerNotice(true);
      }
    } finally {
      checkingLeaveRef.current = false;
    }
  }, [canLeave, isOwner, handleLeaveWishlist, refreshOwners, refreshMembers, chooseTab]);

  // Pin to my dashboard: the caller's own pin only (`featuredBy`), so a
  // co-owner's dashboard is untouched. The answer to `featured` is the
  // caller's, as the list read gives it.
  const togglePinned = useCallback(async () => {
    if (!wishlistId || !wishlist || pinningRef.current) return;
    const pin = !wishlist.featured;
    pinningRef.current = true;
    setIsPinning(true);
    try {
      const res = await fetch(`/api/wishlists/${wishlistId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featured: pin }),
      });
      const result = await res.json();
      if (result.success) {
        setWishlist((prev) => (prev ? { ...prev, featured: pin } : prev));
        showToast(pin ? 'Pinned to your dashboard' : 'Unpinned from your dashboard', 'success');
      } else {
        showToast(result.error || 'Failed to update wishlist', 'error');
      }
    } catch {
      showToast('Failed to update wishlist', 'error');
    } finally {
      pinningRef.current = false;
      setIsPinning(false);
    }
  }, [wishlistId, wishlist, showToast]);

  // The members endpoint returns one list; the UI shows the two relationships
  // separately, because they aren't rungs on a ladder.
  const memberRows = useMemo(() => members.filter((m) => m.role !== 'owner'), [members]);
  // People's count: everyone on the list, owners and members, once read.
  const peopleCount = membersRead === 'loaded' ? members.length : null;

  // Whether a save would send anything: the form as `settingsChanges` sees it,
  // so a field typed and put back, or changed only in case or spaces, isn't.
  const settingsDirty = useMemo(
    () => Object.keys(settingsChanges(settingsForm, settingsBaseline)).length > 0,
    [settingsForm, settingsBaseline]
  );

  // Discard: the form as it was last filled from the list.
  const discardSettings = useCallback(() => {
    setSettings((s) => ({ ...s, form: settingsFormFor(s.saved) }));
  }, []);

  const saveSettings = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      // A one-off's date input is `required`; a yearly one's day and month
      // pickers can't be, so they're checked here.
      const missing = missingFromDraft(settingsForm.occasion);
      if (missing) {
        showToast(missing, 'error');
        return;
      }
      // Only the settings changed here go, so a co-owner's change to any other
      // one since the form was filled stays. With nothing changed there's
      // nothing to write (and the API refuses an empty edit): the save bar
      // isn't there then, but Enter in a field still submits.
      const sent = settingsForm;
      const changes = settingsChanges(sent, settingsBaseline);
      if (Object.keys(changes).length === 0) return;
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
          // The caller's pin isn't a setting: a save never changes it, and its
          // answer can predate a Pin to my dashboard picked from the header
          // while it was out.
          setWishlist((prev) => ({
            ...result.data,
            featured: prev ? prev.featured : result.data.featured,
          }));
          // Refill the form from the list as saved: what was sent, and a
          // co-owner's change to anything that wasn't. The next save then
          // diffs against that, not the first load.
          refillSettings(wishlistSettings(result.data), sent);
          showToast('Wishlist updated successfully', 'success');
          // Keep the URL in sync when the slug changes (or upgrade an id-based
          // URL to the slug), on the tab it's on.
          const newSlug = result.data?.slug as string | undefined;
          if (newSlug && newSlug !== wishlistId) {
            router.replace(onCurrentListTab(`/wishlists/${newSlug}`));
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
    },
    [settingsForm, settingsBaseline, wishlistId, refillSettings, router, showToast]
  );
  // Who each username suggestion in the invite form already is on the list.
  const inviteStatuses = useMemo(
    () =>
      listStatusByUsername({
        owners: owners.usernames,
        members: memberRows.map((m) => ({
          userId: String(m.user._id),
          username: m.user.username,
        })),
        invited: pendingInvites.map((i) => i.username),
      }),
    [owners.usernames, memberRows, pendingInvites]
  );

  // Each chip's count, by the rules the chips filter with (lib/utils/listChips.ts).
  const chipCounts = useMemo(
    () => countListChips(items, viewerRole, viewerId),
    [items, viewerRole, viewerId]
  );

  // The items under the chip, actionable ones first under All, in the
  // viewer's sort within each group.
  const chipItems = useMemo(
    () => orderListItems(items, activeChip, viewerRole, viewerId, sortBy),
    [items, activeChip, viewerRole, viewerId, sortBy]
  );

  const sortedItems = useMemo(
    () => searchItemsByName(chipItems, searchQuery),
    [chipItems, searchQuery]
  );

  // The list has no items at all, as far as this viewer can see: no filter is
  // hiding anything, so the chips and the toolbar step aside for an empty
  // state that says so and offers the add itself. Only once a read has
  // landed: before that, no items means it hasn't loaded.
  const listIsEmpty = itemsLoaded && items.length === 0;

  // With the toolbar gone, a chip or search still in force couldn't be seen,
  // and could hide the next item added (Received, a search for the item just
  // deleted), so a list that empties goes back to All.
  useEffect(() => {
    if (!listIsEmpty) return;
    chooseChip('all');
    setSearchQuery('');
  }, [listIsEmpty, chooseChip]);

  // The way out of a search or chip that hides every item: All, and no search.
  const showAllItems = useCallback(() => {
    chooseChip('all');
    setSearchQuery('');
  }, [chooseChip]);

  // Clear the item search when switching to a different wishlist.
  useEffect(() => setSearchQuery(''), [wishlistId]);

  // Prices (D9): someone else's list starts in the viewer's currency, their
  // own on each item's; offered only when some price is in another currency.
  const prices = useListPrices({
    viewerId,
    defaultCurrency: session?.user?.defaultCurrency,
    ownList: isOwner,
    items,
  });

  // The grid's first cell: an owner's Add item or a member's Propose an item,
  // under All (and a member's Your proposals), never while a search is on.
  const addTile = addTileFor(viewerRole, activeChip, searchQuery.trim() !== '');

  const chips = listChips(viewerRole).map((chip) => ({
    value: chip,
    label: LIST_CHIP_LABELS[chip],
    count: chipCounts[chip],
  }));

  // The tab on screen is the panel an owner's tab bar controls. Nobody else
  // has tabs, so their items are just the page.
  const tabPanel = isOwner
    ? {
        role: 'tabpanel',
        id: listTabPanelId(tabsId),
        'aria-labelledby': listTabId(tabsId, tab),
      }
    : {};

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
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
          {/* Header: the name, the meta line, the actions. No cover strip or
              description: a list may have neither, so the skeleton doesn't
              promise them. */}
          <WishlistHeaderSkeleton />
          {/* Always the Items layout, whatever ?tab= says: until the list has
              loaded, the viewer's role isn't known, and only an owner may see
              anything that hints at the tabs. An owner's tab replaces it once
              the list lands. */}
          {/* Signed out, the viewer is a visitor, who gets the note on getting
              invited (its text wraps to three lines on a phone, two at sm, one
              at lg, over Sign in). Signed in, the role isn't known yet. */}
          {status === 'unauthenticated' && (
            <Skeleton className="mb-6 h-[8.625rem] rounded-xl sm:mb-8 sm:h-[7.25rem] lg:h-[6.125rem]" />
          )}
          {/* The status chips and toolbar. The role isn't known yet: signed out,
              it's a visitor's, with no chips; otherwise a member's four. */}
          <ListControlsSkeleton chips={status === 'unauthenticated' ? 0 : 4} />
          <SkeletonGrid count={8} variant="item" />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {/* The banner, as a short strip across the top (none without one), then
            the name, the meta line (owners, occasion, visibility) and the
            viewer's actions, with Leave list… and Pin in the ⋯ menu, then the
            description. The same on every tab, so moving between them doesn't move them. */}
        <WishlistCover bannerUrl={wishlist.bannerUrl} seed={wishlist._id.toString()} />
        <WishlistHeader
          name={wishlist.name}
          ownerUsernames={ownerUsernames}
          viewerUsername={session?.user?.username}
          role={viewerRole}
          occasion={wishlist.occasion}
          visibility={wishlist.visibility}
          archived={wishlist.archived}
          pinned={!!wishlist.featured}
          pinning={isPinning}
          // From People or Settings too, back on Items, where the item lands.
          onAddItem={() => {
            chooseTab('items');
            setShowAddItemModal(true);
          }}
          onPropose={() => setShowProposeItemModal(true)}
          onTogglePin={togglePinned}
          onLeave={startLeave}
          // An archived list's link opens for its owners only: anyone they'd
          // share it with gets the answer a missing list gets.
          share={
            !wishlist.archived && (
              <ShareButton
                url={`/wishlists/${wishlist.slug || wishlist._id}`}
                title={wishlist.name}
                // Inviting happens on People, with its invite form on top.
                owner={
                  isOwner
                    ? {
                        visibility: wishlist.visibility,
                        archived: wishlist.archived,
                        onInvite: () => chooseTab('people'),
                      }
                    : undefined
                }
              />
            )
          }
        />
        {wishlist.description && <WishlistDescription text={wishlist.description} />}

        {/* How to get invited, for anyone who isn't on the list (signed out,
            or signed in but neither an owner nor a member). An archived list
            only ever opens for its owners, but this checks anyway. */}
        {viewerRole === 'visitor' && !wishlist.archived && (
          <JoinListCallout
            ownerUsernames={ownerUsernames}
            ownerCount={owners.ids.length}
            viewer={session?.user ? { username: session.user.username } : null}
          />
        )}

        {/* An owner's tabs: Items · People (n) · Settings, in the URL (`?tab=`). */}
        {isOwner && (
          <WishlistTabs
            value={tab}
            onChange={chooseTab}
            peopleCount={peopleCount}
            idBase={tabsId}
          />
        )}

        {/* Items Tab */}
        {onItems && (
          <div {...tabPanel}>
            {/* Archived: say so before anything else, with the way back. Only an
                owner ever gets an archived list, but the banner checks anyway. */}
            {isOwner && wishlist.archived && (
              <div
                className={`mb-6 flex flex-col gap-3 rounded-2xl px-4 py-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between ${TONE_CLASSES.warning.notice}`}
              >
                <p className="flex items-center gap-2.5 text-sm font-medium text-foreground">
                  <Icon
                    name="archive"
                    size={18}
                    className={`flex-shrink-0 ${TONE_CLASSES.warning.text}`}
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

            {!itemsLoaded ? (
              // No read of the items has landed yet: no counts or controls,
              // which would claim the list is empty (see `itemsLoaded`).
              itemsFailed ? (
                <LoadError title="Couldn’t load this list’s items" onRetry={retryItems} />
              ) : (
                <>
                  {/* The chips and toolbar to come, as they'll be laid out */}
                  <ListControlsSkeleton chips={listChips(viewerRole).length} />
                  <SkeletonGrid count={8} variant="item" />
                </>
              )
            ) : (
              <>
                {/* Chips and toolbar: not on an empty list, where the chips
                would all be zero, the filters would have nothing to filter, and
                the empty state below offers the add (or the proposal) itself */}
                {!listIsEmpty && (
                  <>
                    {/* The status chips (none for a visitor): one row, one choice */}
                    {chips.length > 0 && (
                      <FilterChips
                        chips={chips}
                        value={activeChip}
                        onChange={chooseChip}
                        ariaLabel="Show items"
                        className="mb-4"
                      />
                    )}

                    {/* Toolbar: search, Sort, and Prices when it changes anything. One
                        row from sm up; on a phone, search gets a row of its own. */}
                    <div className="mb-6 flex flex-wrap items-center gap-2 sm:mb-8 sm:flex-nowrap sm:gap-3">
                      <SearchField
                        size="sm"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onClear={() => setSearchQuery('')}
                        placeholder="Search items…"
                        aria-label="Search items by name"
                        className="w-full sm:w-auto sm:min-w-0 sm:flex-1"
                      />
                      <Select
                        value={sortBy}
                        onChange={handleSortChange}
                        ariaLabel="Sort items by"
                        options={SORT_OPTIONS}
                        valueLabel={SORT_SHORT_LABELS[sortBy]}
                        menuAlign="right"
                        triggerClassName="min-w-0 flex-1 sm:flex-none sm:flex-shrink-0"
                      />
                      {prices.shown && (
                        <Select
                          value={prices.value}
                          onChange={prices.choose}
                          options={prices.options}
                          valueLabel={prices.valueLabel}
                          ariaLabel="Show prices in"
                          menuAlign="right"
                          triggerClassName="flex-shrink-0"
                        />
                      )}
                    </div>
                  </>
                )}

                {/* Items Grid */}
                {loadingItems ? (
                  <SkeletonGrid count={8} variant="item" />
                ) : listIsEmpty ? (
                  // Nothing on the list (that this viewer can see), so it says so,
                  // with what each role can do about it, rather than blaming a filter.
                  <EmptyState
                    tone="muted"
                    icon="gift"
                    title={
                      isOwner
                        ? 'Your list is empty'
                        : isMember
                          ? 'Nothing here yet'
                          : 'No items yet'
                    }
                    body={
                      isOwner
                        ? "Add the things you'd love to get. You can keep them as drafts until you're ready to share."
                        : undefined
                    }
                    actions={
                      isOwner ? (
                        <>
                          <Button onClick={() => setShowAddItemModal(true)}>
                            Add your first item
                          </Button>
                          {/* Not on an archived list, as the header's Share isn't. */}
                          {!wishlist.archived && (
                            <ShareButton
                              variant="button"
                              url={`/wishlists/${wishlist.slug || wishlist._id}`}
                              title={wishlist.name}
                              owner={{
                                visibility: wishlist.visibility,
                                archived: wishlist.archived,
                                onInvite: () => chooseTab('people'),
                              }}
                            />
                          )}
                        </>
                      ) : isMember ? (
                        <Button onClick={() => setShowProposeItemModal(true)}>
                          Propose an item
                        </Button>
                      ) : undefined
                    }
                  />
                ) : sortedItems.length === 0 ? (
                  // There are items, but the search or the chip hides every one.
                  <EmptyState
                    tone="muted"
                    icon="package"
                    title="No items found"
                    body={
                      searchQuery.trim()
                        ? `No items match “${searchQuery.trim()}”.`
                        : 'No items match this filter.'
                    }
                    actions={
                      <>
                        {/* A member's Your proposals with none yet: the tile's
                            way to make one, since there's no grid to hold it. */}
                        {addTile === 'propose' && (
                          <Button onClick={() => setShowProposeItemModal(true)}>
                            Propose an item
                          </Button>
                        )}
                        <Button onClick={showAllItems} variant="secondary">
                          Show all
                        </Button>
                      </>
                    }
                  />
                ) : (
                  <div className={ITEM_GRID_CLASSES}>
                    {addTile && (
                      <AddItemTile
                        label={addTile === 'add' ? 'Add item' : 'Propose an item'}
                        onClick={() =>
                          addTile === 'add'
                            ? setShowAddItemModal(true)
                            : setShowProposeItemModal(true)
                        }
                      />
                    )}
                    {sortedItems.map((item) => (
                      <WishlistItem
                        key={item._id}
                        item={item}
                        onUpdate={handleCardUpdate}
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
                        priceCurrency={prices.value}
                        rates={prices.rates}
                        dimmed={activeChip === 'all' && isDimmedInAll(item, viewerRole, viewerId)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'people' && (
          <div {...tabPanel}>
            <WishlistPeopleTab
              inviteForm={
                <InviteMemberForm
                  ref={inviteFormRef}
                  onInvite={handleInvite}
                  isInviting={isInviting}
                  statuses={inviteStatuses}
                  // A member's suggestion makes them a co-owner through the same
                  // confirmation and promotion invite as their Make owner….
                  onPromote={setPromoteConfirm}
                />
              }
              people={members}
              invites={pendingInvites}
              viewerId={viewerId}
              linkOpensForOthers={!wishlist.archived && getVisibility(wishlist) !== 'private'}
              ownerCount={ownerCount}
              loading={membersRead === 'loading'}
              failed={membersRead === 'failed'}
              onRetry={retryMembers}
              busy={rowBusy}
              onDemote={setDemoteConfirm}
              onPromote={setPromoteConfirm}
              onRemove={handleKickMember}
              onCancelInvite={cancelInvite}
            />
          </div>
        )}

        {tab === 'settings' && (
          <div {...tabPanel}>
            <WishlistSettingsTab
              form={settingsForm}
              saved={settingsBaseline}
              dirty={settingsDirty}
              saving={isSavingSettings}
              onEdit={editSettings}
              onSubmit={saveSettings}
              onDiscard={discardSettings}
              archived={!!wishlist.archived}
              archiving={isArchiving}
              onArchive={() => setArchiveConfirm(true)}
              onUnarchive={() => setArchived(false)}
              deleting={isDeletingWishlist}
              onDelete={handleDeleteWishlist}
            />
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
            pendingText="Removing…"
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
              memberLeaveCopy(wishlist.name, itemsLoaded ? chipCounts['reserved-by-you'] : null))}
          onConfirm={confirmLeaveWishlist}
          onCancel={() => setDeleteConfirm(null)}
          confirmText="Leave"
          pendingText="Leaving…"
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
              ? 'A wishlist needs at least one owner. To leave, make someone else an owner first: pick Make owner… in one of your members’ menus on People, or invite a co-owner. Once they accept, you can leave. Or delete the wishlist instead.'
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
          message={`@${promoteConfirm.username} will get the same full control you have — including deleting this wishlist — and it will appear on their profile as their own. Because owners can never see reservations, anything they've reserved here will be released and their reservations cancelled. They have to accept the invitation first, and only another owner can undo it.`}
          onConfirm={confirmPromoteToOwner}
          onCancel={() => setPromoteConfirm(null)}
          confirmText="Send owner invite"
          pendingText="Sending…"
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
          pendingText="Making member…"
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
          pendingText="Archiving…"
          cancelText="Cancel"
          type="warning"
        />
      )}

      {deleteConfirm && deleteConfirm.type === 'wishlist' && (
        <ConfirmDialog
          isOpen={!!deleteConfirm}
          // Every item goes, drafts and proposals too. Reservations stay (they're
          // the gifters'), and an owner is told nothing about them.
          {...deleteListCopy(wishlist.name, itemsLoaded ? items.length : null)}
          onConfirm={confirmDeleteWishlist}
          onCancel={() => setDeleteConfirm(null)}
          confirmText="Delete"
          pendingText="Deleting…"
          cancelText="Cancel"
          type="danger"
        />
      )}
    </div>
  );
}
