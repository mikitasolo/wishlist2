'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import BaseModal from './BaseModal';
import AddItemModal, { type NewItemData } from './AddItemModal';
import CreateWishlistModal, { type CreatedWishlist } from './CreateWishlistModal';
import Icon from './Icon';
import { Skeleton } from './Skeleton';
import { useToast } from './ToastProvider';
import type { ApiItem, ApiResponse } from '@/types/api';
import { RequestTimeoutError, withRequestTimeout } from '@/lib/utils/requestTimeout';
import { formatItemCount } from '@/lib/utils/itemCounts';
import type { ProductPrefill } from '@/lib/utils/productFragment';

// `cameFrom` for the picker's "Create a wishlist" (a list's is its id).
const CREATE = 'create';

/** The fields of one of the viewer's lists (`GET /api/wishlists` → `owned`) the picker uses. */
interface OwnList {
  _id: string;
  name: string;
  slug?: string | null;
  currency?: string | null;
  archived?: boolean;
  itemCount?: number;
}

interface AddFromLinkFlowProps {
  /**
   * What the form starts from: a product read from the bookmarklet's fragment,
   * or null for the plain add flow. Read when the form opens (`AddItemModal`
   * takes it on mount), so whatever owns this (the page) settles it, image
   * included, before rendering the flow: that is the seam where WIS-366 swaps
   * the store's image URL for a re-hosted one.
   */
  product: ProductPrefill | null;
  userCurrency: string | null | undefined;
}

/**
 * The `/items/new` flow (WIS-365): pick one of your own lists that isn't
 * archived (or create one), then add the item through `AddItemModal`, prefilled
 * with `product` and editable, with "Save as draft" / "Add to list" as ever.
 * Nothing is saved until one of them is pressed. The form's "‹ Change list"
 * goes back to the picker; closing anywhere leaves for Home; a save lands on
 * the list.
 *
 * It mirrors `SaveToListModal`'s picker, without a source item: the item is a
 * plain new one (no `sourceItemId`), so an image is whatever URL the form
 * holds.
 */
export default function AddFromLinkFlow({ product, userCurrency }: AddFromLinkFlowProps) {
  const router = useRouter();
  const { showToast } = useToast();
  // null while loading; the picker's lists once they're in.
  const [lists, setLists] = useState<OwnList[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Bumped by "Try again" to load the lists once more.
  const [attempt, setAttempt] = useState(0);
  const [target, setTarget] = useState<OwnList | null>(null);
  // The create dialog is open, in the picker's place.
  const [creating, setCreating] = useState(false);
  // What took the flow on from the picker, to put focus back on when it comes back.
  const [cameFrom, setCameFrom] = useState<string | null>(null);

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
        setLists(result.data.owned.filter((w) => !w.archived));
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = () => {
    setLoadFailed(false);
    setLists(null);
    setAttempt((n) => n + 1);
  };

  // Set once an item is saved: the form then closes itself, and that must not
  // send the visitor Home over the trip to the list.
  const saved = useRef(false);
  const leave = useCallback(() => {
    if (!saved.current) router.push('/');
  }, [router]);

  // The new list joins the picker (newest first, as the API sorts them), so
  // "Change list" finds it there, and the form opens on it.
  const handleCreated = useCallback((created: CreatedWishlist) => {
    const list: OwnList = {
      _id: created._id,
      name: created.name,
      slug: created.slug,
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
  // user's input. On success it goes to the list.
  const handleSave = useCallback(
    async (data: NewItemData) => {
      if (!target) return;
      let result: ApiResponse<ApiItem>;
      try {
        // Given up on after ITEM_REQUEST_TIMEOUT_MS, like the page's other item requests.
        result = await withRequestTimeout(async (signal) => {
          const res = await fetch(`/api/wishlists/${target._id}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
            signal,
          });
          return await res.json();
        });
      } catch (error) {
        console.error('Error adding an item from a link:', error);
        // A timeout says so; any other failure gets the generic message.
        result = {
          success: false,
          error: error instanceof RequestTimeoutError ? error.message : undefined,
        };
      }
      if (!result.success) {
        const message = result.error || 'Failed to save the item';
        showToast(message, 'error');
        throw new Error(message);
      }
      saved.current = true;
      showToast(
        data.status === 'draft' ? `Saved as a draft in ${target.name}` : `Added to ${target.name}`,
        'success'
      );
      if (result.notice) showToast(result.notice, 'info');
      router.push(`/wishlists/${encodeURIComponent(target.slug ?? target._id)}`);
    },
    [target, showToast, router]
  );

  if (target) {
    return (
      <AddItemModal
        isOpen
        onClose={leave}
        onAdd={handleSave}
        wishlistCurrency={target.currency}
        userCurrency={userCurrency}
        initialItem={product ?? undefined}
        title={`Add to ${target.name}`}
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
    <BaseModal isOpen onClose={leave} title="Add to a wishlist" titleId="add-from-link-title">
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
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            {lists.length === 0
              ? 'You don’t have a wishlist yet. Create one to add this to.'
              : 'Pick one of your wishlists. You can edit the item before it’s saved.'}
          </p>
          {lists.length > 0 && (
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
          )}
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setCameFrom(CREATE);
            }}
            autoFocus={cameFrom === CREATE}
            className={`inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline ${lists.length > 0 ? 'mt-4' : ''}`}
          >
            <Icon name="plus" size={16} />
            Create a wishlist
          </button>
        </>
      )}
    </BaseModal>
  );
}
