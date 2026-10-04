/**
 * Reusable API hooks for wishlist items
 *
 * The update, create and delete hooks give up on a request that hasn't
 * answered within `ITEM_REQUEST_TIMEOUT_MS` (see `withRequestTimeout`). A
 * timeout is reported like any other failure: `onError` gets the "took too
 * long" message and the hook resolves `null` / `false`. A retry then sends a
 * new request, because the abandoned one is no longer shared. That retry is
 * safe even when the abandoned request was saved (WIS-158): a create sent with
 * the same `idempotencyKey` answers with the item the first attempt made, and a
 * delete whose item is already gone (404) counts as done.
 */

import { useCallback } from 'react';
import { ApiItem, ApiResponse } from '@/types/api';
import { deduplicateRequest, createRequestKey } from '@/lib/utils/requestDeduplication';
import { withRequestTimeout } from '@/lib/utils/requestTimeout';
import { IDEMPOTENCY_HEADER } from '@/lib/utils/submissionKey';
import { isRefusal, ReadRefusedError } from '@/lib/utils/resourceRead';

/**
 * Hook for updating an item
 */
export function useUpdateItem(
  onSuccess?: (updatedItem: ApiItem) => void,
  onError?: (error: string) => void
) {
  return useCallback(
    async (id: string, updates: Partial<ApiItem>): Promise<ApiItem | null> => {
      const requestKey = createRequestKey(`/api/items/${id}`, 'PATCH', updates);

      try {
        const data = await deduplicateRequest(requestKey, () =>
          withRequestTimeout(async (signal) => {
            const response = await fetch(`/api/items/${id}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(updates),
              signal,
            });

            const result: ApiResponse<ApiItem> = await response.json();

            if (!result.success) {
              if (response.status === 403 && result.error?.includes('archived')) {
                throw new Error(result.error);
              }
              throw new Error(result.error || 'Failed to update item');
            }

            return result.data!;
          })
        );

        onSuccess?.(data);
        return data;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to update item';
        onError?.(errorMessage);
        console.error('Error updating item:', error);
        return null;
      }
    },
    [onSuccess, onError]
  );
}

/**
 * Hook for creating an item
 */
export function useCreateItem(
  onSuccess?: (newItem: ApiItem) => void,
  onError?: (error: string) => void
) {
  return useCallback(
    async (
      wishlistId: string,
      newItem: {
        name: string;
        imageUrl?: string | null;
        price?: { value: number; currency: string } | null;
        link?: string | null;
        notes?: string | null;
        mostWanted?: boolean;
        status?: 'draft' | 'available';
      },
      /** The submission's key (`createSubmissionKeys`), the same on each retry of it. */
      idempotencyKey?: string
    ): Promise<ApiItem | null> => {
      const requestKey = createRequestKey(`/api/wishlists/${wishlistId}/items`, 'POST', newItem);

      try {
        const data = await deduplicateRequest(requestKey, () =>
          withRequestTimeout(async (signal) => {
            const response = await fetch(`/api/wishlists/${wishlistId}/items`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(idempotencyKey ? { [IDEMPOTENCY_HEADER]: idempotencyKey } : {}),
              },
              body: JSON.stringify(newItem),
              signal,
            });

            const result: ApiResponse<ApiItem> = await response.json();

            if (!result.success) {
              throw new Error(result.error || 'Failed to create item');
            }

            return result.data!;
          })
        );

        onSuccess?.(data);
        return data;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to create item';
        onError?.(errorMessage);
        console.error('Error creating item:', error);
        return null;
      }
    },
    [onSuccess, onError]
  );
}

/**
 * Hook for deleting an item
 */
export function useDeleteItem(onSuccess?: () => void, onError?: (error: string) => void) {
  return useCallback(
    async (id: string): Promise<boolean> => {
      const requestKey = createRequestKey(`/api/items/${id}`, 'DELETE');

      try {
        await deduplicateRequest(requestKey, () =>
          withRequestTimeout(async (signal) => {
            const response = await fetch(`/api/items/${id}`, {
              method: 'DELETE',
              signal,
            });

            // Already gone: a retry whose first attempt went through (its
            // answer lost), or a co-owner's delete. Either way the item the
            // page meant to delete no longer exists, which is what it asked.
            if (response.status === 404) return;

            const result: ApiResponse<void> = await response.json();

            if (!result.success) {
              throw new Error(result.error || 'Failed to delete item');
            }
          })
        );

        onSuccess?.();
        return true;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to delete item';
        onError?.(errorMessage);
        console.error('Error deleting item:', error);
        return false;
      }
    },
    [onSuccess, onError]
  );
}

/** A read of a wishlist's items, and when the request that read them was sent. */
export interface ItemsRead {
  items: ApiItem[];
  /** What the caller's `stamp` returned as the request was sent. */
  sentAt: number;
}

/**
 * Hook for fetching items. Rejects when the read fails (network error, a non-2xx
 * or unparseable response, `success: false`), so the caller keeps the list it
 * already has: a resolved `[]` only ever means the list really is empty. The
 * route's own 401/403/404 (the list is missing, or hidden from the viewer)
 * rejects with a `ReadRefusedError`, so a poll knows to stop: asking again
 * would get the same answer.
 *
 * Concurrent reads of a list share one request, so a caller that asks while
 * one is in flight gets that request's items, which may predate a change made
 * since it was sent. `stamp` (e.g. the page's `mutations.stamp`) is called as
 * the shared request goes out, and everyone who joined it resolves with that
 * same `sentAt`, so each can tell how old its items really are.
 *
 * A read that hasn't answered within `ITEM_REQUEST_TIMEOUT_MS` is aborted and
 * rejects with a `RequestTimeoutError`, a plain failure (not a refusal): a poll
 * keeps its list and a first load shows `LoadError`. The timeout sits inside
 * the shared request, so everyone who joined it is released together and the
 * dedup entry goes with it: the next read sends a fresh request instead of
 * joining the abandoned one.
 */
export function useFetchItems() {
  return useCallback(async (wishlistId: string, stamp: () => number): Promise<ItemsRead> => {
    const requestKey = createRequestKey(`/api/wishlists/${wishlistId}/items`, 'GET');

    return deduplicateRequest(requestKey, () =>
      withRequestTimeout(async (signal) => {
        const sentAt = stamp();
        const response = await fetch(`/api/wishlists/${wishlistId}/items`, {
          cache: 'no-store',
          signal,
        });
        const result: ApiResponse<ApiItem[]> = await response.json();

        // The list is missing, or hidden from the viewer now: a later read would
        // be refused the same way.
        if (isRefusal(response.status, result)) {
          throw new ReadRefusedError(result.error || 'Failed to fetch items');
        }
        if (!response.ok || !result.success || !Array.isArray(result.data)) {
          throw new Error(result.error || 'Failed to fetch items');
        }

        return { items: result.data, sentAt };
      })
    );
  }, []);
}
