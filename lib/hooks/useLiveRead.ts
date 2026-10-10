'use client';

/**
 * The shared client read layer (WIS-376; screens.md, "Data loading &
 * mutations"): a screen's read that stays live without fighting the screen's
 * own optimistic writes.
 *
 * - `useRefreshOnReturn`: read again when the viewer comes back (the window
 *   focused, or the tab shown or the network back in a focused window), one
 *   read per return.
 * - `usePolling`: a background read every few seconds, only while the tab is
 *   visible (the timer is stopped while it's hidden, not just skipped).
 * - `sharedRead`: concurrent reads of one key share one request, stamped as it
 *   goes out, so everyone who joined it can tell how old its answer is.
 * - `useLiveRead`: the read's state on top of those: a failed first read is
 *   `failed`, never an empty `data`; a later failure keeps what's shown; a read
 *   that is stale against the screen's mutations (`createMutationTracker`)
 *   while data is shown, or older than one already shown, is dropped.
 *
 * Deliberately no cache of answers across mounts: what a read answers depends
 * on who asks and in what role (a member's view of a list carries
 * reservations, an owner's never does), so an answer kept for one view and
 * shown in another, even briefly before a re-read, could leak. Only requests in
 * flight are shared. Within a mount, a new `read` (another list, Preview as
 * visitor) starts over from nothing shown, and an answer to the read it
 * replaced is dropped.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { createMutationTracker, type MutationTracker } from '@/lib/utils/mutationTracker';
import { deduplicateRequest } from '@/lib/utils/requestDeduplication';

/** How often a polled screen reads again while it's visible. */
export const POLL_INTERVAL_MS = 5000;

/**
 * Coming back to a tab fires both `visibilitychange` and `focus`: the second
 * of the pair, within this long of the first, is the same return.
 */
export const RETURN_PAIR_MS = 1000;

const isVisible = () => document.visibilityState === 'visible';

export interface RefreshOnReturnOptions {
  /** Listen at all (default true). */
  enabled?: boolean;
  /**
   * Only after being away: a return counts only once the tab has been hidden
   * or the browser offline since the last one (a polled screen, already at
   * most one interval old while it was on screen).
   */
  onlyAfterAway?: boolean;
}

/**
 * Calls `refresh` when the viewer comes back to the screen: the window
 * focused, the tab shown again in a focused window, or the browser back
 * online in a focused window. A tab shown in a window the viewer isn't in (an
 * uncovered window on another screen) waits for the focus that brings them
 * back, so a read with side effects (Activity marks its rows read) only runs
 * for someone actually looking. A return that fires both `visibilitychange`
 * and `focus` calls it once. Never while hidden. `refresh` may change between
 * renders without re-subscribing.
 */
export function useRefreshOnReturn(
  refresh: () => void,
  { enabled = true, onlyAfterAway = false }: RefreshOnReturnOptions = {}
): void {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    // The other half of the last return, still to come: it's skipped once.
    let awaiting: { event: 'focus' | 'visible'; at: number } | null = null;
    // Hidden or offline since the last return (see `onlyAfterAway`).
    let away = false;
    const fire = () => {
      if (onlyAfterAway && !away) return;
      away = false;
      latest.current();
    };
    const onReturn = (event: 'focus' | 'visible') => {
      if (!isVisible()) return;
      const now = Date.now();
      if (awaiting?.event === event && now - awaiting.at < RETURN_PAIR_MS) {
        awaiting = null;
        return;
      }
      awaiting = { event: event === 'focus' ? 'visible' : 'focus', at: now };
      fire();
    };
    const onFocus = () => onReturn('focus');
    const onVisibilityChange = () => {
      if (!isVisible()) {
        awaiting = null;
        away = true;
      } else if (document.hasFocus()) {
        onReturn('visible');
      }
    };
    const onOnline = () => {
      if (isVisible() && document.hasFocus()) fire();
    };
    const onOffline = () => {
      away = true;
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, onlyAfterAway]);
}

/**
 * Calls `tick` every `intervalMs` while `enabled` and the tab is visible. The
 * timer stops while the tab is hidden and starts over when it's shown again
 * (pair it with `useRefreshOnReturn` for a read on the return itself). `tick`
 * may change between renders without restarting the timer.
 */
