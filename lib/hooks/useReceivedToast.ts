'use client';

import { useCallback } from 'react';
import { useToast } from '@/components/ToastProvider';

/**
 * Wraps an item update so an owner's successful "Mark as received" says so and
 * offers Undo (WIS-261). Undo is a plain reopen (status available) through the
 * same update: it doesn't bring back a booking the change cleared (WIS-108),
 * and the copy says nothing about whether the item was reserved. A failed
 * update resolves null (it has toasted its own error) and gets no toast.
 */
export function useReceivedToast<T>(
  update: (id: string, updates: { status?: string }) => Promise<T | null>
) {
  const { showToast } = useToast();
  return useCallback(
    async (id: string, updates: { status?: string }) => {
      const result = await update(id, updates);
      if (result && updates.status === 'completed') {
        showToast('Marked as received', 'success', {
          action: {
            label: 'Undo',
            onClick: () => {
              void update(id, { status: 'available' });
            },
          },
        });
      }
      return result;
    },
    [update, showToast]
  );
}
