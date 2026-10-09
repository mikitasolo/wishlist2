'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useRouter } from 'next/navigation';
import type { InviteMemberFormHandle } from '@/components/InviteMemberForm';
import { useToast } from '@/components/ToastProvider';
import { onCurrentListTab, type ListTab } from '@/lib/hooks/useListTab';
import type { SettingsFormControl } from '@/lib/hooks/useSettingsForm';
import { leftListToast } from '@/lib/utils/confirmationCopy';
import { missingFromDraft } from '@/lib/utils/occasion';
import type { ShownOwners } from '@/lib/utils/shownOwners';
import { settingsChanges, wishlistSettings } from '@/lib/utils/wishlistSettings';
import type { IWishlist } from '@/models/Wishlist';

export interface WishlistListActionsOptions {
  wishlistId: string | null;
  /** What the page's writes address the list by (see `useWishlistLoad`). */
  apiId: () => string;
  wishlist: IWishlist | null;
  setWishlist: Dispatch<SetStateAction<IWishlist | null>>;
  /** Set while the page leaves or deletes the list (see `useWishlistLoad`). */
  departedRef: MutableRefObject<boolean>;
  isOwner: boolean;
  isMember: boolean;
  ownerCount: number;
  refreshOwners: () => Promise<ShownOwners | null>;
  refreshMembers: () => Promise<void>;
  chooseTab: (tab: ListTab) => void;
  /** People's invite form, which the sole owner's notice opens for a co-owner. */
  inviteFormRef: RefObject<InviteMemberFormHandle | null>;
  settings: SettingsFormControl;
  reloadShareLinks: () => void;
}

/**
 * What an owner or member does to the list as a whole on the wishlist page
 * (WIS-372): Settings' save, archive, delete and Start a new list, and the
 * header's Pin and Leave list, with their confirmations.
 */
export function useWishlistListActions({
  wishlistId,
  apiId,
  wishlist,
  setWishlist,
  departedRef,
  isOwner,
  isMember,
  ownerCount,
  refreshOwners,
  refreshMembers,
  chooseTab,
  inviteFormRef,
  settings,
  reloadShareLinks,
}: WishlistListActionsOptions) {
  const router = useRouter();
  const { showToast } = useToast();
  // Leave list's or Delete wishlist's confirmation, while open.
  const [listConfirm, setListConfirm] = useState<'leave' | 'wishlist' | null>(null);
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
  // Set by the notice's "Invite a co-owner", so the invite form (in People,
  // opened for it if need be) is set up once the notice has closed: by then its
  // scroll lock is gone (it puts the page back where it was) and focus can stay
  // on the form.
  const inviteOwnerOnClose = useRef(false);
  // Pin to my dashboard: in flight. The ref turns a second pick away before
  // the held item has rendered.
  const pinningRef = useRef(false);
  const [isPinning, setIsPinning] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const handleLeaveWishlist = useCallback(() => {
    setListConfirm('leave');
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
  }, [soleOwnerNotice, inviteFormRef]);

  const confirmLeaveWishlist = useCallback(async () => {
    if (!wishlistId || listConfirm !== 'leave') return;

    // From the moment the leave may land: a poll refused because of it must
    // not show "not available" before the page moves on.
    departedRef.current = true;
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
      if (!left) departedRef.current = false;
      setListConfirm(null);
    }
  }, [apiId, wishlistId, listConfirm, wishlist?.name, router, showToast, departedRef]);

  const handleDeleteWishlist = useCallback(() => {
    setListConfirm('wishlist');
  }, []);

  const confirmDeleteWishlist = useCallback(async () => {
    if (!wishlistId || listConfirm !== 'wishlist') return;

    setIsDeletingWishlist(true);
    // As for leaving: the delete may land before its answer does.
    departedRef.current = true;
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
      if (!deleted) departedRef.current = false;
      setListConfirm(null);
      setIsDeletingWishlist(false);
    }
  }, [apiId, wishlistId, listConfirm, router, showToast, departedRef]);

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
    [apiId, wishlistId, showToast, setWishlist]
  );

  // Closed once the request settles, so the dialog shows it running meanwhile.
  const confirmArchive = useCallback(async () => {
    try {
      await setArchived(true);
    } finally {
      setArchiveConfirm(false);
    }
  }, [setArchived]);

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
  }, [apiId, wishlistId, wishlist, showToast, setWishlist]);

  const { form: settingsForm, saved: settingsBaseline, refill: refillSettings } = settings;
  const bannerUploads = settings.uploads;
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
      setWishlist,
    ]
  );

  return {
    listConfirm,
    setListConfirm,
    confirmLeaveWishlist,
    handleDeleteWishlist,
    confirmDeleteWishlist,
    isDeletingWishlist,
    archiveConfirm,
    setArchiveConfirm,
    confirmArchive,
    setArchived,
    isArchiving,
    startNewOpen,
    setStartNewOpen,
    soleOwnerNotice,
    setSoleOwnerNotice,
    inviteCoOwnerInstead,
    startLeave,
    togglePinned,
    isPinning,
    saveSettings,
    isSavingSettings,
  };
}

export type WishlistListActions = ReturnType<typeof useWishlistListActions>;
