'use client';

import { useCallback } from 'react';
import { useToast } from '@/components/ToastProvider';
import {
  createDeferredQueue,
  UNDO_LABEL,
  UNDO_WINDOW_MS,
  type DeferredAction,
  type PendingCommit,
} from '@/lib/utils/deferredCommit';

/**
 * The app's one queue of deferred commits, so leaving the page sends every
 * one of them, whichever screen deferred it. It outlives the component that
 * deferred a commit: moving to another page sends it on time, and its Undo
 * still works from the toast (nothing was sent, so the list read on coming
 * back shows the thing as it was).
 */
const queue = createDeferredQueue();
let listening = false;

/**
 * Sends what's waiting when the page goes away: `pagehide` (closed, reloaded,
 * navigated off the app) and the tab being hidden, the last moment a phone
 * browser reliably gives before it may discard the tab without a `pagehide`.
 * With `keepalive`, so the browser doesn't cancel the request with the page.
 */
function listenForPageExit() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('pagehide', () => queue.flushAll(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') queue.flushAll(true);
  });
}

/** For tests: send everything waiting, as leaving the page would. */
export function flushUndoableActions(keepalive = false) {
  queue.flushAll(keepalive);
}

export interface UndoableAction extends DeferredAction {
  /** The toast's line, said as done ("Item deleted"). */
  message: string;
}

/**
 * Offers Undo after a destructive action (WIS-387). The caller has already
 * taken the thing off the screen; this shows a toast saying it's done, with
 * Undo, and sends `commit` once `UNDO_WINDOW_MS` has passed, or sooner when
 * the toast is dismissed or the page goes away. Undo cancels it and runs
 * `onUndo`, so nothing was ever sent: no notification, released reservation
 * or freed upload to take back. See `lib/utils/deferredCommit.ts`.
 *
 * Returns the pending commit: hold a read guard on its `settled` so a
 * background read can't bring the thing back meanwhile.
 */
export function useUndoableAction() {
  const { showToast, dismissToast } = useToast();
  return useCallback(
    ({ message, commit, onUndo }: UndoableAction): PendingCommit => {
      listenForPageExit();
      let toastId: string | undefined;
      const pending = queue.defer({
        commit: (context) => {
          // Sent: Undo no longer stands for anything.
          if (toastId) dismissToast?.(toastId);
          return commit(context);
        },
        onUndo,
      });
      toastId = showToast(message, 'success', {
        action: { label: UNDO_LABEL, onClick: () => pending.undo() },
        duration: UNDO_WINDOW_MS,
        onDismiss: () => pending.flush(),
      });
      // Undone some other way than its button (e.g. Reserve tapped again
      // during a Release's window): the toast goes too, so it can't go on
      // saying it's done.
      return {
        ...pending,
        undo: () => {
          const undone = pending.undo();
          if (undone && toastId) dismissToast?.(toastId);
          return undone;
        },
      };
    },
    [showToast, dismissToast]
  );
}
