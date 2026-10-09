'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import AuthButton from '@/components/AuthButton';
import AppHeader from '@/components/AppHeader';
import InviteMemberForm, { type InviteMemberFormHandle } from '@/components/InviteMemberForm';
import ShareButton from '@/components/ShareButton';
import WishlistHeader, { WishlistHeaderSkeleton } from '@/components/WishlistHeader';
import JoinListCallout from '@/components/JoinListCallout';
import MemberWelcome from '@/components/MemberWelcome';
import WishlistCover from '@/components/WishlistCover';
import WishlistDescription from '@/components/WishlistDescription';
import WishlistTabs, { listTabId, listTabPanelId } from '@/components/WishlistTabs';
import WishlistPeopleTab from '@/components/WishlistPeopleTab';
import WishlistSettingsTab from '@/components/WishlistSettingsTab';
import WishlistItemsTab from '@/components/WishlistItemsTab';
import WishlistItemDialogs from '@/components/WishlistItemDialogs';
import WishlistPeopleDialogs from '@/components/WishlistPeopleDialogs';
import WishlistListDialogs from '@/components/WishlistListDialogs';
import { ListControlsSkeleton, Skeleton, SkeletonGrid } from '@/components/Skeleton';
import LoadError from '@/components/LoadError';
import WishlistUnavailable from '@/components/WishlistUnavailable';
import ShareLinkUnavailable from '@/components/ShareLinkUnavailable';
import ShareLinksSection, { type ShareLinksSectionHandle } from '@/components/ShareLinksSection';
import { isLinkLive, useShareLinks } from '@/lib/hooks/useShareLinks';
import { SHARE_TOKEN_HEADER, type ShareLinkLevel } from '@/lib/utils/shareLinkFields';
import { getVisibility } from '@/lib/utils/visibility';
import { useListTab, type ListTab } from '@/lib/hooks/useListTab';
import { useJoinRequest } from '@/lib/hooks/useJoinRequest';
import { useLinkJoin } from '@/lib/hooks/useLinkJoin';
import { useSettingsForm } from '@/lib/hooks/useSettingsForm';
import { useWishlistLoad } from '@/lib/hooks/useWishlistLoad';
import { useWishlistPeople, type DeleteConfirm } from '@/lib/hooks/useWishlistPeople';
import { useWishlistListActions } from '@/lib/hooks/useWishlistListActions';
import { useItemDialogs } from '@/lib/hooks/useItemDialogs';
import { useWishlistItemActions } from '@/lib/hooks/useWishlistItemActions';
import { useItemCards } from '@/lib/hooks/useItemCards';
import { useToast } from '@/components/ToastProvider';
import { IWishlist } from '@/models/Wishlist';
import type { ViewerRole } from '@/lib/utils/itemStatus';
import { countListChips } from '@/lib/utils/listChips';
import { useListFilters } from '@/lib/hooks/useListFilters';
import { useWishlistItems } from '@/lib/hooks/useWishlistItems';
import { useUpdateItem } from '@/lib/hooks/useItems';

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

/**
 * The wishlist page, for everyone who can open the list (WIS-372 split it up).
 * The page reads the list (`useWishlistLoad`) and keeps everything that has to
 * outlive a switch of tab: the items and their poll (`useWishlistItems`), the
 * filters (`useListFilters`), the cards' state (`useItemCards`), the dialogs
 * and their writes (`useWishlistItemActions`, `useWishlistPeople`,
 * `useWishlistListActions`) and the Settings form (`useSettingsForm`). Each of
 * an owner's tabs (Items · People · Settings) is its own component; anyone
 * else gets Items alone. Link mode (`/l/<token>`) is `address.kind === 'link'`.
 */
