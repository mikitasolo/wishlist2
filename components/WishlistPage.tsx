'use client';

import { track } from '@/lib/analytics';
import type { LinkOption } from '@/components/ItemLinkPicker';
import { useEffect, useState, useMemo, useCallback, useRef, useId, type FormEvent } from 'react';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import { useRouter } from 'next/navigation';
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
import { usePeopleGroups } from '@/lib/hooks/usePeopleGroups';
import type { GroupInviteResult } from '@/lib/utils/groupInviteResult';

/** How long the page waits on a group invite (its route may take up to 60s). */
const GROUP_INVITE_TIMEOUT_MS = 65_000;
import { listStatusByUsername } from '@/lib/utils/inviteSuggestions';
import ShareButton from '@/components/ShareButton';
import Select from '@/components/Select';
import WishlistHeader, { WishlistHeaderSkeleton } from '@/components/WishlistHeader';
import JoinListCallout from '@/components/JoinListCallout';
import MemberWelcome from '@/components/MemberWelcome';
import WishlistCover from '@/components/WishlistCover';
import WishlistDescription from '@/components/WishlistDescription';
import WishlistTabs, { listTabId, listTabPanelId } from '@/components/WishlistTabs';
import WishlistPeopleTab, {
  type JoinRequestView,
  type PendingInvite,
  type WishlistPerson,
} from '@/components/WishlistPeopleTab';
import WishlistSettingsTab, { ARCHIVE_EXPLANATION } from '@/components/WishlistSettingsTab';
import StartFromListModal from '@/components/StartFromListModal';
import {
  ListControlsSkeleton,
  Skeleton,
  SkeletonGrid,
  ITEM_GRID_CLASSES,
} from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import LoadError from '@/components/LoadError';
import WishlistUnavailable from '@/components/WishlistUnavailable';
import ShareLinkUnavailable from '@/components/ShareLinkUnavailable';
import ShareLinksSection, { type ShareLinksSectionHandle } from '@/components/ShareLinksSection';
import RevokeShareLinksDialog from '@/components/RevokeShareLinksDialog';
import { isLinkLive, useShareLinks } from '@/lib/hooks/useShareLinks';
import { SHARE_TOKEN_HEADER, type ShareLinkLevel } from '@/lib/utils/shareLinkFields';
import { isPublishedItem } from '@/lib/utils/itemCounts';
import { readResource, ReadRefusedError } from '@/lib/utils/resourceRead';
import { missingFromDraft } from '@/lib/utils/occasion';
import { getVisibility } from '@/lib/utils/visibility';
import { onCurrentListTab, useListTab, type ListTab } from '@/lib/hooks/useListTab';
import { useBusyIds } from '@/lib/hooks/useBusyIds';
import { useJoinRequest } from '@/lib/hooks/useJoinRequest';
import { useLinkJoin } from '@/lib/hooks/useLinkJoin';
import {
  rebaseSettingsForm,
  settingsChanges,
  settingsFormFor,
  wishlistSettings,
  type WishlistSettings,
  type WishlistSettingsForm,
} from '@/lib/utils/wishlistSettings';
import { prependCreatedItem, updateItemOptimistically } from '@/lib/utils/itemListMerge';
import { createMutationTracker } from '@/lib/utils/mutationTracker';
import { RequestTimeoutError, withRequestTimeout } from '@/lib/utils/requestTimeout';
import { createSubmissionKeys, IDEMPOTENCY_HEADER } from '@/lib/utils/submissionKey';
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
import { ApiItem, ApiResponse, type ItemUpdate } from '@/types/api';
import {
  applyLinkChanges,
  isLinkableStatus,
  syncPartnerChips,
  type ItemRef,
} from '@/lib/utils/itemLinks';
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
  type ListChip,
  orderListItems,
} from '@/lib/utils/listChips';
import { useListChip } from '@/lib/hooks/useListChip';
import { useDiscreetMode } from '@/lib/hooks/useDiscreetMode';
import { withoutReservation } from '@/lib/utils/discreet';
import { useItemDeepLink } from '@/lib/hooks/useItemDeepLink';
import { useStickyItems } from '@/lib/hooks/useStickyItems';
import { useListPrices } from '@/lib/hooks/useListPrices';
import { useCurrencyRates } from '@/lib/hooks/useCurrencyRates';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';
import BudgetFilter from '@/components/BudgetFilter';
import { filterByBudget, hasPricedItem, parseBudget } from '@/lib/utils/budgetFilter';
import { needsPricesControl, ORIGINAL_PRICES, viewerPriceCurrency } from '@/lib/utils/listPrices';
import { TONE_CLASSES } from '@/lib/utils/statusTones';
import { useReceivedToast } from '@/lib/hooks/useReceivedToast';
import { useReserveToast } from '@/lib/hooks/useReserveToast';
import {
  useFetchItems,
  useUpdateItem,
  useCreateItem,
  useDeleteItem,
  type ItemRequestFailure,
  type ReviewRequestOptions,
} from '@/lib/hooks/useItems';
import {
  PROPOSAL_REMOVED_NOTE,
  PROPOSAL_REVIEWED_ERROR,
  isNewerVersion,
  proposalReviewState,
} from '@/lib/utils/proposalReview';
import { useFreshUploads } from '@/lib/hooks/useFreshUploads';

type PageLoad = 'loading' | 'ready' | 'unavailable' | 'failed';

/**
 * How the page was reached (WIS-335):
 * - `slug`: the canonical URL, `/wishlists/<slug or id>`;
 * - `link`: a share link, `/l/<token>`, whose page resolved the token to the
 *   list's id (`listId`) on the server. Every read of the list and its items,
 *   and the join request's, carries the token in `X-Share-Token`; the page
 *   never follows a slug or redirects to the canonical URL on a refusal, and
 *   any refusal shows the dead-link state. An owner or member is sent on to the
 *   canonical URL, unless `preview` (an owner's Preview as visitor), which
 *   shows them the page as a visitor. `then: 'ask'` is a visitor back from
 *   signing in to ask to join: the button is highlighted, nothing is sent.
 *   `level` is the link's: a `join` link offers Join this list (WIS-337) in
 *   place of Ask to join, and `then: 'join'` (back from signing in to join)
 *   opens its confirmation at once; joining still takes a click.
 */
export type WishlistAddress =
  | { kind: 'slug'; id: string }
  | {
      kind: 'link';
      token: string;
      listId: string;
      level?: ShareLinkLevel;
      preview?: boolean;
      then?: 'ask' | 'join' | null;
    };