export function usePolling(tick: () => void, intervalMs: number, enabled = true): void {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  }, [tick]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      // Checked on every tick too: a visibility change that wasn't announced
      // still skips the read.
      if (timer === null) {
        timer = setInterval(() => {
          if (isVisible()) latest.current();
        }, intervalMs);
      }
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const onVisibilityChange = () => (isVisible() ? start() : stop());
    if (isVisible()) start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, intervalMs]);
}

/** A read's answer, and the stamp its request was sent with. */
export interface StampedRead<T> {
  data: T;
  sentAt: number;
}

/**
 * Sends `send`'s request, or joins the one already in flight for `key`.
 * `stamp` is called as a request actually goes out, and everyone who joined
 * that request resolves (or rejects) with its answer and that same `sentAt`.
 * Put everything that changes the answer (the viewer's share token aside, which
 * the same viewer always sends alike) in `key`.
 */
export function sharedRead<T>(
  key: string,
  stamp: () => number,
  send: () => Promise<T>
): Promise<StampedRead<T>> {
  return deduplicateRequest(key, async () => {
    const sentAt = stamp();
    return { data: await send(), sentAt };
  });
}

/** What a failed read's `onError` is told besides the error. */
export interface LiveReadFailure {
  /** A background read (poll, return, reconcile), not one the screen shows a skeleton for. */
  silent: boolean;
  /** Whether data had been shown before it: then it stays on screen. */
  shown: boolean;
}

export interface LiveReadOptions<T> {
  /**
   * Whether the screen reads at all. Turning true sends a first (non-silent)
   * read, then polls and reads on return; turning false stops both.
   */
  enabled: boolean;
  /** What `data` holds before any read has landed (see `loaded`). */
  initialData: T;
  /**
   * Reads the data: call `stamp` as the request goes out and resolve with its
   * answer and that stamp (`sharedRead` does both). Resolve `null` for an
   * answer that's neither data nor a failure, handled by the caller (e.g. the
   * list was refused). Rejecting is a failure. Keep it memoized: a new one
   * means new data (another list, another view), so the screen starts over
   * from nothing shown and reads again.
   */
  read: (stamp: () => number) => Promise<StampedRead<T> | null>;
  /** Poll every this many ms while visible; omitted, no polling. */
  pollMs?: number;
  /**
   * The screen's mutations: a read that lands while one is in flight, or was
   * sent before one settled, is stale: it's dropped and the data read again
   * once they've settled, unless nothing is shown yet (a first load). Each
   * optimistic write goes through `mutations.track`. Without one, the hook
   * keeps its own (only ordering reads).
   */
  mutations?: MutationTracker;
  /** A failed read, after the hook has kept or failed its state. Keep it memoized. */
  onError?: (error: unknown, failure: LiveReadFailure) => void;
}

export interface LiveRead<T> {
  /** The last read's data, with the screen's own optimistic changes. */
  data: T;
  /** For optimistic updates: pair each with `mutations.track`. */
  setData: Dispatch<SetStateAction<T>>;
  /** Whether a read has landed: until then `data` is `initialData`, not "empty". */
  loaded: boolean;
  /** The first read failed and nothing is shown: the screen's `LoadError`. */
  failed: boolean;
  /** A non-silent read is on its way. */
  loading: boolean;
  /** Reads again: silent for a background read that keeps the screen as is. */
  refresh: (silent?: boolean) => Promise<void>;
  /** The tracker every read is judged against. */
  mutations: MutationTracker;
}

/** What a screen shows, and which read it came from. */
interface ReadState<T> {
  /** The read in use: only its answers are written (see `useLiveRead`). */
  current: unknown;
  /** The read `data` came from (null: none yet). */
  from: unknown;
  data: T;
  loaded: boolean;
  failed: boolean;
}

/**
 * A screen's live read: the first read when `enabled` turns true, then a
 * background read every `pollMs` while visible and one on every return
 * (`usePolling`, `useRefreshOnReturn`). See the module comment for the rules.
 */
