'use client';

import { useCallback, useEffect, useState } from 'react';
import BaseModal from './BaseModal';
import AddItemModal, { type NewItemData } from './AddItemModal';
import CreateWishlistModal, { type CreatedWishlist } from './CreateWishlistModal';
import Icon from './Icon';
import { Skeleton } from './Skeleton';
import { useToast } from './ToastProvider';
import type { ApiItem, ApiResponse } from '@/types/api';
import type { MutationTracker } from '@/lib/utils/itemListMerge';
import { RequestTimeoutError, withRequestTimeout } from '@/lib/utils/requestTimeout';
import { formatItemCount } from '@/lib/utils/itemCounts';

// `cameFrom` for the picker's "Create a wishlist" (a list's is its id).
const CREATE = 'create';

/** The fields of one of the viewer's lists (`GET /api/wishlists` → `owned`) the picker uses. */
interface OwnList {
  _id: string;
  name: string;
  currency?: string | null;
  archived?: boolean;
  itemCount?: number;
}

interface SaveToListModalProps {
  /** The item to save a copy of. */
  item: ApiItem;
  userCurrency: string | null | undefined;
  /** The page's item mutations: the copy's request goes through `track`, like the others. */
  mutations: Pick<MutationTracker, 'track'>;
  onClose: () => void;
}

/**
 * "Save to my list": pick one of your own lists, then add a copy of `item` to
 * it through `AddItemModal`, prefilled and editable before saving. The form's
 * "‹ Change list" goes back to the picker.
 *
 * The picker offers the lists you own (co-own included) that aren't archived,
 * apart from the item's own list. With none, it offers to create one, in
 * `CreateWishlistModal` in its place, and goes on to the form with the new list
 * (cancelling that goes back to the picker). The copy is created with
 * `sourceItemId`, so the server checks you can see the source and gives the
 * copy its own image blob (see `POST /api/wishlists/[id]/items`).
 */
export default function SaveToListModal({
  item,
  userCurrency,
  mutations,
  onClose,
}: SaveToListModalProps) {
  const { showToast } = useToast();
  // null while loading; the picker's lists once they're in.
  const [lists, setLists] = useState<OwnList[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Bumped by "Try again" to load the lists once more.
  const [attempt, setAttempt] = useState(0);
  const [target, setTarget] = useState<OwnList | null>(null);
  // The create dialog is open, in the picker's place.
  const [creating, setCreating] = useState(false);
  // What took the flow on from the picker, a list's button (its id) or "Create
  // a wishlist", to put focus back on when the picker comes back ("Change list",
  // or cancelling the create dialog), as a dialog gives focus back to its opener.
  const [cameFrom, setCameFrom] = useState<string | null>(null);

  // Focus goes back to what opened the flow (the card's Save button) when it
  // closes. Each dialog returns focus to its own opener, but the form's is the
  // picker button that was clicked, gone with the picker by the time the form
  // closes. Read while rendering the open, before a dialog takes focus.
  const [opener] = useState(() =>
    typeof document === 'undefined' ? null : document.activeElement
  );
  useEffect(
    () => () => {
      // After the dialogs' own focus returns, and only if focus was lost.
      queueMicrotask(() => {
        const lost = !document.activeElement || document.activeElement === document.body;
        if (lost && opener instanceof HTMLElement && opener.isConnected) {
          opener.focus({ preventScroll: true });
        }
      });
    },
    [opener]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/wishlists', { cache: 'no-store' });
        const result: ApiResponse<{ owned: OwnList[] }> = await res.json();
        if (cancelled) return;
        if (!result.success || !result.data) {
          setLoadFailed(true);
          return;
        }
        setLists(result.data.owned.filter((w) => !w.archived && w._id !== item.wishlist));
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.wishlist, attempt]);

  const retry = () => {
    setLoadFailed(false);
    setLists(null);
    setAttempt((n) => n + 1);
  };

  // The new list joins the picker (newest first, as the API sorts them), so
  // "Change list" finds it there, and the form opens on it.
  const handleCreated = useCallback((created: CreatedWishlist) => {
    const list: OwnList = {
      _id: created._id,
      name: created.name,
      currency: created.currency,
      itemCount: 0,
    };
    setLists((current) => [list, ...(current ?? [])]);
    setTarget(list);
    setCameFrom(list._id);
  }, []);

  const pick = (list: OwnList) => {
    setTarget(list);
    setCameFrom(list._id);
  };

  // Rejects on failure, after its toast, so AddItemModal stays open with the
  // user's input; it closes itself (and so this flow) on success.
  const handleSave = useCallback(
    async (data: NewItemData) => {
      if (!target) return;
      const result = await mutations.track(async (): Promise<ApiResponse<ApiItem>> => {
        try {
          // Given up on after ITEM_REQUEST_TIMEOUT_MS, like the page's other item requests.
          return await withRequestTimeout(async (signal) => {
            const res = await fetch(`/api/wishlists/${target._id}/items`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...data, sourceItemId: item._id }),
              signal,
            });
            return await res.json();
          });
        } catch (error) {
          console.error('Error saving a copy of an item:', error);
          // A timeout says so; any other failure gets the generic message.
          return {
            success: false,
            error: error instanceof RequestTimeoutError ? error.message : undefined,
          };
        }
      });
      if (!result?.success) {
        const message = result?.error || 'Failed to save the item';
        showToast(message, 'error');
        throw new Error(message);
      }
      showToast(`Saved to ${target.name}`, 'success');
      if (result.notice) showToast(result.notice, 'info');
    },
    [target, item._id, showToast, mutations]
  );

  if (target) {
    return (
      <AddItemModal
        isOpen
        onClose={onClose}
        onAdd={handleSave}
        wishlistCurrency={target.currency}
        userCurrency={userCurrency}
        initialItem={item}
        title={`Save to ${target.name}`}
        back={{ label: 'Change list', onBack: () => setTarget(null) }}
      />
    );
  }

  if (creating) {
    return (
      <CreateWishlistModal isOpen onClose={() => setCreating(false)} onCreated={handleCreated} />
    );
  }

  return (
    <BaseModal isOpen onClose={onClose} title="Save to my list" titleId="save-to-list-title">
      {loadFailed ? (
        <div className="py-6 text-center">
          <p className="text-sm text-muted-foreground">Couldn&apos;t load your lists.</p>
          <button
            type="button"
            onClick={retry}
            className="mt-3 text-sm font-medium text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      ) : lists === null ? (
        <div className="space-y-2" aria-label="Loading your lists">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : lists.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-muted-foreground">
            You don&apos;t have another wishlist to save this to.
          </p>
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setCameFrom(CREATE);
            }}
            autoFocus={cameFrom === CREATE}
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            <Icon name="plus" size={16} />
            Create a wishlist
          </button>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            Pick one of your wishlists. You can edit the item before it&apos;s saved.
          </p>
          <ul className="space-y-2">
            {lists.map((list) => (
              <li key={list._id}>
                <button
                  type="button"
                  onClick={() => pick(list)}
                  autoFocus={cameFrom === list._id}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-left transition-colors hover:bg-muted"
                >
                  <span className="truncate font-medium text-foreground">{list.name}</span>
                  {typeof list.itemCount === 'number' && (
                    <span className="flex-shrink-0 text-xs text-muted-foreground" aria-hidden>
                      {formatItemCount(list.itemCount)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </BaseModal>
  );
}
