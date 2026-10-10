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
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

  it('does nothing while the tab is hidden, or while disabled', () => {
    const refresh = vi.fn();
    const { rerender } = renderHook(({ on }) => useRefreshOnReturn(refresh, on), {
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
