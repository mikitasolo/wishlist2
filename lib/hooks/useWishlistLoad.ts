'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useRouter } from 'next/navigation';
import { track } from '@/lib/analytics';
import { onCurrentListTab } from '@/lib/hooks/useListTab';
import type { PageLoad } from '@/lib/hooks/useWishlistItems';
import { readResource } from '@/lib/utils/resourceRead';
import type { ShareLinkLevel } from '@/lib/utils/shareLinkFields';
import {
  createOwnerRemovalLog,
  shownOwnersOf,
  withoutOwner,
  type RemovedOwner,
  type ShownOwners,
} from '@/lib/utils/shownOwners';
import { wishlistSettings, type WishlistSettings } from '@/lib/utils/wishlistSettings';
import type { IWishlist } from '@/models/Wishlist';

export interface WishlistLoadOptions {
  /** The list's slug or id from the URL (link mode: the id the token resolved to). */
  wishlistId: string | null;
  /**
   * The session's status. The first read doesn't wait for it (WIS-444): the
   * route answers by the request's own cookie, whatever the client has read of
   * the session, so the two reads go out together. Only a change of status once
   * known (signed out, or signed in, elsewhere) reads the list again; a switch
   * from one signed-in account to another isn't seen here, as before.
   */
  sessionStatus: 'loading' | 'authenticated' | 'unauthenticated';
  /** What every read of the list sends (link mode: the share token). */
  readInit: RequestInit | undefined;
  linkToken: string | null;
  previewAsVisitor: boolean;
  linkLevel: ShareLinkLevel | undefined;
  /** The page's list state, which writes elsewhere on the page update too. */
  setWishlist: Dispatch<SetStateAction<IWishlist | null>>;
  /** Fills the settings form from each read of the list. */
  refillSettings: (list: WishlistSettings) => void;
}

/**
 * The wishlist page's read of the list (WIS-372): where the page stands with
 * it (`pageLoad`), the viewer's role, the owners it shows, and what a refused
 * read of the list or its items means. Link mode (`linkToken`) never follows a
 * slug: any refusal is the link's.
 */
export function useWishlistLoad({
  wishlistId,
  sessionStatus: status,
  readInit,
  linkToken,
  previewAsVisitor,
  linkLevel,
  setWishlist,
  refillSettings,
}: WishlistLoadOptions) {
  const router = useRouter();
  const linkOpenTracked = useRef(false);
  // The list's owners, counted and credited from here rather than from
  // `wishlist.owners`: a settings save answers with the list as its own write
  // left it, which can predate a demotion landing meanwhile, and without their
  // names. Only a read of the list sets them, less any owner the page has taken
  // off since that read was sent (`ownerRemovals`), and a demotion or removal
  // takes its owner off at once.
  const [owners, setOwners] = useState<ShownOwners>({ ids: [], usernames: [] });
  const [ownerRemovals] = useState(createOwnerRemovalLog);
  // Where the page stands with the list. `unavailable`: a read of the list or
  // its items was refused (the list is missing, or hidden from this viewer),
  // which the page shows in place. `failed`: the first read of the list failed
  // for some other reason (a 5xx, the network), with a Try again that reads it
  // afresh (`attempt`). The items are polled only while the list is loading or
  // on screen.
  const [pageLoad, setPageLoad] = useState<PageLoad>('loading');
  const [attempt, setAttempt] = useState(0);
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
  const departed: RefObject<boolean> = useRef(false);
  const [isOwner, setIsOwner] = useState(false);
  const [isMember, setIsMember] = useState(false);

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

  // Bumped when the session changes from one known status to another, not when
  // it first becomes known: the first read went out with the same cookie the
  // session read did, so its answer already is that session's (WIS-444).
  const [sessionChanges, setSessionChanges] = useState(0);
  const knownStatus = useRef<string | null>(null);
  useEffect(() => {
    if (status === 'loading') return;
    if (knownStatus.current !== null && knownStatus.current !== status) {
      setSessionChanges((n) => n + 1);
    }
    knownStatus.current = status;
  }, [status]);

  // The id belongs to the URL it was read at: another URL (another list, or the
  // same one under its new slug) is read afresh before the id is used again.
  useEffect(() => {
    listId.current = null;
  }, [wishlistId]);

  // Fetch wishlist and determine role. Whatever the answer, the page stays at
  // this URL and says where things stand (see `pageLoad`), with no toast.
  useEffect(() => {
    if (!wishlistId) return;
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
      // A share link opened (counted once a visit), whoever opened it, but not
      // an owner's Preview as visitor.
      if (linkToken && !previewAsVisitor && !linkOpenTracked.current) {
        linkOpenTracked.current = true;
        track('share_link_opened', { level: linkLevel ?? 'view' });
      }
      // An owner or member who opened a share link belongs at the list's own
      // URL (only the client knows who's viewing). An owner's Preview as
      // visitor stays, and is shown the page as a visitor.
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
    sessionChanges,
    refillSettings,
    ownerRemovals,
    readRefused,
    attempt,
    readInit,
    linkToken,
    previewAsVisitor,
    linkLevel,
    setWishlist,
  ]);

  // Try again, after the list couldn't be read: the skeleton, then a fresh
  // read of the list and its items.
  const retryLoad = useCallback(() => {
    setPageLoad('loading');
    setAttempt((n) => n + 1);
  }, []);

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

  return {
    owners,
    pageLoad,
    readsSent,
    readRefused,
    retryLoad,
    apiId,
    departedRef: departed,
    isOwner,
    isMember,
    dropOwner,
    refreshOwners,
  };
}
