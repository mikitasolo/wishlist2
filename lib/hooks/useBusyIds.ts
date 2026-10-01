'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Tracks which cards in a list have an action in flight, so each card's buttons
 * stay disabled until its own request settles (the Invitations and Booked
 * pages).
 *
 * - `run(id, fn)` marks `id` busy, runs `fn`, and frees `id` once `fn` settles,
 *   whether it resolves or throws (the rejection still reaches the caller). A
 *   call for an id that's already in flight is ignored: `fn` doesn't run. The
 *   check is synchronous, so it holds even for a call that lands before the
 *   card re-renders as disabled, or that doesn't come from the card's buttons
 *   at all (a confirmation dialog's).
 * - `busy(id)` says whether `id` is in flight, for rendering.
 *
 * Tracked per id, not as one id for the page: acting on another card doesn't
 * re-enable this one, and that action settling first doesn't unlock this one
 * while its own request is pending. A set is enough, with no per-id count:
 * because a second call is ignored, an id has at most one request holding it,
 * and only that request frees it.
 */
export function useBusyIds() {
  // The source of truth, read and written synchronously by `run`. The state is
  // a copy of it for rendering, replaced on every change, so changes landing in
  // any order never write back a stale set.
  const inFlight = useRef<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());

  const run = useCallback(async (id: string, fn: () => Promise<unknown>): Promise<void> => {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setBusyIds(new Set(inFlight.current));
    try {
      await fn();
    } finally {
      inFlight.current.delete(id);
      setBusyIds(new Set(inFlight.current));
    }
  }, []);

  const busy = useCallback((id: string) => busyIds.has(id), [busyIds]);

  return { busy, run };
}
