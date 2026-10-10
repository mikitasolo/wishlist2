/**
 * Deferred commits (WIS-387): the request behind a destructive action goes
 * out only once its Undo window has passed. The UI takes the thing away at
 * once and puts it back on Undo, and since nothing was sent, nothing has to be
 * reversed: no notification went out, no reservation was released, no blob
 * was freed. That's why it's the default for every undoable action, rather
 * than committing at once and writing the reverse on Undo.
 *
 * A pending commit is sent:
 * - when its window ends (`UNDO_WINDOW_MS`),
 * - when it's flushed (its toast dismissed, or the page going away: see
 *   `flushAll`, which the `useUndoableAction` hook calls on `pagehide` and when
 *   the tab is hidden, with `keepalive` so the request outlives the page),
 * and never once undone. Each is sent at most once, whichever comes first.
 *
 * Framework-free, so the bulk delete (WIS-386) and the tests can use it as is.
 */

/** How long an Undo is offered before the request goes out. */
export const UNDO_WINDOW_MS = 5000;

/** The label of every Undo toast's button. */
export const UNDO_LABEL = 'Undo';

export type DeferredOutcome = 'committed' | 'undone';

export interface CommitContext {
  /**
   * True when the page is going away: send the request with
   * `fetch(…, { keepalive: true })` so the browser doesn't cancel it with the
   * page. Nothing that follows the answer will run then, so don't rely on it.
   */
  keepalive: boolean;
}

export interface DeferredAction {
  /**
   * Send the request. Its own failures are its to handle (put the thing back,
   * toast): a rejection is swallowed here, so the queue can't leak one.
   */
  commit: (context: CommitContext) => unknown;
  /** Put back what the action took away. Runs only if nothing was sent. */
  onUndo?: () => void;
}

export interface PendingCommit {
  /**
   * Cancel the request and run `onUndo`. True if it was cancelled; false if
   * it had already gone out (or been undone), in which case nothing changes.
   */
  undo(): boolean;
  /** Send it now, if it's still pending. */
  flush(keepalive?: boolean): void;
  /** Whether it's still waiting: neither sent nor undone. */
  isPending(): boolean;
  /**
   * Settles once it's undone, or once its commit has settled (resolved or
   * rejected). Never rejects. Hold a page's read guard on it (e.g.
   * `mutations.track(() => pending.settled)`) so a poll can't bring the thing
   * back while its delete waits.
   */
  readonly settled: Promise<DeferredOutcome>;
}

export interface DeferredQueue {
  defer(action: DeferredAction, delayMs?: number): PendingCommit;
  /** Send every pending commit now (the page is going away). */
  flushAll(keepalive?: boolean): void;
  /** How many commits are waiting. */
  size(): number;
}

interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createDeferredQueue(timers: Timers = defaultTimers): DeferredQueue {
  const pending = new Set<PendingCommit>();

  function defer(action: DeferredAction, delayMs: number = UNDO_WINDOW_MS): PendingCommit {
    let state: 'pending' | 'committed' | 'undone' = 'pending';
    let resolveSettled!: (outcome: DeferredOutcome) => void;
    const settled = new Promise<DeferredOutcome>((resolve) => {
      resolveSettled = resolve;
    });

    const commitNow = (keepalive: boolean) => {
      if (state !== 'pending') return;
      state = 'committed';
      timers.clear(timer);
      pending.delete(handle);
      let result: unknown;
      try {
        result = action.commit({ keepalive });
      } catch {
        resolveSettled('committed');
        return;
      }
      Promise.resolve(result).then(
        () => resolveSettled('committed'),
        () => resolveSettled('committed')
      );
    };

    const handle: PendingCommit = {
      undo() {
        if (state !== 'pending') return false;
        state = 'undone';
        timers.clear(timer);
        pending.delete(handle);
        try {
          action.onUndo?.();
        } finally {
          resolveSettled('undone');
        }
        return true;
      },
      flush(keepalive = false) {
        commitNow(keepalive);
      },
      isPending: () => state === 'pending',
      settled,
    };

    const timer = timers.set(() => commitNow(false), delayMs);
    pending.add(handle);
    return handle;
  }

  return {
    defer,
    flushAll(keepalive = false) {
      for (const handle of [...pending]) handle.flush(keepalive);
    },
    size: () => pending.size,
  };
}

/**
 * `items` with `item` put back where it was (`index`, or the end if the list
 * has shrunk since), for an Undo that restores what the action took off a
 * list. Unchanged if it's there already (a read brought it back).
 */
export function restoreRemoved<T>(
  items: T[],
  item: T,
  index: number,
  /** How a list entry is told apart (`_id` by default). */
  idOf: (entry: T) => string = (entry) => (entry as { _id: string })._id
): T[] {
  if (items.some((i) => idOf(i) === idOf(item))) return items;
  const at = Math.max(0, Math.min(index, items.length));
  return [...items.slice(0, at), item, ...items.slice(at)];
}