export default function WishlistPage({ address }: { address: WishlistAddress | null }) {
  const { data: session, status } = useKnownSession();
  const router = useRouter();
  const { showToast } = useToast();
  const wishlistId = address ? (address.kind === 'slug' ? address.id : address.listId) : null;
  // A share link's token, in link mode (else null), and what its reads send.
  const linkToken = address?.kind === 'link' ? address.token : null;
  const previewAsVisitor = address?.kind === 'link' && !!address.preview;
  // A Join link (WIS-337): Join this list in place of Ask to join.
  const joinLink = address?.kind === 'link' && address.level === 'join';
  const linkLevel = address?.kind === 'link' ? address.level : undefined;
  const linkOpenTracked = useRef(false);
  const readInit = useMemo<RequestInit | undefined>(
    () => (linkToken ? { headers: { [SHARE_TOKEN_HEADER]: linkToken } } : undefined),
    [linkToken]
  );
  // Back from signing in to ask to join (`?then=ask`) or to join (`?then=join`): kept for this visit
  // only, and taken off the URL, so a reload or a copied link doesn't carry it.
  const [askOnArrival] = useState(() => (address?.kind === 'link' ? (address.then ?? null) : null));
  useEffect(() => {
    if (!linkToken || !askOnArrival) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('then');
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`
    );
  }, [linkToken, askOnArrival]);

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
  // Pending requests to join the list (owners only, read when People opens).
  const [joinRequests, setJoinRequests] = useState<JoinRequestView[]>([]);
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
  // What this page's writes and side reads address the list by: its id once
  // read, never its URL's slug, which a co-owner can change under an open page.
  // The first read and the item polls keep the slug, so a refusal can follow it.
  const apiId = useCallback((): string => listId.current ?? wishlistId ?? '', [wishlistId]);
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
  // Your own groups, for the People tab's invite form (WIS-37): read when it opens.
  const peopleGroups = usePeopleGroups(tab === 'people');
  const onItems = tab === 'items';
  const tabsId = useId();
  const [sortBy, setSortBy] = useState<SortType>(DEFAULT_WISHLIST_SORT);
  const [searchQuery, setSearchQuery] = useState('');
  const [itemToEdit, setItemToEdit] = useState<ApiItem | null>(null);
  // Edit opened from a card's "+ link" starts on the Link field.
  const [editOnLink, setEditOnLink] = useState(false);
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
  // Cover photos uploaded in Settings that no save has taken: one replaced or
  // removed, one discarded, and any left when the page goes are handed back
  // (WIS-181). The page's, not the tab's, as the form outlives the tab.
  const bannerUploads = useFreshUploads();
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
  // Start a new list from this one (WIS-325), from Settings.
  const [startNewOpen, setStartNewOpen] = useState(false);
  // The ref turns a second click away before the disabled state has rendered.
  const archivingRef = useRef(false);
  const [isArchiving, setIsArchiving] = useState(false);
  // The sole owner's Leave list (in the title's ⋯ menu) explains why they
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

  // A signed-in visitor's Ask to join (WIS-275), on a list they can open.
  const joinRequest = useJoinRequest(
    wishlist ? String(wishlist._id) : null,
    viewerId,
    pageLoad === 'ready' &&
      viewerRole === 'visitor' &&
      !previewAsVisitor &&
      !joinLink &&
      !!wishlist &&
      !wishlist.archived,
    linkToken
  );
  // A visitor's join through a Join link (WIS-337), on its confirmation.
  const linkJoin = useLinkJoin(wishlist ? String(wishlist._id) : null, joinLink ? linkToken : null);

  // The list's share links (owners only, WIS-335): People's Share links
  // section, and the count of live ones the Share popover and the visibility
  // setting mention. Never on a share link's page, where nobody is an owner.
  const shareLinks = useShareLinks(
    wishlist ? String(wishlist._id) : null,
    isOwner && !linkToken && pageLoad === 'ready'
  );
  const shareLinksRef = useRef<ShareLinksSectionHandle>(null);
  // An owner the viewer has just removed or made a member, who could have
  // copied the list's live share links: offered for revoking once the
  // confirmation has closed (WIS-338). Links stay unless revoked.
  const [revokeLinksFor, setRevokeLinksFor] = useState<{ username: string | null } | null>(null);
  const hasLiveLinks = shareLinks.read === 'loaded' && shareLinks.liveCount > 0;
  const offerLinkRevoke = useCallback(
    (username: string | null) => {
      if (hasLiveLinks) setRevokeLinksFor({ username });
    },
    [hasLiveLinks]
  );
  // Share's "Share links": People, then the section, or the New link dialog
  // when there are no links yet, once the section is on screen and has read.
  const [toShareLinks, setToShareLinks] = useState(false);
  const openShareLinks = useCallback(() => {
    chooseTab('people');
    setToShareLinks(true);
  }, [chooseTab]);
  useEffect(() => {
    const section = shareLinksRef.current;
    if (!toShareLinks || tab !== 'people' || !section || shareLinks.read === 'loading') return;
    setToShareLinks(false);
    if (shareLinks.read === 'loaded' && shareLinks.links.length === 0) section.openNewLink();
    else section.reveal();
  }, [toShareLinks, tab, shareLinks.read, shareLinks.links.length]);

  // The status chip the list is shown on: All on every list the page opens
  // (or the URL's ?show=), kept only for this list and role, and never saved.
  const [chosenChip, chooseChip] = useListChip(
    wishlist ? { id: String(wishlist._id), slug: wishlist.slug } : null,
    wishlistId,
    viewerRole
  );

  // Discreet mode (WIS-46) keeps a member's reservations off the screen. It's
  // applied as the page renders (`viewItems`, below), never to `items`, which
  // the poll and the mutations keep as the server has it, so nothing flashes
  // the real state back. The chip for their own reservations goes, and a list
  // opened on it shows All.
  const { discreet } = useDiscreetMode();
  const hideReservations = discreet && isMember && !isOwner;
  const activeChip: ListChip =
    hideReservations && chosenChip === 'reserved-by-you' ? 'all' : chosenChip;

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
      // A share link's page never follows a slug: its refusal is the link's.
      if (!id || id === wishlistId || linkToken) {
        markRefused(sentNo);
        return;
      }
      if (sentNo < loadedAt.current || recheckingRefusal.current) return;
      recheckingRefusal.current = true;
      try {
        const recheckNo = ++readsSent.current;
        const read = await readResource<{ slug?: string | null }>(`/api/wishlists/${id}`, readInit);
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
    [wishlistId, linkToken, readInit, markRefused]
  );

  // The id belongs to the URL it was read at: another URL (another list, or the
  // same one under its new slug) is read afresh before the id is used again.
  useEffect(() => {
    listId.current = null;
  }, [wishlistId]);

  // Fetch wishlist and determine role. Whatever the answer, the page stays at
  // this URL and says where things stand (see `pageLoad`), with no toast.
  useEffect(() => {
    if (!wishlistId || status === 'loading') return;
    // A read outdated by another (the session changed, Try again) is dropped.
    let current = true;

    async function fetchWishlist(id: string) {
      const sentAt = ownerRemovals.stamp();
      const sentNo = ++readsSent.current;
      const read = await readResource<unknown>(`/api/wishlists/${id}`, readInit);
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
      // An owner or member who opened a share link belongs at the list's own
      // URL (only the client knows who's viewing). An owner's Preview as
      // visitor stays, and is shown the page as a visitor.
      // A share link opened (counted once a visit), whoever opened it, but not
      // an owner's Preview as visitor.
      if (linkToken && !previewAsVisitor && !linkOpenTracked.current) {
        linkOpenTracked.current = true;
        track('share_link_opened', { level: linkLevel ?? 'view' });
      }
      if (linkToken && wishlistData.userRole && !previewAsVisitor) {
        routerRef.current.replace(`/wishlists/${wishlistData.slug || wishlistData._id}`);
        return;
      }
      if (previewAsVisitor) wishlistData.userRole = null;
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
  }, [
    wishlistId,
    status,
    refillSettings,
    ownerRemovals,
    readRefused,
    attempt,
    readInit,
    linkToken,
    previewAsVisitor,
    linkLevel,
  ]);

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
  const requestsReads = useRef({ sent: 0, landed: 0 });
  const membersReads = useRef({ sent: 0, landed: 0 });

  const refreshInvites = useCallback(async () => {
    if (!wishlistId) return;
    const sentNo = ++invitesReads.current.sent;
    try {
      const res = await fetch(`/api/wishlists/${apiId()}/invites`, { cache: 'no-store' });
      const result = await res.json();
      if (!result.success || sentNo < invitesReads.current.landed) return;
      invitesReads.current.landed = sentNo;
      setPendingInvites(result.data || []);
    } catch {
      /* ignore */
    }
  }, [apiId, wishlistId]);

  // Read the pending requests to join again (owners only), on the same terms
  // as the invites: an answer sent before the one on screen is dropped.
  const refreshRequests = useCallback(async () => {
    if (!wishlistId) return;
    const sentNo = ++requestsReads.current.sent;
    try {
      const res = await fetch(`/api/wishlists/${apiId()}/requests`, { cache: 'no-store' });
      const result = await res.json();
      if (!result.success || sentNo < requestsReads.current.landed) return;
      requestsReads.current.landed = sentNo;
      setJoinRequests(result.data || []);
    } catch {
      /* ignore: the group keeps what it has */
    }
  }, [apiId, wishlistId]);

  // Read the people on the list again (owners only). Only the first read
  // failing is shown (People says so): a later one keeps the rows it has.
  const refreshMembers = useCallback(async () => {
    if (!wishlistId) return;
    const sentNo = ++membersReads.current.sent;
    let read = false;
    try {
      const res = await fetch(`/api/wishlists/${apiId()}/members`, { cache: 'no-store' });
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
  }, [apiId, wishlistId]);

  // For an owner: the people, read once when the page knows it's an owner's
  // (People's count), and with the pending invites whenever People opens.
  const peopleOpen = tab === 'people';
  const membersReadFor = useRef<string | null>(null);
  useEffect(() => {
    if (!isOwner || !wishlistId) return;
    if (peopleOpen) {
      void refreshInvites();
      void refreshRequests();
    }
    if (!peopleOpen && membersReadFor.current === wishlistId) return;
    membersReadFor.current = wishlistId;
    void refreshMembers();
  }, [wishlistId, isOwner, peopleOpen, refreshMembers, refreshInvites, refreshRequests]);

  // Try again, after the first read of the people failed.
  const retryMembers = useCallback(() => {
    setMembersRead('loading');
    void refreshMembers();
    void refreshInvites();
    void refreshRequests();
  }, [refreshMembers, refreshInvites, refreshRequests]);

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
        const read = await fetchItemsHook(
          wishlistId,
          () => {
            sentNo = ++readsSent.current;
            return mutations.stamp();
          },
          readInit
        );
        // A read that raced with a mutation (landed while one was in flight, or
        // was sent before one settled) may predate fresher local state, so the
        // list is read again once no mutation is in flight. A background read's
        // result is dropped; a non-silent one (the first load, or the one after
        // coming back to Items) still lands, so the list isn't left empty.
        if (mutations.isStale(read.sentAt)) {
          mutations.rereadWhenIdle();
          if (silent) return;
        }
        // An owner's Preview as visitor: only what a visitor is shown.
        setItems(
          previewAsVisitor ? read.items.filter((item) => isPublishedItem(item.status)) : read.items
        );
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
    [fetchItemsHook, wishlistId, mutations, readRefused, readInit, previewAsVisitor]
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
  // A review request refused because the item is no longer a proposal (a
  // co-owner reviewed it meanwhile) closes the review dialog: what it shows is
  // gone, and the toast (the server's PROPOSAL_REVIEWED_ERROR) says why. Its
  // edits are dropped with it (WIS-199). Only one review dialog is ever open,
  // and it can't be closed while its request runs.
  const onItemRequestError = useCallback(
    (error: string, failure: ItemRequestFailure) => {
      showToast(error, 'error');
      if (failure.proposalReviewed) setItemToReview(null);
      // Edited by the proposer since the dialog was filled (WIS-320): it stays
      // open and refills from the proposal as it is now, so the owner sees the
      // edit before approving.
      const edited = failure.editedProposal;
      if (edited) {
        setItemToReview((current) =>
          current &&
          current._id === edited._id &&
          isNewerVersion(edited.updatedAt, current.updatedAt)
            ? edited
            : current
        );
      }
    },
    [showToast]
  );
  const updateItemHook = useUpdateItem(undefined, onItemRequestError);

  // No success toast here — each delete handler says what it removed, and only
  // once the delete has succeeded.
  const deleteItemHook = useDeleteItem(undefined, onItemRequestError);

  // Each dialog's Idempotency-Key: a retry of a submission whose answer was
  // lost (a timeout) sends the same one, so the server answers with the item
  // the first attempt saved instead of adding a second (WIS-158). Reset on a
  // success and when the dialog closes.
  const [addKeys] = useState(createSubmissionKeys);
  const [proposeKeys] = useState(createSubmissionKeys);

  const handleCreateItem = useCallback(
    async (itemData: {
      name: string;
      imageUrl?: string | null;
      price?: { value: number; currency: string } | null;
      link?: string | null;
      notes?: string | null;
      mostWanted?: boolean;
      status?: 'draft' | 'available';
      linkItems?: string[];
    }) => {
      if (!wishlistId) return;
      // The hook toasts a failure and resolves null. Reject so AddItemModal
      // stays open with the user's input; it closes itself on success.
      const key = addKeys.keyFor(itemData);
      const created = await mutations.track(() => createItemHook(apiId(), itemData, key));
      if (!created) throw new Error('Failed to create item');
      track('item_added', { kind: 'own' });
      // Its partners show it as theirs straight away (WIS-29).
      if (created.relatedItems?.length) setItems((prev) => syncPartnerChips(prev, created));
      addKeys.reset();
    },
    [apiId, createItemHook, wishlistId, mutations, addKeys]
  );

  // Every item update (edit, book, publish, approve, ...) goes through here.
  // On success the server's item is merged into just this one: the PATCH
  // response carries a fresh priceInUsdCents, so a re-priced item sorts by its
  // new price straight away. On failure the hook has toasted the error, the
  // change is undone at once, the list is reconciled with the server, and this
  // resolves null (see updateItemOptimistically).
  const handleUpdateItem = useCallback(
    (id: string, updates: ItemUpdate, options?: ReviewRequestOptions) =>
      updateItemOptimistically({
        id,
        apply: (item) => {
          // Links are sent as what changed, and shown as the `relatedItems`
          // the caller worked out (WIS-29); never sent as shown.
          const { linkItems: _link, unlinkItems: _unlink, ...shown } = updates;
          const optimistic = { ...item, ...shown };
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
        request: () => {
          const { relatedItems: _shown, ...body } = updates;
          return updateItemHook(id, body, options);
        },
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
      const key = proposeKeys.keyFor(itemData);
      const result = await mutations.track(async (): Promise<ApiResponse<ApiItem> | null> => {
        try {
          // Given up on after ITEM_REQUEST_TIMEOUT_MS, like the hooks' requests.
          return await withRequestTimeout(async (signal) => {
            const response = await fetch(`/api/wishlists/${apiId()}/items`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                [IDEMPOTENCY_HEADER]: key,
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
      proposeKeys.reset();
      track('item_added', { kind: 'proposal' });
      // Same poll guards as an owner's add (see createItemHook).
      setItems((prevItems) => prependCreatedItem(prevItems, proposed));
      showToast('Item proposed successfully', 'success');
    },
    [apiId, wishlistId, showToast, mutations, proposeKeys]
  );

  const handleReviewItem = useCallback(
    async (updates: Partial<ApiItem> & { status: 'draft' | 'available' }) => {
      if (!itemToReview) return;
      // A failed approve is toasted and the proposal put back by
      // handleUpdateItem. Reject so ReviewItemModal stays open with the edits
      // (it closes itself on success): the owner is told "approved" only once
      // the server agreed.
      // It expects the item to still be the proposal the dialog opened on: one a
      // co-owner has reviewed since is answered 409 and closes the dialog (see
      // onItemRequestError), so it can't overwrite their review (WIS-199).
      // And the version it shows: an edit by the proposer since is answered 409
      // with the proposal as it is now, and the dialog refills (WIS-320).
      const approved = await handleUpdateItem(itemToReview._id, updates, {
        expectProposal: true,
        expectedVersion: itemToReview.updatedAt,
      });
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
    // Owner-only, so a 404 means it's already gone (see useDeleteItem).
    // Decline expects a proposal too, so it never deletes a live item a
    // co-owner approved meanwhile, possibly reserved (WIS-199).
    const deleted = await mutations.track(() =>
      deleteItemHook(itemId, { notFoundIsDone: true, expectProposal: true })
    );
    if (!deleted) throw new Error('Failed to delete item');
    setItems((prevItems) => prevItems.filter((item) => item._id !== itemId));
    showToast('Proposal declined', 'success');
  }, [itemToReview, deleteItemHook, showToast, mutations]);

  // A read brings a later version of the proposal under review (the proposer
  // edited it): the dialog refills from it, keeping the owner's own edits, and
  // says so, rather than approve fields the owner never saw (WIS-320). The
  // approve's version check covers an edit no read has brought yet.
  const liveReviewed = itemToReview
    ? items.find((item) => item._id === itemToReview._id)
    : undefined;
  useEffect(() => {
    if (liveReviewed?.status !== 'proposed') return;
    setItemToReview((current) =>
      current &&
      current._id === liveReviewed._id &&
      isNewerVersion(liveReviewed.updatedAt, current.updatedAt)
        ? liveReviewed
        : current
    );
  }, [liveReviewed]);

  // A read shows the proposal under review isn't one any more: a co-owner
  // reviewed it, or it was declined or withdrawn. The dialog closes and says
  // why, never what it has become (WIS-199).
  const handleProposalGone = useCallback(
    (state: 'reviewed' | 'gone') => {
      setItemToReview(null);
      showToast(state === 'reviewed' ? PROPOSAL_REVIEWED_ERROR : PROPOSAL_REMOVED_NOTE, 'info');
    },
    [showToast]
  );

  const handleEditItem = useCallback((item: ApiItem) => {
    setEditOnLink(false);
    setItemToEdit(item);
  }, []);

  const handleAddItemLink = useCallback((item: ApiItem) => {
    setEditOnLink(true);
    setItemToEdit(item);
  }, []);

  // A card's Delete / Decline, once confirmed. Rejects on failure so the
  // card keeps its item; same poll guard as the dialogs' deletes.
  const handleCardDelete = useCallback(
    async (item: ApiItem) => {
      // Owner-only, so a 404 means it's already gone (see useDeleteItem).
      const deleted = await mutations.track(() =>
        deleteItemHook(item._id, { notFoundIsDone: true })
      );
      if (!deleted) throw new Error('Failed to delete item');
      setItems((prevItems) => prevItems.filter((i) => i._id !== item._id));
      showToast(
        item.status === 'proposed' ? 'Proposal declined' : 'Item deleted successfully',
        'success'
      );
    },
    [deleteItemHook, showToast, mutations]
  );

  // The items as last rendered, for handleSaveEdit's optimistic links without
  // making it a new callback on every poll.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const handleSaveEdit = useCallback(
    async (updates: ItemUpdate) => {
      if (!itemToEdit) return;
      const itemId = itemToEdit._id;
      // Links changed (WIS-29): the card shows its new partners at once, named
      // from the list as it is.
      const changesLinks = !!(updates.linkItems || updates.unlinkItems);
      const items = itemsRef.current;
      const current = items.find((item) => item._id === itemId);
      const shown: ItemUpdate = changesLinks
        ? {
            ...updates,
            relatedItems: applyLinkChanges(
              current?.relatedItems ?? [],
              updates,
              new Map(items.map((item) => [item._id, item.name]))
            ),
          }
        : updates;
      // handleUpdateItem toasts a failure, puts the item back as it was and
      // resolves null. Reject so EditItemModal stays open with the user's
      // changes; it closes itself on success.
      const updated = await handleUpdateItem(itemId, shown);
      if (!updated) throw new Error('Failed to update item');
      // Its partners' chips follow: added, removed, or renamed with it.
      if (changesLinks || updates.name !== undefined) {
        setItems((prev) => syncPartnerChips(prev, updated));
      }
    },
    [itemToEdit, handleUpdateItem]
  );

  const handleDeleteItem = useCallback(async () => {
    if (!itemToEdit) return;
    const itemId = itemToEdit._id;
    // The hook toasts a failure and resolves false. Reject so EditItemModal
    // stays open and the item stays listed; it closes itself on success.
    // Same poll guard as handleDeleteProposedItem.
    // An owner's 404 means it's already gone, e.g. a retry whose first attempt
    // went through (WIS-158). A proposer's may be the archived list refusing
    // them, with the proposal still there, so it stays an error.
    const deleted = await mutations.track(() =>
      deleteItemHook(itemId, { notFoundIsDone: isOwner })
    );
    if (!deleted) throw new Error('Failed to delete item');
    setItems((prevItems) => prevItems.filter((item) => item._id !== itemId));
    showToast('Item deleted successfully', 'success');
  }, [itemToEdit, deleteItemHook, showToast, mutations, isOwner]);

  const handleInvite = useCallback(
    async (payload: { username: string; role: 'owner' | 'member' }) => {
      if (!wishlistId) return false;

      setIsInviting(true);
      try {
        const response = await fetch(`/api/wishlists/${apiId()}/members`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const result = await response.json();

        if (result.success) {
          track('invite_sent', { role: payload.role, to: 'person' });
          showToast('Invitation sent', 'success');
          // Membership is created only when they accept — refresh pending invites.
          await refreshInvites();
          return true;
        } else {
          showToast(result.error || 'Failed to send invitation', 'error');
          return false;
        }
      } catch (error) {
        console.error('Error inviting user:', error);
        showToast('Failed to send invitation', 'error');
        return false;
      } finally {
        setIsInviting(false);
      }
    },
    [apiId, wishlistId, showToast, refreshInvites]
  );

  // Invite a whole group (WIS-37): one invite per person, answered with who was
  // invited and who wasn't, which the form shows. A refusal of the whole request
  // (a group gone, an archived list's member invite) is a toast, as for one person.
  const handleInviteGroup = useCallback(
    async (payload: {
      groupId: string;
      role: 'owner' | 'member';
    }): Promise<GroupInviteResult | null> => {
      if (!wishlistId) return null;
      setIsInviting(true);
      try {
        // Bounded a little past the route's own `maxDuration` (60s): one invite
        // per person, one after another, so it can take a while.
        const result = await withRequestTimeout(async (signal) => {
          const response = await fetch(`/api/wishlists/${apiId()}/members/group`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal,
          });
          return response.json();
        }, GROUP_INVITE_TIMEOUT_MS);
        if (!result.success) {
          showToast(result.error || 'Failed to invite the group', 'error');
          return null;
        }
        if (result.data.invited.length > 0) {
          track('invite_sent', { role: payload.role, to: 'group' });
          await refreshInvites();
        }
        return result.data as GroupInviteResult;
      } catch (error) {
        console.error('Error inviting a group:', error);
        showToast(
          error instanceof RequestTimeoutError ? error.message : 'Failed to invite the group',
          'error'
        );
        // Some invites may have gone out before it failed: Invited shows them.
        void refreshInvites();
        return null;
      } finally {
        setIsInviting(false);
      }
    },
    [apiId, wishlistId, showToast, refreshInvites]
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
          const res = await fetch(`/api/wishlists/${apiId()}/invites/${inviteId}`, {
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
    [apiId, wishlistId, showToast, refreshInvites, runRowAction]
  );

  /**
   * Answer a request to join (by its id, which is also its row's busy id):
   * Invite sends them a member invite, which joins the Invited group; Decline
   * ends it and tells nobody. Either way the row goes at once.
   */
  const answerJoinRequest = useCallback(
    (joinRequest: JoinRequestView, action: 'invite' | 'decline') =>
      runRowAction(joinRequest._id, async () => {
        if (!wishlistId) return;
        const name = joinRequest.user.username ? `@${joinRequest.user.username}` : 'them';
        setJoinRequests((prev) => prev.filter((r) => r._id !== joinRequest._id));
        const failed = action === 'invite' ? 'Couldn’t send the invite' : 'Couldn’t decline it';
        try {
          const res = await fetch(`/api/wishlists/${apiId()}/requests/${joinRequest._id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action }),
          });
          const result = await res.json();
          if (result.success) {
            showToast(
              action === 'invite' ? `Invite sent to ${name}` : 'Request declined',
              'success'
            );
            if (action === 'invite') await refreshInvites();
          } else {
            showToast(result.error || failed, 'error');
            await Promise.all([refreshRequests(), refreshMembers(), refreshInvites()]);
          }
        } catch {
          showToast(failed, 'error');
          await refreshRequests();
        }
      }),
    [apiId, wishlistId, showToast, refreshInvites, refreshRequests, refreshMembers, runRowAction]
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
      const res = await fetch(`/api/wishlists/${apiId()}`, { cache: 'no-store' });
      const result = await res.json();
      if (!result.success || !result.data) return null;
      const read = ownerRemovals.land(sentAt, shownOwnersOf(result.data));
      if (read) setOwners(read);
      return read;
    } catch {
      /* the page keeps the owners it has */
      return null;
    }
  }, [apiId, wishlistId, ownerRemovals]);

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
        ? `/api/wishlists/${apiId()}/owners/${memberId}`
        : `/api/wishlists/${apiId()}/members/${memberId}`;

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
              offerLinkRevoke(memberUsername ?? null);
              await Promise.all([refreshMembers(), refreshInvites(), refreshOwners()]);
            } else {
              await Promise.all([refreshMembers(), refreshInvites()]);
            }
          } else {
            showToast(result.error || 'Failed to remove member', 'error');
            // A refusal may be because the server already did it (a co-owner
            // got there first): read the people again so the page agrees.
            if (type === 'owner') {
              await Promise.all([refreshMembers(), refreshOwners()]);
            }
          }
        } catch (error) {
          console.error('Error removing member:', error);
          showToast('Failed to remove member', 'error');
          if (type === 'owner') await Promise.all([refreshMembers(), refreshOwners()]);
        }
      });
    } finally {
      setDeleteConfirm(null);
    }
  }, [
    apiId,
    wishlistId,
    deleteConfirm,
    showToast,
    refreshMembers,
    refreshInvites,
    dropOwner,
    refreshOwners,
    runRowAction,
    offerLinkRevoke,
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
          const res = await fetch(`/api/wishlists/${apiId()}/owners/${userId}`, {
            method: 'POST',
          });
          const result = await res.json();
          if (result.success) {
            track('invite_sent', { role: 'owner', to: 'person' });
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
    [apiId, wishlistId, showToast, refreshInvites, runRowAction]
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
          const res = await fetch(`/api/wishlists/${apiId()}/owners/${userId}`, {
            method: 'PATCH',
          });
          const result = await res.json();
          if (result.success) {
            showToast(`@${username || 'user'} is now a member`, 'success');
            dropOwner({ id: userId, username });
            offerLinkRevoke(username);
            // Demoting also cancels any invite they still had pending here.
            await Promise.all([refreshMembers(), refreshInvites(), refreshOwners()]);
          } else {
            showToast(result.error || 'Failed to update owner', 'error');
            // Refused (404/400) because they're no longer an owner, say: read
            // the people and owners again so the page agrees with the server.
            await Promise.all([refreshMembers(), refreshOwners()]);
          }
        } catch (error) {
          console.error('Error demoting owner:', error);
          showToast('Failed to update owner', 'error');
          await Promise.all([refreshMembers(), refreshOwners()]);
        }
      }),
    [
      apiId,
      wishlistId,
      showToast,
      refreshMembers,
      refreshInvites,
      dropOwner,
      refreshOwners,
      runRowAction,
      offerLinkRevoke,
    ]
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
      const response = await fetch(`/api/wishlists/${apiId()}/members/me`, {
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
  }, [apiId, wishlistId, deleteConfirm, wishlist?.name, router, showToast]);

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
      const response = await fetch(`/api/wishlists/${apiId()}`, {
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
  }, [apiId, wishlistId, deleteConfirm, router, showToast]);

  // Archive or unarchive the list: from Settings, from the confirmation, or
  // from the archived banner's Unarchive.
  const setArchived = useCallback(
    // Resolves to whether it landed (Start a new list's last step waits on it).
    async (archived: boolean): Promise<boolean> => {
      if (!wishlistId || archivingRef.current) return false;
      archivingRef.current = true;
      setIsArchiving(true);
      try {
        const res = await fetch(`/api/wishlists/${apiId()}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archived }),
        });
        const result = await res.json();
        if (result.success) {
          setWishlist((prev) => (prev ? { ...prev, archived } : prev));
          showToast(archived ? 'Wishlist archived' : 'Wishlist unarchived', 'success');
          return true;
        }
        showToast(result.error || 'Failed to update wishlist', 'error');
        return false;
      } catch {
        showToast('Failed to update wishlist', 'error');
        return false;
      } finally {
        archivingRef.current = false;
        setIsArchiving(false);
      }
    },
    [apiId, wishlistId, showToast]
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
  // A co-owner may step down. The sole owner can't: their Leave list
  // explains that they'd have to make someone else an owner first, or delete
  // the list.
  const canLeave = isOwner ? ownerCount > 1 : isMember;

  // Leave list, from the title's ⋯ menu: confirm, or for the sole owner, why
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
      const res = await fetch(`/api/wishlists/${apiId()}`, {
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
  }, [apiId, wishlistId, wishlist, showToast]);

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
    bannerUploads.discardAll();
  }, [bannerUploads]);

  const reloadShareLinks = shareLinks.reload;
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
      // Any answer means the save is over, so a refused one leaves the photo
      // the form's; with none, it may have landed, and it's never handed back.
      const settleUpload = bannerUploads.saving(changes.bannerUrl);
      let outcome: 'saved' | 'refused' | 'unknown' = 'unknown';

      try {
        const response = await fetch(`/api/wishlists/${apiId()}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(changes),
        });

        const result = await response.json();
        outcome = result.success ? 'saved' : 'refused';
        // An occasion change moves the links that end the day after it (WIS-342).
        if (result.success && changes.occasion !== undefined) reloadShareLinks();

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
        settleUpload(outcome);
        setIsSavingSettings(false);
      }
    },
    [
      apiId,
      settingsForm,
      settingsBaseline,
      wishlistId,
      refillSettings,
      router,
      showToast,
      bannerUploads,
      reloadShareLinks,
    ]
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
  // The items as this screen draws them: in discreet mode, none reserved.
  const viewItems = useMemo(
    () => (hideReservations ? items.map(withoutReservation) : items),
    [items, hideReservations]
  );
  const chipCounts = useMemo(
    () => countListChips(viewItems, viewerRole, viewerId),
    [viewItems, viewerRole, viewerId]
  );
  // What they've reserved, for Leave list's copy: not hidden from them there,
  // since it says what they keep.
  const reservedByYou = useMemo(
    () => countListChips(items, viewerRole, viewerId)['reserved-by-you'],
    [items, viewerRole, viewerId]
  );

  // The items under the chip, actionable ones first under All, in the
  // viewer's sort within each group.
  const chipItems = useMemo(
    () => orderListItems(viewItems, activeChip, viewerRole, viewerId, sortBy),
    [viewItems, activeChip, viewerRole, viewerId, sortBy]
  );

  // Prices (D9): someone else's list starts in the viewer's currency, their
  // own on each item's; offered only when some price is in another currency.
  const prices = useListPrices({
    viewerId,
    defaultCurrency: session?.user?.defaultCurrency,
    ownList: isOwner,
    items,
  });

  // The budget filter ("Under X", WIS-326): for gifters only (a signed-in
  // non-owner of someone else's list; a signed-out link visitor has no known
  // currency), never saved. The amount is in the currency Prices shows, so a
  // new pick re-reads the typed text in it; on each item's own currency (or
  // with Prices not offered) it's the account's default. It narrows what's
  // shown after the chips have counted, so a chip's count never moves with it.
  const accountCurrency = viewerPriceCurrency(session?.user?.defaultCurrency);
  const viewerCurrency = prices.value === ORIGINAL_PRICES ? accountCurrency : prices.value;
  const viewerLocale = useViewerLocale();
  const [budgetText, setBudgetText] = useState('');
  const budgetOffered = !isOwner && !!viewerId && hasPricedItem(items);
  const budget = budgetOffered ? parseBudget(budgetText, viewerLocale) : null;
  const budgetLimit = budget === 'invalid' ? null : budget;
  // Rates are only needed to compare a price in another currency.
  const ownRates = useCurrencyRates(
    budgetLimit !== null && prices.rates === null && needsPricesControl(items, viewerCurrency)
  );
  const budgetRates = prices.rates ?? ownRates;

  const filteredItems = useMemo(
    () =>
      filterByBudget(
        searchItemsByName(chipItems, searchQuery),
        budgetLimit,
        viewerCurrency,
        budgetRates
      ),
    [chipItems, searchQuery, budgetLimit, viewerCurrency, budgetRates]
  );

  // A card the viewer reserves, releases, publishes or marks stays in its
  // slot, and in view, until they change the chip, search or sort (WIS-297).
  const { items: sortedItems, pin: pinItem } = useStickyItems(
    filteredItems,
    viewItems,
    JSON.stringify([wishlistId, viewerRole, activeChip, sortBy, searchQuery, budgetLimit])
  );
  const handleStickyCardUpdate = useCallback(
    (id: string, updates: Partial<ApiItem>) => {
      if (updates.status !== undefined) pinItem(id);
      return handleCardUpdate(id, updates);
    },
    [pinItem, handleCardUpdate]
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
    setBudgetText('');
  }, [chooseChip]);

  // Clear the item search when switching to a different wishlist.
  useEffect(() => {
    setSearchQuery('');
    setBudgetText('');
  }, [wishlistId]);

  // `?item=<id>` (the Reserved page's View on list): scroll to that item and
  // highlight it, clearing a chip or search that would hide it.
  // What All shows this viewer, so a link to anything else (a draft sent to
  // a member, say) does nothing rather than resetting their view.
  const itemIds = useMemo(
    () => orderListItems(viewItems, 'all', viewerRole, viewerId, sortBy).map((i) => i._id),
    [viewItems, viewerRole, viewerId, sortBy]
  );
  const isItemShown = useCallback(
    (id: string) => sortedItems.some((i) => i._id === id),
    [sortedItems]
  );
  // A "Goes with" chip (WIS-29) goes to its item the same way (`showItem`).
  const { highlightedId: highlightedItemId, showItem } = useItemDeepLink({
    listKey: wishlistId,
    ready: itemsLoaded && onItems,
    itemIds,
    isShown: isItemShown,
    reveal: showAllItems,
  });

  // Each card's "Goes with" chips (WIS-29): the partners the server gave, less
  // any not among the items shown to this viewer (an owner's Preview as
  // visitor drops drafts; an item deleted here is gone before the next read).
  const relatedById = useMemo(() => {
    const shown = new Set(viewItems.map((item) => item._id));
    const byId = new Map<string, ItemRef[]>();
    for (const item of viewItems) {
      const refs = (item.relatedItems ?? []).filter((ref) => shown.has(ref.id));
      if (refs.length) byId.set(item._id, refs);
    }
    return byId;
  }, [viewItems]);

  // What an owner's add and edit dialogs offer in "Goes with": the list's
  // items but proposals (and, editing, the item itself).
  const linkOptions = useMemo<LinkOption[] | undefined>(
    () =>
      isOwner
        ? items
            .filter((item) => isLinkableStatus(item.status))
            .map((item) => ({ id: item._id, name: item.name, imageUrl: item.imageUrl }))
        : undefined,
    [isOwner, items]
  );
  const editLinkOptions = useMemo(
    () => linkOptions?.filter((option) => option.id !== itemToEdit?._id),
    [linkOptions, itemToEdit?._id]
  );

  // The grid's first cell: an owner's Add item or a member's Propose an item,
  // under All (and a member's Your proposals), never while a search is on.
  const addTile = addTileFor(
    viewerRole,
    activeChip,
    searchQuery.trim() !== '' || budgetLimit !== null
  );

  const chips = listChips(viewerRole)
    .filter((chip) => !(hideReservations && chip === 'reserved-by-you'))
    .map((chip) => ({
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
  // A share link's refusal is its dead state, the same for every viewer, so it
  // doesn't wait for the session.
  if ((refused && (status !== 'loading' || linkToken)) || pageLoad === 'failed') {
    return (
      <div className="min-h-screen">
        <AppHeader actions={<AuthButton />} />
        <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {refused && linkToken ? (
            <ShareLinkUnavailable />
          ) : refused ? (
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
            viewer's actions, with Leave list and Pin in the ⋯ menu, then the
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
                // A link visitor shares the link they came by: the list's own
                // URL may not open for whoever they send it to.
                url={linkToken ? `/l/${linkToken}` : `/wishlists/${wishlist.slug || wishlist._id}`}
                title={wishlist.name}
                // Inviting happens on People, with its invite form on top.
                owner={
                  isOwner
                    ? {
                        visibility: wishlist.visibility,
                        archived: wishlist.archived,
                        onInvite: () => chooseTab('people'),
                        onShareLinks: openShareLinks,
                        // Unknown until read: no hint either way.
                        liveLinkCount:
                          shareLinks.read === 'loaded' ? shareLinks.liveCount : undefined,
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
            signedIn={!!session?.user}
            joinRequest={joinRequest}
            shareLink={
              linkToken
                ? {
                    token: linkToken,
                    highlightAsk: askOnArrival === 'ask',
                    // Never on an owner's Preview as visitor: they can't join.
                    join:
                      joinLink && !previewAsVisitor
                        ? { control: linkJoin, confirmOnArrival: askOnArrival === 'join' }
                        : undefined,
                  }
                : undefined
            }
          />
        )}

        {/* The one-time welcome after accepting a member invite (`?welcome=1`). */}
        <MemberWelcome
          wishlistId={String(wishlist._id)}
          userId={session?.user?.id ?? null}
          isMember={isMember}
          isOwner={isOwner}
          ownerUsernames={ownerUsernames}
          ownerCount={owners.ids.length}
        />

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
                        placeholder="Search items"
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
                      {budgetOffered && (
                        <BudgetFilter
                          className="w-full sm:w-auto"
                          value={budgetText}
                          onChange={setBudgetText}
                          currency={viewerCurrency}
                          invalid={budget === 'invalid'}
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
                                onShareLinks: openShareLinks,
                                // Unknown until read: no hint either way.
                                liveLinkCount:
                                  shareLinks.read === 'loaded' ? shareLinks.liveCount : undefined,
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
                        : budgetLimit !== null && activeChip === 'all'
                          ? 'No items are under that price.'
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
                        onUpdate={handleStickyCardUpdate}
                        onEdit={
                          // Owners can edit non-proposed items
                          // Proposers can edit their own proposed items
                          (isOwner && item.status !== 'proposed') ||
                          (item.status === 'proposed' &&
                            item.proposedBy?.toString() === session?.user?.id)
                            ? handleEditItem
                            : undefined
                        }
                        onDelete={isOwner ? handleCardDelete : undefined}
                        onAddLink={isOwner ? handleAddItemLink : undefined}
                        onReview={
                          isOwner && item.status === 'proposed'
                            ? () => setItemToReview(item)
                            : undefined
                        }
                        onSaveToList={
                          // Any signed-in viewer, owners too (to copy between their
                          // lists), but not on a share link's page: copying is
                          // link-blind, so it would refuse a list the link opened.
                          !linkToken && canCopyItem(item, session?.user?.id)
                            ? setItemToSave
                            : undefined
                        }
                        isAuthenticated={!!session?.user}
                        isOwner={isOwner}
                        isMember={isMember}
                        priceCurrency={prices.value}
                        rates={prices.rates}
                        dimmed={activeChip === 'all' && isDimmedInAll(item, viewerRole, viewerId)}
                        highlighted={item._id === highlightedItemId}
                        related={relatedById.get(item._id)}
                        onShowItem={showItem}
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
                  groups={peopleGroups.groups}
                  groupsFailed={peopleGroups.failed}
                  onRetryGroups={peopleGroups.retry}
                  onInviteGroup={handleInviteGroup}
                  statuses={inviteStatuses}
                  // A member's suggestion makes them a co-owner through the same
                  // confirmation and promotion invite as their Make owner.
                  onPromote={setPromoteConfirm}
                />
              }
              shareLinks={
                <ShareLinksSection
                  ref={shareLinksRef}
                  control={shareLinks}
                  listName={wishlist.name}
                  archived={!!wishlist.archived}
                  visibility={getVisibility(wishlist)}
                  occasion={wishlist.occasion}
                />
              }
              people={members}
              invites={pendingInvites}
              requests={joinRequests}
              onInviteRequest={(r) => answerJoinRequest(r, 'invite')}
              onDeclineRequest={(r) => answerJoinRequest(r, 'decline')}
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
              uploads={bannerUploads}
              archived={!!wishlist.archived}
              archiving={isArchiving}
              onArchive={() => setArchiveConfirm(true)}
              onUnarchive={() => setArchived(false)}
              deleting={isDeletingWishlist}
              onDelete={handleDeleteWishlist}
              liveLinkCount={shareLinks.liveCount}
              occasionLinkCount={
                shareLinks.links.filter((l) => l.untilOccasion && isLinkLive(l, new Date())).length
              }
              onStartNew={() => setStartNewOpen(true)}
            />
          </div>
        )}
      </main>

      {/* Modals */}
      {showAddItemModal && (
        <AddItemModal
          isOpen={showAddItemModal}
          onClose={() => {
            addKeys.reset();
            setShowAddItemModal(false);
          }}
          onAdd={handleCreateItem}
          wishlistCurrency={wishlist?.currency}
          userCurrency={session?.user?.defaultCurrency}
          linkOptions={linkOptions}
        />
      )}

      {showProposeItemModal && (
        <ProposeItemModal
          isOpen={showProposeItemModal}
          onClose={() => {
            proposeKeys.reset();
            setShowProposeItemModal(false);
          }}
          onPropose={handleProposeItem}
          wishlistCurrency={wishlist?.currency}
          userCurrency={session?.user?.defaultCurrency}
        />
      )}

      {itemToEdit && (
        <EditItemModal
          isOpen={!!itemToEdit}
          onClose={() => setItemToEdit(null)}
          initialFocus={editOnLink ? 'link' : undefined}
          onSave={handleSaveEdit}
          onDelete={handleDeleteItem}
          item={itemToEdit}
          wishlistCurrency={wishlist?.currency}
          userCurrency={session?.user?.defaultCurrency}
          linkOptions={isOwner ? editLinkOptions : undefined}
        />
      )}

      {itemToReview && (
        <ReviewItemModal
          isOpen={!!itemToReview}
          onClose={() => setItemToReview(null)}
          onApprove={handleReviewItem}
          onDelete={handleDeleteProposedItem}
          proposalState={proposalReviewState(items, itemToReview._id)}
          onProposalGone={handleProposalGone}
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
            {...removeFromListCopy(deleteConfirm.memberUsername, deleteConfirm.type, {
              liveLinks: hasLiveLinks,
            })}
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
              memberLeaveCopy(wishlist.name, itemsLoaded ? reservedByYou : null, hideReservations))}
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
              ? 'A wishlist needs at least one owner. To leave, make someone else an owner first: pick Make owner in one of your members’ menus on People, or invite a co-owner. Once they accept, you can leave. Or delete the wishlist instead.'
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

      {/* After its confirmation has closed, never stacked on it. */}
      {revokeLinksFor && !demoteConfirm && !deleteConfirm && (
        <RevokeShareLinksDialog
          username={revokeLinksFor.username}
          links={shareLinks.links}
          onRevoke={shareLinks.revoke}
          onDone={() => setRevokeLinksFor(null)}
        />
      )}

      {startNewOpen && isOwner && (
        <StartFromListModal
          sourceId={String(wishlist._id)}
          isOpen={startNewOpen}
          onClose={() => setStartNewOpen(false)}
          onArchiveSource={() => setArchived(true)}
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