export default function WishlistPage({ address }: { address: WishlistAddress | null }) {
  const { data: session, status } = useKnownSession();
  const { showToast } = useToast();
  const wishlistId = address ? (address.kind === 'slug' ? address.id : address.listId) : null;
  // A share link's token, in link mode (else null), and what its reads send.
  const linkToken = address?.kind === 'link' ? address.token : null;
  const previewAsVisitor = address?.kind === 'link' && !!address.preview;
  // A Join link (WIS-337): Join this list in place of Ask to join.
  const joinLink = address?.kind === 'link' && address.level === 'join';
  const linkLevel = address?.kind === 'link' ? address.level : undefined;
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
  // The tab the URL is on (`?tab=`). Only an owner has tabs: anyone else is
  // shown Items whatever the URL says, and their URL is left as it is.
  const [urlTab, chooseTab] = useListTab();
  // Owners' Settings form: the page's, as it outlives the tab.
  const settings = useSettingsForm();

  // The list, the viewer's role on it, its owners, and where the page stands.
  const {
    owners,
    pageLoad,
    readsSent,
    readRefused,
    retryLoad,
    apiId,
    departedRef,
    isOwner,
    isMember,
    dropOwner,
    refreshOwners,
  } = useWishlistLoad({
    wishlistId,
    sessionStatus: status,
    readInit,
    linkToken,
    previewAsVisitor,
    linkLevel,
    setWishlist,
    refillSettings: settings.refill,
  });
  const refused = pageLoad === 'unavailable';
  const polling = pageLoad === 'loading' || pageLoad === 'ready';
  const ownerUsernames = owners.usernames;
  const ownerCount = owners.ids.length;
  const tab: ListTab = isOwner ? urlTab : 'items';
  const onItems = tab === 'items';
  const tabsId = useId();

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

  // People: the people, invites and requests to join, and every row action.
  // Its invite form and Share links section, which the header's Share and
  // Leave list's notice open too.
  const inviteFormRef = useRef<InviteMemberFormHandle>(null);
  // Remove, Leave list and Delete wishlist share one confirmation, so only one
  // is ever open.
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);
  const closeDeleteConfirm = useCallback(() => setDeleteConfirm(null), []);
  const shareLinksRef = useRef<ShareLinksSectionHandle>(null);
  const people = useWishlistPeople({
    wishlistId,
    apiId,
    isOwner,
    tab,
    chooseTab,
    ownerUsernames,
    dropOwner,
    refreshOwners,
    shareLinks,
    inviteFormRef,
    shareLinksRef,
    deleteConfirm,
    setDeleteConfirm,
  });

  const itemDialogs = useItemDialogs();
  const updateItemHook = useUpdateItem(undefined, itemDialogs.onItemRequestError);
  const failedItemsToast = useCallback(
    () => showToast('Failed to load items', 'error'),
    [showToast]
  );
  // The items: the first read, the 5s poll while Items is on screen, and the
  // optimistic updates that survive it (`mutations.track`).
  const itemsControl = useWishlistItems({
    wishlistId,
    readInit,
    previewAsVisitor,
    polling,
    pageLoad,
    onItems,
    readsSent,
    onRefused: readRefused,
    onReadFailed: failedItemsToast,
    viewerId,
    updateItem: updateItemHook,
  });
  const { items, itemsLoaded } = itemsControl;
  const itemActions = useWishlistItemActions({
    wishlistId,
    apiId,
    isOwner,
    owners,
    dialogs: itemDialogs,
    itemsControl,
  });

  // Opening People reads the owners again too, as it does the members: a
  // co-owner who accepted an invite since the page loaded then counts, so a
  // sole owner who invited one (as their Leave's notice says to) can leave
  // without reloading the page.
  const peopleOpen = tab === 'people';
  useEffect(() => {
    if (isOwner && peopleOpen) refreshOwners();
  }, [isOwner, peopleOpen, refreshOwners]);

  const listActions = useWishlistListActions({
    wishlistId,
    apiId,
    wishlist,
    setWishlist,
    departedRef,
    isOwner,
    isMember,
    ownerCount,
    refreshOwners,
    refreshMembers: people.refreshMembers,
    chooseTab,
    inviteFormRef,
    settings,
    reloadShareLinks: shareLinks.reload,
    deleteConfirm,
    setDeleteConfirm,
  });

  // What the list shows, and the chips, search, sort, budget and Prices that
  // narrow it (discreet mode applied at render time only).
  const filters = useListFilters({
    list: wishlist ? { id: String(wishlist._id), slug: wishlist.slug } : null,
    wishlistId,
    viewerRole,
    viewerId,
    isOwner,
    isMember,
    defaultCurrency: session?.user?.defaultCurrency,
    items,
    itemsLoaded,
  });
  // What they've reserved, for Leave list's copy: not hidden from them there,
  // since it says what they keep.
  const reservedByYou = useMemo(
    () => countListChips(items, viewerRole, viewerId)['reserved-by-you'],
    [items, viewerRole, viewerId]
  );

  // The cards: staying put when changed, group gifts, `?item=` and "Goes with".
  const cards = useItemCards({
    wishlistId,
    viewerRole,
    viewerId,
    onItems,
    itemsLoaded,
    filters,
    updateOptimistically: itemsControl.updateOptimistically,
    handleCardUpdate: itemActions.handleCardUpdate,
  });

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

  // An owner's Share: inviting happens on People, with its invite form on top.
  const shareOwner = {
    visibility: wishlist.visibility,
    archived: wishlist.archived,
    onInvite: () => chooseTab('people'),
    onShareLinks: people.openShareLinks,
    // Unknown until read: no hint either way.
    liveLinkCount: shareLinks.read === 'loaded' ? shareLinks.liveCount : undefined,
  };

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
          pinning={listActions.isPinning}
          // From People or Settings too, back on Items, where the item lands.
          onAddItem={() => {
            chooseTab('items');
            itemDialogs.setShowAddItemModal(true);
          }}
          onPropose={() => itemDialogs.setShowProposeItemModal(true)}
          onTogglePin={listActions.togglePinned}
          onLeave={listActions.startLeave}
          // An archived list's link opens for its owners only: anyone they'd
          // share it with gets the answer a missing list gets.
          share={
            !wishlist.archived && (
              // An owner's Share is where the guided walkthrough's Sharing step points (WIS-371).
              <span className="contents" data-tour={isOwner ? 'share' : undefined}>
                <ShareButton
                  // A link visitor shares the link they came by: the list's own
                  // URL may not open for whoever they send it to.
                  url={
                    linkToken ? `/l/${linkToken}` : `/wishlists/${wishlist.slug || wishlist._id}`
                  }
                  title={wishlist.name}
                  owner={isOwner ? shareOwner : undefined}
                />
              </span>
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
            ownerCount={ownerCount}
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
          ownerCount={ownerCount}
        />

        {/* An owner's tabs: Items · People (n) · Settings, in the URL (`?tab=`). */}
        {isOwner && (
          <WishlistTabs
            value={tab}
            onChange={chooseTab}
            peopleCount={people.peopleCount}
            idBase={tabsId}
          />
        )}

        {onItems && (
          <div {...tabPanel}>
            <WishlistItemsTab
              wishlist={wishlist}
              isOwner={isOwner}
              isMember={isMember}
              viewerRole={viewerRole}
              viewerId={viewerId}
              sessionUserId={session?.user?.id}
              isAuthenticated={!!session?.user}
              linkToken={linkToken}
              itemsControl={itemsControl}
              filters={filters}
              cards={cards}
              dialogs={itemDialogs}
              itemActions={itemActions}
              shareOwner={shareOwner}
              onUnarchive={() => listActions.setArchived(false)}
              isArchiving={listActions.isArchiving}
            />
          </div>
        )}

        {tab === 'people' && (
          <div {...tabPanel}>
            <WishlistPeopleTab
              inviteForm={
                <InviteMemberForm
                  ref={inviteFormRef}
                  onInvite={people.handleInvite}
                  isInviting={people.isInviting}
                  groups={people.peopleGroups.groups}
                  groupsFailed={people.peopleGroups.failed}
                  onRetryGroups={people.peopleGroups.retry}
                  onInviteGroup={people.handleInviteGroup}
                  statuses={people.inviteStatuses}
                  // A member's suggestion makes them a co-owner through the same
                  // confirmation and promotion invite as their Make owner.
                  onPromote={people.setPromoteConfirm}
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
              people={people.members}
              invites={people.pendingInvites}
              requests={people.joinRequests}
              onInviteRequest={(r) => people.answerJoinRequest(r, 'invite')}
              onDeclineRequest={(r) => people.answerJoinRequest(r, 'decline')}
              viewerId={viewerId}
              linkOpensForOthers={!wishlist.archived && getVisibility(wishlist) !== 'private'}
              ownerCount={ownerCount}
              loading={people.membersRead === 'loading'}
              failed={people.membersRead === 'failed'}
              onRetry={people.retryMembers}
              busy={people.rowBusy}
              onDemote={people.setDemoteConfirm}
              onPromote={people.setPromoteConfirm}
              onRemove={people.handleKickMember}
              onCancelInvite={people.cancelInvite}
            />
          </div>
        )}

        {tab === 'settings' && (
          <div {...tabPanel}>
            <WishlistSettingsTab
              form={settings.form}
              saved={settings.saved}
              dirty={settings.dirty}
              saving={listActions.isSavingSettings}
              onEdit={settings.edit}
              onSubmit={listActions.saveSettings}
              onDiscard={settings.discard}
              uploads={settings.uploads}
              archived={!!wishlist.archived}
              archiving={listActions.isArchiving}
              onArchive={() => listActions.setArchiveConfirm(true)}
              onUnarchive={() => listActions.setArchived(false)}
              deleting={listActions.isDeletingWishlist}
              onDelete={listActions.handleDeleteWishlist}
              liveLinkCount={shareLinks.liveCount}
              occasionLinkCount={
                shareLinks.links.filter((l) => l.untilOccasion && isLinkLive(l, new Date())).length
              }
              onStartNew={() => listActions.setStartNewOpen(true)}
            />
          </div>
        )}
      </main>

      <WishlistItemDialogs
        dialogs={itemDialogs}
        actions={itemActions}
        itemsControl={itemsControl}
        isOwner={isOwner}
        wishlistCurrency={wishlist?.currency}
        userCurrency={session?.user?.defaultCurrency}
      />
      <WishlistPeopleDialogs
        people={people}
        shareLinks={shareLinks}
        deleteConfirmOpen={deleteConfirm !== null}
        closeDeleteConfirm={closeDeleteConfirm}
      />
      <WishlistListDialogs
        wishlist={wishlist}
        actions={listActions}
        closeDeleteConfirm={closeDeleteConfirm}
        isOwner={isOwner}
        hasMembers={people.memberRows.length > 0}
        reservedByYou={itemsLoaded ? reservedByYou : null}
        hideReservations={filters.hideReservations}
        itemCount={itemsLoaded ? items.length : null}
      />
    </div>
  );
}
