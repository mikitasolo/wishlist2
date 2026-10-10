'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { track } from '@/lib/analytics';
import type { InviteMemberFormHandle } from '@/components/InviteMemberForm';
import type { ShareLinksSectionHandle } from '@/components/ShareLinksSection';
import { useToast } from '@/components/ToastProvider';
import type {
  JoinRequestView,
  PendingInvite,
  WishlistPerson,
} from '@/components/WishlistPeopleTab';
import { useBusyIds } from '@/lib/hooks/useBusyIds';
import type { ListTab } from '@/lib/hooks/useListTab';
import { usePeopleGroups } from '@/lib/hooks/usePeopleGroups';
import { useUndoableAction } from '@/lib/hooks/useUndoableAction';
import type { ShareLinksControl } from '@/lib/hooks/useShareLinks';
import type { GroupInviteResult } from '@/lib/utils/groupInviteResult';
import { demotedToast, removedToast } from '@/lib/utils/confirmationCopy';
import { listStatusByUsername } from '@/lib/utils/inviteSuggestions';
import { RequestTimeoutError, withRequestTimeout } from '@/lib/utils/requestTimeout';
import type { RemovedOwner, ShownOwners } from '@/lib/utils/shownOwners';

/** How long the page waits on a group invite (its route may take up to 60s). */
const GROUP_INVITE_TIMEOUT_MS = 65_000;

export interface WishlistPeopleOptions {
  wishlistId: string | null;
  /** What the page's writes address the list by (see `useWishlistLoad`). */
  apiId: () => string;
  isOwner: boolean;
  tab: ListTab;
  chooseTab: (tab: ListTab) => void;
  /** The owners the page shows, for the invite form's suggestions. */
  ownerUsernames: string[];
  dropOwner: (owner: RemovedOwner) => void;
  refreshOwners: () => Promise<ShownOwners | null>;
  /** The list's share links (owners only). */
  shareLinks: ShareLinksControl;
  /** People's invite form (the page's, as Leave list's notice opens it too). */
  inviteFormRef: RefObject<InviteMemberFormHandle | null>;
  /** People's Share links section, which Share's "Share links" goes to. */
  shareLinksRef: RefObject<ShareLinksSectionHandle | null>;
}

/**
 * The page's one removal confirmation: Leave list or Delete wishlist. One
 * state, so opening one replaces the other and closing either closes whichever
 * is open. (A person's Remove has an Undo toast instead, WIS-387.)
 */
export type DeleteConfirm = { type: 'leave' | 'wishlist' };

/** A person's row on People, as Remove takes it. */
export interface PersonToRemove {
  /** What the removal's route takes: an owner's user id, a member's membership id. */
  id: string;
  /** Their user id, which their row's actions are held by. */
  userId: string;
  username: string | null;
  role: 'owner' | 'member';
}

/**
 * The owners' People tab on the wishlist page (WIS-372): the people, pending
 * invites and requests to join, read by the page (People's count needs them
 * before the tab opens), and every row action. Each row's actions are held
 * while one is in flight (`useBusyIds`).
 *
 * Remove, Make member, cancelling an invite and declining a request to join
 * are deferred with Undo (WIS-387, `useUndoableAction`): the row changes at
 * once, and the request goes only once the Undo window has passed. Undone,
 * nothing was sent, so the person is never notified of a removal or demotion
 * that didn't happen, and nothing they reserved was released. Until the
 * request has settled, the change is laid over every read of the people
 * (`hidden`, `demoting`), so a read can't bring the row back meanwhile.
 */
