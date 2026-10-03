'use client';

import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useToast } from '@/components/ToastProvider';
import { withPin } from '@/lib/utils/pinnedLists';
import { withRequestTimeout } from '@/lib/utils/requestTimeout';

const PIN_ERROR = 'Failed to update the pin';

/** What a list needs to be pinned or unpinned. */
interface PinnableList {
  _id: { toString(): string };
  featured?: boolean;
}

/**
 * Pin to top on a page of the caller's own lists (`lib/utils/pinnedLists.ts`):
 * `toggle(list)` pins it, or unpins it if it's pinned, through
 * `PATCH /api/wishlists/[id]` (`{ featured }`), and once that lands updates the
 * page's copy of its lists (`setLists`) as the server has them: one pinned at a
 * time, so pinning a list unpins the other.
 *
 * One pin is in flight at a time (`pinning`, the list's id, holds every list's
 * pin button), since each one can change the others. A second toggle while one
 * is in flight is ignored, synchronously, so a double click sends one request.
 * Bounded by `withRequestTimeout`, so one that stalls lets the buttons go.
 */
export function usePinToTop<T extends PinnableList>(setLists: Dispatch<SetStateAction<T[]>>) {
  const { showToast } = useToast();
  const [pinning, setPinning] = useState<string | null>(null);
  const inFlight = useRef(false);

  const toggle = useCallback(
    async (list: T) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const id = list._id.toString();
      const pin = !list.featured;
      setPinning(id);
      try {
        const result = await withRequestTimeout(async (signal) => {
          const res = await fetch(`/api/wishlists/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ featured: pin }),
            signal,
          });
          return res.json();
        });
        if (result.success) {
          setLists((prev) => withPin(prev, id, pin));
          showToast(pin ? 'Pinned to the top' : 'Unpinned', 'success');
        } else {
          showToast(result.error || PIN_ERROR, 'error');
        }
      } catch {
        showToast(PIN_ERROR, 'error');
      } finally {
        inFlight.current = false;
        setPinning(null);
      }
    },
    [setLists, showToast]
  );

  return { pinning, toggle };
}
