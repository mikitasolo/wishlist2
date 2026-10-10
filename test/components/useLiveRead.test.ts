// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
  POLL_INTERVAL_MS,
  RETURN_PAIR_MS,
  sharedRead,
  useLiveRead,
  useRefreshOnReturn,
  type LiveReadOptions,
  type StampedRead,
} from '@/lib/hooks/useLiveRead';
import { createMutationTracker } from '@/lib/utils/mutationTracker';
import { clearPendingRequests } from '@/lib/utils/requestDeduplication';

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function fire(event: 'focus' | 'online') {
  act(() => {
    window.dispatchEvent(new Event(event));
  });
}

/** Lets resolved reads land. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Read = LiveReadOptions<string[]>['read'];

/** A read answering from `answers` in turn (the last one again once they run out). */
function reads(...answers: (string[] | Error | Promise<string[]>)[]) {
  let call = 0;
  return vi.fn<Read>(async (stamp) => {
    const sentAt = stamp();
    const answer = answers[Math.min(call++, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return { data: await answer, sentAt };
  });
}

function setup(options: Partial<LiveReadOptions<string[]>> & { read: Read }) {
  return renderHook((props: LiveReadOptions<string[]>) => useLiveRead(props), {
    initialProps: { enabled: true, initialData: [], pollMs: POLL_INTERVAL_MS, ...options },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  clearPendingRequests();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useLiveRead', () => {
  it('reads once enabled, then every interval while the tab is visible', async () => {
    const read = reads(['a']);
    const { result, rerender } = setup({ read, enabled: false });
    expect(read).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);

    rerender({ enabled: true, initialData: [], pollMs: POLL_INTERVAL_MS, read });
    expect(result.current.loading).toBe(true);
    await settle();
    expect(result.current).toMatchObject({ data: ['a'], loaded: true, loading: false });
    expect(read).toHaveBeenCalledTimes(1);

    await advance(POLL_INTERVAL_MS);
    expect(read).toHaveBeenCalledTimes(2);
    await advance(POLL_INTERVAL_MS);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('stops polling while the tab is hidden, and reads at once when it is shown again', async () => {
    const read = reads(['a']);
    setup({ read });
    await settle();
    expect(read).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    await advance(POLL_INTERVAL_MS * 6);
    expect(read).toHaveBeenCalledTimes(1);

    // Shown again: one read for the return, then the poll starts over.
    setVisibility('visible');
    expect(read).toHaveBeenCalledTimes(2);
    await advance(POLL_INTERVAL_MS - 1);
    expect(read).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('reads on focus and when the browser is back online', async () => {
    const read = reads(['a'], ['b'], ['c']);
    const { result } = setup({ read, pollMs: undefined });
    await settle();

    fire('focus');
    await settle();
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual(['b']);

    fire('online');
    await settle();
    expect(read).toHaveBeenCalledTimes(3);
    expect(result.current.data).toEqual(['c']);

    // Without a poll interval, time alone reads nothing.
    await advance(POLL_INTERVAL_MS * 3);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('shows a failed first read as failed, never as empty data, and a retry reads it', async () => {
    const onError = vi.fn();
    const read = reads(new Error('boom'), ['a']);
    const { result } = setup({ read, onError });
    await settle();

    expect(result.current).toMatchObject({ loaded: false, failed: true, loading: false, data: [] });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { silent: false, shown: false });

    await act(() => result.current.refresh());
    expect(result.current).toMatchObject({ loaded: true, failed: false, data: ['a'] });
  });

  it('keeps the data shown when a later read fails, silent or not', async () => {
    const onError = vi.fn();
    const read = reads(['a'], new Error('poll failed'), new Error('reload failed'));
    const { result } = setup({ read, onError });
    await settle();

    await advance(POLL_INTERVAL_MS);
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ data: ['a'], loaded: true, failed: false });
    expect(onError).toHaveBeenLastCalledWith(expect.any(Error), { silent: true, shown: true });

    await act(() => result.current.refresh());
    expect(result.current).toMatchObject({ data: ['a'], loaded: true, failed: false });
    expect(onError).toHaveBeenLastCalledWith(expect.any(Error), { silent: false, shown: true });
  });

  it('keeps an optimistic change over a poll that lands while its mutation is in flight', async () => {
    const mutations = createMutationTracker();
    const read = reads(['a'], ['a'], ['a', 'b']);
    const { result } = setup({ read, mutations });
    await settle();

    // The optimistic add, with its request still on its way.
    const request = deferred<void>();
    let tracked!: Promise<void>;
    act(() => {
      result.current.setData((prev) => [...prev, 'b']);
      tracked = mutations.track(() => request.promise);
    });

    // A poll answering with the data from before the add: dropped.
    await advance(POLL_INTERVAL_MS);
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual(['a', 'b']);

    // The add lands; the data is read again once idle, and that read is kept.
    await act(async () => {
      request.resolve();
      await tracked;
    });
    await settle();
    expect(read).toHaveBeenCalledTimes(3);
    expect(result.current.data).toEqual(['a', 'b']);
  });

  it('drops a read that lands after a newer one was shown', async () => {
    const slow = deferred<string[]>();
    const read = reads(['first'], slow.promise, ['newest']);
    const { result } = setup({ read, pollMs: undefined });
    await settle();

    // A slow background read, then a newer one that lands first.
    fire('online');
    fire('online');
    await settle();
    expect(result.current.data).toEqual(['newest']);

    slow.resolve(['older']);
    await settle();
    expect(result.current.data).toEqual(['newest']);
  });

  it('drops an answer to the read it replaced, which neither shows data nor ends loading', async () => {
    const old = deferred<string[]>();
    const next = deferred<string[]>();
    const readOld = reads(old.promise);
    const readNext = reads(next.promise);
    const { result, rerender } = setup({ read: readOld });
    expect(result.current.loading).toBe(true);

    // Another list, or Preview as visitor: a new read, sent at once.
    rerender({ enabled: true, initialData: [], pollMs: POLL_INTERVAL_MS, read: readNext });
    expect(readNext).toHaveBeenCalledTimes(1);

    old.resolve(['old view']);
    await settle();
    expect(result.current).toMatchObject({ data: [], loaded: false, loading: true });

    next.resolve(['new view']);
    await settle();
    expect(result.current).toMatchObject({ data: ['new view'], loaded: true, loading: false });
  });

  // regression (review of WIS-376): a client navigation to another list kept
  // the last list's items, so the new list's failed first read showed them
  // with a toast instead of LoadError.
  it("shows a new read's failed first answer as failed, never the last read's data", async () => {
    const onError = vi.fn();
    const readA = reads(['a']);
    const { result, rerender } = setup({ read: readA, onError });
    await settle();
    expect(result.current).toMatchObject({ data: ['a'], loaded: true });

    // Another list: the last one stays on screen until the new read answers.
    const readB = reads(new Error('boom'));
    rerender({ enabled: true, initialData: [], pollMs: POLL_INTERVAL_MS, read: readB, onError });
    expect(result.current).toMatchObject({ data: ['a'], loading: true });
    await settle();
    expect(result.current).toMatchObject({ data: [], loaded: false, failed: true });
    expect(onError).toHaveBeenLastCalledWith(expect.any(Error), { silent: false, shown: false });
  });

  it('keeps optimistic state over a non-silent read that is stale, once data is shown', async () => {
    const mutations = createMutationTracker();
    const read = reads(['a'], ['a'], ['a', 'b']);
    const { result } = setup({ read, mutations, pollMs: undefined });
    await settle();

    const request = deferred<void>();
    let tracked!: Promise<void>;
    act(() => {
      result.current.setData((prev) => [...prev, 'b']);
      tracked = mutations.track(() => request.promise);
    });
    // Try again, or coming back to the tab: not silent, but stale.
    await act(() => result.current.refresh());
    expect(result.current).toMatchObject({ data: ['a', 'b'], loading: false });

    await act(async () => {
      request.resolve();
      await tracked;
    });
    await settle();
    expect(read).toHaveBeenCalledTimes(3);
    expect(result.current.data).toEqual(['a', 'b']);
  });

  it('reads nothing once disabled, nor after unmounting', async () => {
    const read = reads(['a']);
    const { rerender, unmount } = setup({ read });
    await settle();

    rerender({ enabled: false, initialData: [], pollMs: POLL_INTERVAL_MS, read });
    await advance(POLL_INTERVAL_MS * 2);
    fire('focus');
    expect(read).toHaveBeenCalledTimes(1);

    rerender({ enabled: true, initialData: [], pollMs: POLL_INTERVAL_MS, read });
    expect(read).toHaveBeenCalledTimes(2);
    unmount();
    await advance(POLL_INTERVAL_MS * 2);
    fire('focus');
    expect(read).toHaveBeenCalledTimes(2);
  });

  // WIS-441: a read keyed on the signed-in account (Reserved, Activity, the
  // badges) never shows the previous account's data, not even for a frame.
  it('with resetOnNewRead, a new read clears what the last one showed in that render', async () => {
    const readA = reads(['account a']);
    const { result, rerender } = setup({ read: readA, resetOnNewRead: true });
    await settle();
    expect(result.current.data).toEqual(['account a']);

    const next = deferred<string[]>();
    const readB = reads(next.promise);
    rerender({
      enabled: true,
      initialData: [],
      pollMs: POLL_INTERVAL_MS,
      read: readB,
      resetOnNewRead: true,
    });
    expect(result.current).toMatchObject({ data: [], loaded: false, failed: false });

    next.resolve(['account b']);
    await settle();
    expect(result.current).toMatchObject({ data: ['account b'], loaded: true });
  });

  it('lands an answer through merge, into the data as shown, and drops one merge refuses', async () => {
    const merge = vi.fn(({ data }: StampedRead<string[]>) =>
      data.includes('outdated') ? null : (shown: string[]) => [...shown, ...data]
    );
    const read = reads(['a'], ['outdated'], ['b']);
    const { result } = setup({ read, merge, pollMs: undefined });
    await settle();
    expect(result.current.data).toEqual(['a']);

    // The screen's own change stays: the next answer is merged into it.
    act(() => result.current.setData((prev) => [...prev, 'mine']));
    await act(() => result.current.refresh(true));
    expect(result.current.data).toEqual(['a', 'mine']);
    await act(() => result.current.refresh(true));
    expect(result.current.data).toEqual(['a', 'mine', 'b']);
    // Once per answer, outside rendering.
    expect(merge).toHaveBeenCalledTimes(3);
  });

  // WIS-441: the invitations' own rule, now the shared one: a stale answer
  // asks for no re-read while a read sent since the mutations settled is on
  // its way, which decides.
  it('after a stale answer, reads again only if no fresh read is already on its way', async () => {
    const mutations = createMutationTracker();
    const stale = deferred<string[]>();
    const fresh = deferred<string[]>();
    const read = reads(['a'], stale.promise, fresh.promise, ['c']);
    const { result } = setup({ read, mutations, pollMs: undefined });
    await settle();

    // A read goes out, then a mutation settles, then another read goes out.
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.refresh(true);
    });
    await act(() => mutations.track(async () => {}));
    act(() => {
      second = result.current.refresh(true);
    });
    expect(read).toHaveBeenCalledTimes(3);

    await act(async () => {
      stale.resolve(['stale']);
      await first;
    });
    await settle();
    expect(result.current.data).toEqual(['a']);
    expect(read).toHaveBeenCalledTimes(3);

    await act(async () => {
      fresh.resolve(['b']);
      await second;
    });
    expect(result.current.data).toEqual(['b']);
    expect(read).toHaveBeenCalledTimes(3);
  });
});

describe('useRefreshOnReturn', () => {
  it('counts a return that fires both events once, in either order', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshOnReturn(refresh));

    setVisibility('visible');
    fire('focus');
    expect(refresh).toHaveBeenCalledTimes(1);

    fire('focus');
    setVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(2);

    // A later focus on its own (another window closed) is a return of its own.
    fire('focus');
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('treats a focus well after the tab was shown as a return of its own', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshOnReturn(refresh));

    setVisibility('visible');
    vi.advanceTimersByTime(RETURN_PAIR_MS);
    fire('focus');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  // regression (review of WIS-376): a tab made visible in a window the viewer
  // isn't in read the Activity feed, which marks every row read.
  it('ignores a tab shown or back online in a window the viewer is not in, until they focus it', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshOnReturn(refresh));
    vi.mocked(document.hasFocus).mockReturnValue(false);

    setVisibility('hidden');
    setVisibility('visible');
    fire('online');
    expect(refresh).not.toHaveBeenCalled();

    vi.mocked(document.hasFocus).mockReturnValue(true);
    fire('focus');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('with onlyAfterAway, counts a return only after the tab was hidden or offline', () => {
    const refresh = vi.fn();
    renderHook(() => useRefreshOnReturn(refresh, { onlyAfterAway: true }));

    // On screen all along (a file picker closed, an alt-tab): nothing.
    fire('focus');
    fire('online');
    expect(refresh).not.toHaveBeenCalled();

    setVisibility('hidden');
    setVisibility('visible');
    fire('focus');
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    fire('online');
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(RETURN_PAIR_MS);
    fire('focus');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does nothing while the tab is hidden, or while disabled', () => {
    const refresh = vi.fn();
    const { rerender } = renderHook(({ on }) => useRefreshOnReturn(refresh, { enabled: on }), {
      initialProps: { on: true },
    });

    setVisibility('hidden');
    fire('focus');
    fire('online');
    expect(refresh).not.toHaveBeenCalled();

    setVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(1);

    rerender({ on: false });
    vi.advanceTimersByTime(RETURN_PAIR_MS);
    fire('focus');
    fire('online');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('sharedRead', () => {
  it('shares one request per key, stamped once as it goes out', async () => {
    const answer = deferred<string>();
    const send = vi.fn(() => answer.promise);
    let stamps = 0;
    const stamp = () => ++stamps;

    const first = sharedRead('k', stamp, send);
    const joined = sharedRead('k', stamp, send);
    const other = sharedRead('other', stamp, () => Promise.resolve('x'));
    answer.resolve('v');

    const expected: StampedRead<string> = { data: 'v', sentAt: 1 };
    await expect(first).resolves.toEqual(expected);
    await expect(joined).resolves.toEqual(expected);
    await expect(other).resolves.toEqual({ data: 'x', sentAt: 2 });
    expect(send).toHaveBeenCalledTimes(1);

    // Once it has landed, the next read sends a request of its own.
    await expect(sharedRead('k', stamp, () => Promise.resolve('w'))).resolves.toEqual({
      data: 'w',
      sentAt: 3,
    });
  });
});
