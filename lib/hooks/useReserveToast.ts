'use client';

import { track } from '@/lib/analytics';
import { useCallback } from 'react';
import { useToast } from '@/components/ToastProvider';
import { RESERVE_VIEW_LABEL, RESERVED_PATH, takeReserveToastCopy } from '@/lib/utils/reserveToast';

/**
 * Wraps an item update so a member's successful reserve says what it means and
 * where it lives (WIS-260). A failed update resolves null (it has toasted its
 * own error) and gets no success toast. Owners can't reserve, and the toast
 * names no one who did.
 *
 * `ownerUsernames` is empty when the list has several owners or none we can
 * name, which reads "the owners".
 */
export function useReserveToast<T>(
  update: (id: string, updates: { status?: string }) => Promise<T | null>,
  { isOwner, ownerUsernames }: { isOwner: boolean; ownerUsernames: readonly string[] }
) {
  const { showToast } = useToast();
  return useCallback(
    async (id: string, updates: { status?: string }) => {
      const result = await update(id, updates);
      // A failed or rolled-back update resolves null: no toast, nothing
      // counted. Owners never reserve, and nothing an owner does is counted
      // as a reservation (WIS-329).
      if (!result || isOwner) return result;
      if (updates.status === 'available') track('release', { from: 'list' });
      if (updates.status === 'booked') {
        track('reserve');
        showToast(takeReserveToastCopy(ownerUsernames), 'success', {
          action: { label: RESERVE_VIEW_LABEL, href: RESERVED_PATH },
        });
      }
      return result;
    },
    [update, isOwner, ownerUsernames, showToast]
  );
}
