'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import BaseModal from './BaseModal';
import AddItemModal, { type NewItemData } from './AddItemModal';
import Icon from './Icon';
import { Skeleton } from './Skeleton';
import { useToast } from './ToastProvider';
import type { ApiItem, ApiResponse } from '@/types/api';

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
  onClose: () => void;
}

/**
 * "Save to my list": pick one of your own lists, then add a copy of `item` to
 * it through `AddItemModal`, prefilled and editable before saving.
 *
 * The picker offers the lists you own (co-own included) that aren't archived,
 * apart from the item's own list. The copy is created with `sourceItemId`, so
 * the server checks you can see the source and gives the copy its own image
 * blob (see `POST /api/wishlists/[id]/items`).
 */
export default function SaveToListModal({ item, userCurrency, onClose }: SaveToListModalProps) {
  const { showToast } = useToast();
  // null while loading; the picker's lists once they're in.
  const [lists, setLists] = useState<OwnList[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Bumped by "Try again" to load the lists once more.
  const [attempt, setAttempt] = useState(0);
  const [target, setTarget] = useState<OwnList | null>(null);

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

  // Rejects on failure, after its toast, so AddItemModal stays open with the
  // user's input; it closes itself (and so this flow) on success.
  const handleSave = useCallback(
    async (data: NewItemData) => {
      if (!target) return;
      let result: ApiResponse<ApiItem> | null = null;
      try {
        const res = await fetch(`/api/wishlists/${target._id}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...data, sourceItemId: item._id }),
        });
        result = await res.json();
      } catch (error) {
        console.error('Error saving a copy of an item:', error);
      }
      if (!result?.success) {
        const message = result?.error || 'Failed to save the item';
        showToast(message, 'error');
        throw new Error(message);
      }
      showToast(`Saved to ${target.name}`, 'success');
      if (result.notice) showToast(result.notice, 'info');
    },
    [target, item._id, showToast]
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
      />
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
          <Link
            href="/wishlists/new"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            <Icon name="plus" size={16} />
            Create a wishlist
          </Link>
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
                  onClick={() => setTarget(list)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-left transition-colors hover:bg-muted"
                >
                  <span className="truncate font-medium text-foreground">{list.name}</span>
                  {typeof list.itemCount === 'number' && (
                    <span className="flex-shrink-0 text-xs text-muted-foreground" aria-hidden>
                      {list.itemCount} {list.itemCount === 1 ? 'item' : 'items'}
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
