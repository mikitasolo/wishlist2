import { useCallback } from 'react';
import type { ApiItem, ApiResponse } from '@/types/api';
import { withRequestTimeout } from '@/lib/utils/requestTimeout';
import { IDEMPOTENCY_HEADER } from '@/lib/utils/submissionKey';
import { groupGiftRequest, type GroupGiftAction } from '@/lib/utils/groupGiftClient';

/**
 * Sends one group gift action (WIS-362) and resolves with the item as the
 * server now shows it to this member, or `null` after `onError` has been told
 * why (a refusal's own message, or the timeout's). Given up on after
 * `ITEM_REQUEST_TIMEOUT_MS` like every item request; a retry of an abandoned
 * start or end sends the same `idempotencyKey`, so the server answers it as
 * the first attempt did.
 */
export function useGroupGiftRequest(onError: (message: string) => void) {
  return useCallback(
    async (
      itemId: string,
      action: GroupGiftAction,
      idempotencyKey?: string,
      /** Sent as the page goes away (a deferred leave or cancel, WIS-387). */
      keepalive = false
    ): Promise<ApiItem | null> => {
      const { method, url, body, idempotent } = groupGiftRequest(itemId, action);
      try {
        return await withRequestTimeout(async (signal) => {
          const response = await fetch(url, {
            method,
            headers: {
              ...(body !== undefined && { 'Content-Type': 'application/json' }),
              ...(idempotent && idempotencyKey && { [IDEMPOTENCY_HEADER]: idempotencyKey }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal,
            keepalive,
          });
          const result: ApiResponse<ApiItem> = await response.json();
          if (!result.success || !result.data) {
            throw new Error(result.error || 'Something went wrong with the group gift');
          }
          return result.data;
        });
      } catch (error) {
        onError(
          error instanceof Error ? error.message : 'Something went wrong with the group gift'
        );
        console.error('Error with group gift:', error);
        return null;
      }
    },
    [onError]
  );
}