export function useLiveRead<T>({
  enabled,
  initialData,
  read,
  pollMs,
  mutations: given,
  onError,
}: LiveReadOptions<T>): LiveRead<T> {
  const [own] = useState(createMutationTracker);
  const mutations = given ?? own;
  // A new `read` (another list, another view) becomes `current` in the same
  // render, so every write below, which checks it's still the current read's,
  // drops an answer to the read it replaced however late it lands. What's
  // shown stays until the new read answers (a page moving to another list
  // keeps the last one until it has loaded); if that first answer is a
  // failure, the screen shows the failure, never the last read's data.
  const [state, setState] = useState<ReadState<T>>(() => ({
    current: read,
    from: null,
    data: initialData,
    loaded: false,
    failed: false,
  }));
  if (state.current !== read) setState((prev) => ({ ...prev, current: read }));
  const [loading, setLoading] = useState(enabled);
  // The read in use, for what a late answer does besides showing data (its
  // error report, a re-read): set before effects run, so never behind a read.
  const currentRead = useRef(read);
  useLayoutEffect(() => {
    currentRead.current = read;
  }, [read]);
  // The read whose data has been shown, and the stamp of the newest answer
  // shown for it: an older one landing later is dropped.
  const shownFor = useRef<unknown>(null);
  const landed = useRef(0);
  // The latest non-silent read: only it ends `loading`.
  const loadsSent = useRef(0);
  // What a failed first read leaves shown (the first value given).
  const initial = useRef(initialData);

  const setData = useCallback<Dispatch<SetStateAction<T>>>(
    (action) =>
      setState((prev) => ({
        ...prev,
        data: typeof action === 'function' ? (action as (data: T) => T)(prev.data) : action,
      })),
    []
  );

  const refresh = useCallback(
    async (silent = false) => {
      const loadNo = silent ? 0 : ++loadsSent.current;
      const superseded = () => currentRead.current !== read;
      const ownState = (update: (prev: ReadState<T>) => ReadState<T>) =>
        setState((prev) => (prev.current === read ? update(prev) : prev));
      if (!silent) {
        setLoading(true);
        // The skeleton again, not the failure, while this read is on its way.
        ownState((prev) => ({ ...prev, failed: false }));
      }
      try {
        const answer = await read(mutations.stamp);
        if (!answer || superseded()) return;
        const shown = shownFor.current === read;
        // Raced with a mutation: it may predate the screen's optimistic state.
        // Dropped, then read again once idle, unless nothing is shown yet (a
        // first load lands, so the screen isn't left empty).
        if (mutations.isStale(answer.sentAt)) {
          mutations.rereadWhenIdle();
          if (silent || shown) return;
        }
        if (shown && answer.sentAt < landed.current) return;
        shownFor.current = read;
        landed.current = answer.sentAt;
        ownState((prev) => ({
          ...prev,
          from: read,
          data: answer.data,
          loaded: true,
          failed: false,
        }));
      } catch (error) {
        if (superseded()) return;
        const shown = shownFor.current === read;
        // Until this read's data has been shown, the screen says the read
        // failed (not the last read's data, if any); after, what's shown stays.
        if (!silent && !shown) {
          ownState((prev) => ({
            ...prev,
            from: null,
            data: initial.current,
            loaded: false,
            failed: true,
          }));
        }
        onError?.(error, { silent, shown });
      } finally {
        if (loadNo && loadNo === loadsSent.current) setLoading(false);
      }
    },
    [read, mutations, onError]
  );

  const background = useCallback(() => void refresh(true), [refresh]);

  useEffect(() => {
    if (!enabled) return;
    // While this screen reads, a read that turns out stale is followed by a
    // background one (see `refresh`).
    mutations.setReread(background);
    void refresh();
    return () => {
      // A read still in flight from here mustn't send another.
      mutations.setReread(null);
      setLoading(false);
    };
  }, [enabled, refresh, background, mutations]);

  const polled = enabled && pollMs !== undefined;
  usePolling(background, pollMs ?? POLL_INTERVAL_MS, polled);
  // A polled screen is at most one interval old while it's on screen, so it
  // reads on a return only after being away (hidden or offline).
  useRefreshOnReturn(background, { enabled, onlyAfterAway: polled });

  return {
    data: state.data,
    setData,
    loaded: state.loaded,
    failed: state.failed,
    loading,
    refresh,
    mutations,
  };
}
