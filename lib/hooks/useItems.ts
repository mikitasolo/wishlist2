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
 * delete sent with `notFoundIsDone` counts a 404 as done.
 */

import { useCallback } from 'react';
import { ApiItem, ApiResponse } from '@/types/api';
import { deduplicateRequest, createRequestKey } from '@/lib/utils/requestDeduplication';
import { withRequestTimeout } from '@/lib/utils/requestTimeout';
import { IDEMPOTENCY_HEADER } from '@/lib/utils/submissionKey';
import { isRefusal, ReadRefusedError } from '@/lib/utils/resourceRead';
import {
  EXPECTED_PROPOSAL,
  EXPECTED_STATUS_PARAM,
  EXPECTED_VERSION_PARAM,
  PROPOSAL_EDITED_ERROR,
} from '@/lib/utils/proposalReview';

/**
 * Sent by the review dialog's approve and Decline (WIS-199): the request
 * expects the item to still be a proposal, and the route answers 409 when it
 * isn't one any more (`lib/utils/proposalReview.ts`).
 */
export interface ReviewRequestOptions {
  expectProposal?: boolean;
  /**
   * An approve's version of the proposal it shows (its `updatedAt`, WIS-320):
   * an edit landing since is answered 409 with the proposal as it is now.
   */
  expectedVersion?: string;
}

/** What `onError` is told besides the message. */
export interface ItemRequestFailure {
  /** A review request (`expectProposal`) refused because the item is no longer a proposal. */
  proposalReviewed: boolean;
  /**
   * An approve refused because the proposal was edited since its dialog was
   * filled: the proposal as it is now, for the dialog to refill from.
   */
  editedProposal?: ApiItem;
}

/** A failed item request, with its HTTP status when the server answered. */
class ItemRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data?: ApiItem
  ) {
    super(message);
  }
}

const failureOf = (error: unknown, expectProposal: boolean): ItemRequestFailure => {
  const conflict = expectProposal && error instanceof ItemRequestError && error.status === 409;
  const edited = conflict && error.message === PROPOSAL_EDITED_ERROR && error.data;
  return edited
    ? { proposalReviewed: false, editedProposal: error.data }
    : { proposalReviewed: conflict };
};

/**
 * Hook for updating an item
 */
export function useUpdateItem(
  onSuccess?: (updatedItem: ApiItem) => void,
  onError?: (error: string, failure: ItemRequestFailure) => void
) {
  return useCallback(
    async (
      id: string,
      updates: Partial<ApiItem>,
      { expectProposal = false, expectedVersion }: ReviewRequestOptions = {}
    ): Promise<ApiItem | null> => {
      const body = expectProposal
        ? {
            ...updates,
            [EXPECTED_STATUS_PARAM]: EXPECTED_PROPOSAL,
            ...(expectedVersion && { [EXPECTED_VERSION_PARAM]: expectedVersion }),
          }
        : updates;
      const requestKey = createRequestKey(`/api/items/${id}`, 'PATCH', body);

      try {
        const data = await deduplicateRequest(requestKey, () =>
          withRequestTimeout(async (signal) => {
            const response = await fetch(`/api/items/${id}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
              signal,
            });

            const result: ApiResponse<ApiItem> = await response.json();

            if (!result.success) {
              throw new ItemRequestError(
                result.error || 'Failed to update item',
                response.status,
                result.data
              );
            }

            return result.data!;
          })
        );

        onSuccess?.(data);
        return data;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to update item';
        onError?.(errorMessage, failureOf(error, expectProposal));
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
export function useDeleteItem(
  onSuccess?: () => void,
  onError?: (error: string, failure: ItemRequestFailure) => void
) {
  return useCallback(
    async (
      id: string,
      {
        notFoundIsDone = false,
        expectProposal = false,
      }: ReviewRequestOptions & {
        /**
         * Count a 404 as already deleted (WIS-158): a retry whose first attempt
         * went through, or a co-owner's delete. Only for an owner: the route
         * also answers a non-owner 404 on an archived list, where the item
         * still exists, and that refusal must stay one.
         */
        notFoundIsDone?: boolean;
      } = {}
    ): Promise<boolean> => {
      const url = expectProposal
        ? `/api/items/${id}?${EXPECTED_STATUS_PARAM}=${EXPECTED_PROPOSAL}`
        : `/api/items/${id}`;
      const requestKey = createRequestKey(url, 'DELETE');

      try {
        await deduplicateRequest(requestKey, () =>
          withRequestTimeout(async (signal) => {
            const response = await fetch(url, {
              method: 'DELETE',
              signal,
            });

            if (notFoundIsDone && response.status === 404) return;

            const result: ApiResponse<void> = await response.json();

            if (!result.success) {
              throw new ItemRequestError(result.error || 'Failed to delete item', response.status);
            }
          })
        );

        onSuccess?.();
        return true;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to delete item';
        onError?.(errorMessage, failureOf(error, expectProposal));
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