export function useWishlistPeople({
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
}: WishlistPeopleOptions) {
  const { showToast } = useToast();
  const offerUndo = useUndoableAction();
  // Rows taken off People while their deferred request waits or is on its way:
  // `person:<userId>`, `invite:<id>`, `request:<id>`. And owners shown as
  // members while their Make member waits (by user id).
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [demoting, setDemoting] = useState<ReadonlySet<string>>(() => new Set());
  // Everyone on the list, owners and members (owners only ever read it).
  const [members, setMembers] = useState<WishlistPerson[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  // Pending requests to join the list (owners only, read when People opens).
  const [joinRequests, setJoinRequests] = useState<JoinRequestView[]>([]);
  // Where the first read of the people on the list stands (owners only):
  // until it has landed there's no count on People and no rows in it, and if
  // it failed, People says so, with Try again.
  const [membersRead, setMembersRead] = useState<'loading' | 'loaded' | 'failed'>('loading');
  // Your own groups, for the People tab's invite form (WIS-37): read when it opens.
  const peopleGroups = usePeopleGroups(tab === 'people');
  const [isInviting, setIsInviting] = useState(false);
  // Promoting someone to co-owner is destructive for them (it cancels the
  // reservations they hold here) and irreversible without their consent, so it
  // always goes through an explicit warning first.
  const [promoteConfirm, setPromoteConfirm] = useState<{
    userId: string;
    username: string;
  } | null>(null);

  // An owner the viewer has just removed or made a member, who could have
  // copied the list's live share links: offered for revoking once the removal
  // has gone through (WIS-338). Links stay unless revoked.
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
  }, [toShareLinks, tab, shareLinks.read, shareLinks.links.length, shareLinksRef]);

  // Reads of the invites and of the people, numbered as they're sent, and the
  // number of the latest one whose answer the page took. Each is read again
  // after every change the page makes (an invite, a demotion, a removal), and
  // opening People reads them too, so an older read that answers late (say,
  // the one opening People, after a demotion's) would put back what the
  // change took away: an answer sent before the one on screen is dropped.
  const invitesReads = useRef({ sent: 0, landed: 0 });
  const requestsReads = useRef({ sent: 0, landed: 0 });
  const membersReads = useRef({ sent: 0, landed: 0 });

  // Refresh the pending-invites list (owners only).
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

  /**
   * One deferred row action (WIS-387), held on its row (`busyId`) from the tap
   * until its request and the reads after it have settled. `show` lays the
   * change over the rows at once and `unshow` lifts it once it's over: undone
   * (the row is as it was, nothing sent), failed (the row comes back) or done
   * (the reads `commit` awaited no longer list it as it was).
   */
  const deferRowAction = useCallback(
    (
      busyId: string,
      {
        message,
        show,
        unshow,
        commit,
      }: {
        message: string;
        show: () => void;
        unshow: () => void;
        commit: (keepalive: boolean) => Promise<void>;
      }
    ) =>
      runRowAction(busyId, async () => {
        show();
        const pending = offerUndo({
          message,
          commit: ({ keepalive }) => commit(keepalive),
        });
        try {
          await pending.settled;
        } finally {
          unshow();
        }
      }),
    [runRowAction, offerUndo]
  );
  const hideRow = useCallback(
    (key: string) => () => setHidden((prev) => new Set(prev).add(key)),
    []
  );
  const showRow = useCallback(
    (key: string) => () =>
      setHidden((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      }),
    []
  );

  /**
   * Cancel a pending invite: an invite's row, or a member's owner invite
   * (`busyId`: its row). Deferred with Undo (see `deferRowAction`).
   */
  const cancelInvite = useCallback(
    (inviteId: string, busyId: string) => {
      if (!wishlistId) return;
      const key = `invite:${inviteId}`;
      return deferRowAction(busyId, {
        message: 'Invitation cancelled',
        show: hideRow(key),
        unshow: showRow(key),
        commit: async (keepalive) => {
          try {
            const res = await fetch(`/api/wishlists/${apiId()}/invites/${inviteId}`, {
              method: 'DELETE',
              keepalive,
            });
            const result = await res.json();
            if (result.success) {
              setPendingInvites((prev) => prev.filter((i) => i._id !== inviteId));
            } else {
              showToast(result.error || 'Failed to cancel invitation', 'error');
              await refreshInvites();
            }
          } catch {
            showToast('Failed to cancel invitation', 'error');
            await refreshInvites();
          }
        },
      });
    },
    [apiId, wishlistId, showToast, refreshInvites, deferRowAction, hideRow, showRow]
  );

  /**
   * Answer a request to join (by its id, which is also its row's busy id).
   * Invite sends them a member invite at once, which joins the Invited group.
   * Decline ends it and tells nobody, deferred with Undo (see
   * `deferRowAction`). Either way the row goes at once.
   */
  const answerJoinRequest = useCallback(
    (joinRequest: JoinRequestView, action: 'invite' | 'decline') => {
      if (!wishlistId) return;
      const send = async (keepalive: boolean) => {
        const name = joinRequest.user.username ? `@${joinRequest.user.username}` : 'them';
        const failed = action === 'invite' ? 'Couldn’t send the invite' : 'Couldn’t decline it';
        try {
          const res = await fetch(`/api/wishlists/${apiId()}/requests/${joinRequest._id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action }),
            keepalive,
          });
          const result = await res.json();
          if (result.success) {
            setJoinRequests((prev) => prev.filter((r) => r._id !== joinRequest._id));
            if (action === 'invite') {
              showToast(`Invite sent to ${name}`, 'success');
              await refreshInvites();
            }
          } else {
            showToast(result.error || failed, 'error');
            await Promise.all([refreshRequests(), refreshMembers(), refreshInvites()]);
          }
        } catch {
          showToast(failed, 'error');
          await refreshRequests();
        }
      };
      const key = `request:${joinRequest._id}`;
      if (action === 'decline') {
        return deferRowAction(joinRequest._id, {
          message: 'Request declined',
          show: hideRow(key),
          unshow: showRow(key),
          commit: send,
        });
      }
      return runRowAction(joinRequest._id, async () => {
        hideRow(key)();
        try {
          await send(false);
        } finally {
          showRow(key)();
        }
      });
    },
    [
      apiId,
      wishlistId,
      showToast,
      refreshInvites,
      refreshRequests,
      refreshMembers,
      runRowAction,
      deferRowAction,
      hideRow,
      showRow,
    ]
  );

  /**
   * Remove someone from the list: a member's membership, or an owner (through
   * the owners endpoint, by user id). Deferred with Undo (see
   * `deferRowAction`): undone, nothing is sent, so they're never told and
   * nothing they reserved is released. The share-link offer and the owners'
   * update follow only a removal that went through.
   */
  const handleKickMember = useCallback(
    (person: PersonToRemove) => {
      if (!wishlistId) return;
      const { id, userId, username, role } = person;
      const key = `person:${userId}`;
      return deferRowAction(userId, {
        message: removedToast(username, role, { liveLinks: hasLiveLinks }),
        show: hideRow(key),
        unshow: showRow(key),
        commit: async (keepalive) => {
          const path =
            role === 'owner'
              ? `/api/wishlists/${apiId()}/owners/${id}`
              : `/api/wishlists/${apiId()}/members/${id}`;
          try {
            const response = await fetch(path, { method: 'DELETE', keepalive });
            const result = await response.json();
            if (result.success) {
              // Removing someone also cancels any invite they still had pending here.
              if (role === 'owner') {
                dropOwner({ id, username });
                offerLinkRevoke(username);
                await Promise.all([refreshMembers(), refreshInvites(), refreshOwners()]);
              } else {
                await Promise.all([refreshMembers(), refreshInvites()]);
              }
            } else {
              showToast(result.error || 'Failed to remove member', 'error');
              // A refusal may be because the server already did it (a co-owner
              // got there first): read the people again so the page agrees.
              await Promise.all([refreshMembers(), ...(role === 'owner' ? [refreshOwners()] : [])]);
            }
          } catch (error) {
            console.error('Error removing member:', error);
            showToast('Failed to remove member', 'error');
            if (role === 'owner') await Promise.all([refreshMembers(), refreshOwners()]);
          }
        },
      });
    },
    [
      hasLiveLinks,
      apiId,
      wishlistId,
      showToast,
      refreshMembers,
      refreshInvites,
      dropOwner,
      refreshOwners,
      offerLinkRevoke,
      deferRowAction,
      hideRow,
      showRow,
    ]
  );

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
   * Step an owner down to a plain member. Deferred with Undo (see
   * `deferRowAction`): their row shows them as a member at once, held until
   * it's over, and undone, nothing is sent, so they're never told. Making them
   * an owner again would need their consent, which is why it waits.
   */
  const demoteOwner = useCallback(
    (userId: string, username: string | null) => {
      if (!wishlistId) return;
      return deferRowAction(userId, {
        message: demotedToast(username),
        show: () => setDemoting((prev) => new Set(prev).add(userId)),
        unshow: () =>
          setDemoting((prev) => {
            const next = new Set(prev);
            next.delete(userId);
            return next;
          }),
        commit: async (keepalive) => {
          try {
            const res = await fetch(`/api/wishlists/${apiId()}/owners/${userId}`, {
              method: 'PATCH',
              keepalive,
            });
            const result = await res.json();
            if (result.success) {
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
        },
      });
    },
    [
      apiId,
      wishlistId,
      showToast,
      refreshMembers,
      refreshInvites,
      dropOwner,
      refreshOwners,
      offerLinkRevoke,
      deferRowAction,
    ]
  );

  /** Make member, from an owner's row. */
  const handleDemoteOwner = useCallback(
    (owner: { userId: string; username: string | null }) => {
      void demoteOwner(owner.userId, owner.username);
    },
    [demoteOwner]
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

  // The rows as People shows them: each deferred change laid over the last
  // read (see `hidden`, `demoting`).
  const shownMembers = useMemo(
    () =>
      members
        .filter((m) => !hidden.has(`person:${String(m.user._id)}`))
        .map((m) =>
          m.role === 'owner' && demoting.has(String(m.user._id))
            ? { ...m, role: 'member' as const }
            : m
        ),
    [members, hidden, demoting]
  );
  const shownInvites = useMemo(
    () => pendingInvites.filter((i) => !hidden.has(`invite:${i._id}`)),
    [pendingInvites, hidden]
  );
  const shownRequests = useMemo(
    () => joinRequests.filter((r) => !hidden.has(`request:${r._id}`)),
    [joinRequests, hidden]
  );

  // The members endpoint returns one list; the UI shows the two relationships
  // separately, because they aren't rungs on a ladder.
  const memberRows = useMemo(() => shownMembers.filter((m) => m.role !== 'owner'), [shownMembers]);
  // People's count: everyone on the list, owners and members, once read.
  const peopleCount = membersRead === 'loaded' ? shownMembers.length : null;

  // Who each username suggestion in the invite form already is on the list.
  const inviteStatuses = useMemo(
    () =>
      listStatusByUsername({
        owners: ownerUsernames,
        members: memberRows.map((m) => ({
          userId: String(m.user._id),
          username: m.user.username,
        })),
        invited: shownInvites.map((i) => i.username),
      }),
    [ownerUsernames, memberRows, shownInvites]
  );

  return {
    members: shownMembers,
    memberRows,
    peopleCount,
    pendingInvites: shownInvites,
    joinRequests: shownRequests,
    membersRead,
    refreshMembers,
    retryMembers,
    peopleGroups,
    isInviting,
    handleInvite,
    handleInviteGroup,
    inviteStatuses,
    rowBusy,
    cancelInvite,
    answerJoinRequest,
    handleKickMember,
    promoteConfirm,
    setPromoteConfirm,
    confirmPromoteToOwner,
    handleDemoteOwner,
    openShareLinks,
    hasLiveLinks,
    revokeLinksFor,
    setRevokeLinksFor,
  };
}

export type WishlistPeopleControl = ReturnType<typeof useWishlistPeople>;
