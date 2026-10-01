import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ITEM_REQUEST_TIMEOUT_MS,
  REQUEST_TIMEOUT_MESSAGE,
  RequestTimeoutError,
  withRequestTimeout,
} from '@/lib/utils/requestTimeout';
import { createMutationTracker, updateItemOptimistically } from '@/lib/utils/itemListMerge';
import type { ApiItem } from '@/types/api';

// A request that never answers, like a fetch on a dropped connection: it only
// settles once its signal aborts, and then rejects the way a fetch does.
function stalled(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () =>
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    );
  });
}

// Whether a promise is still pending once everything already queued has run.
async function isPending(promise: Promise<unknown>): Promise<boolean> {
  const pending = Symbol('pending');
  return (await Promise.race([promise, Promise.resolve(pending)]).catch(() => null)) === pending;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('withRequestTimeout', () => {
  it('resolves with what the request resolved with, leaving no timer and its signal alone', async () => {
    let signal: AbortSignal | undefined;
    const result = withRequestTimeout(async (s) => {
      signal = s;
      return 'saved';
    }, 1_000);

    await expect(result).resolves.toBe('saved');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(signal?.aborted).toBe(false);
  });

  it("passes on the request's own failure unchanged", async () => {
    const failure = new Error('Item not found');
    const result = withRequestTimeout(async () => {
      throw failure;
    }, 1_000);

    await expect(result).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects at once, leaving no timer, when the request throws before returning a promise', async () => {
    const failure = new Error('bad request');
    const result = withRequestTimeout(() => {
      throw failure;
    }, 1_000);

    await expect(result).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gives up on a request still unanswered at the deadline: rejects with the timeout and aborts its signal', async () => {
    let signal: AbortSignal | undefined;
    const result = withRequestTimeout((s) => {
      signal = s;
      return stalled(s);
    }, 1_000);
    const settled = result.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(999);
    expect(await isPending(result)).toBe(true);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const error = await settled;
    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect((error as Error).message).toBe(REQUEST_TIMEOUT_MESSAGE);
    // The abort is what makes a fetch drop the connection.
    expect(signal?.aborted).toBe(true);
    expect(signal?.reason).toBe(error);
  });

  it("rejects with the timeout, not the aborted request's own error", async () => {
    const result = withRequestTimeout(stalled, 1_000);
    const settled = result.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(await settled).toBeInstanceOf(RequestTimeoutError);
  });

  it('bounds a request that ignores its signal too, such as a response body that never finishes', async () => {
    const result = withRequestTimeout(() => new Promise<never>(() => {}), 1_000);
    const settled = result.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(await settled).toBeInstanceOf(RequestTimeoutError);
  });

  it('waits ITEM_REQUEST_TIMEOUT_MS by default', async () => {
    const result = withRequestTimeout(stalled);
    const settled = result.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(ITEM_REQUEST_TIMEOUT_MS - 1);
    expect(await isPending(result)).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    expect(await settled).toBeInstanceOf(RequestTimeoutError);
  });
});

describe('a stalled item request on the wishlist page', () => {
  const gift = {
    _id: 'gift',
    wishlist: 'w1',
    name: 'Gift',
    status: 'available',
    bookedBy: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  } as ApiItem;

  // A request as the item hooks send one: given up on after the timeout, and
  // reported as a failure (they toast it and resolve null).
  const stalledUpdate = async (): Promise<ApiItem | null> => {
    try {
      return await withRequestTimeout(stalled, 1_000);
    } catch {
      return null;
    }
  };

  it('settles its tracked mutation once given up on, so the polls held off behind it apply again', async () => {
    const mutations = createMutationTracker();
    const reread = vi.fn();
    mutations.setReread(reread);
    const settled = mutations.track(stalledUpdate);

    // A poll that lands meanwhile is dropped, and its re-read waits.
    expect(mutations.isStale(mutations.stamp())).toBe(true);
    mutations.rereadWhenIdle();
    await vi.advanceTimersByTimeAsync(999);
    expect(reread).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(settled).resolves.toBeNull();
    expect(reread).toHaveBeenCalledTimes(1);
    expect(mutations.isStale(mutations.stamp())).toBe(false);
  });

  // regression: item requests had no timeout, so a PATCH that stalled kept its
  // optimistic change on screen and held off every poll until the browser gave
  // up on it, minutes later.
  it('regression: puts a stalled update back and reconciles once given up on', async () => {
    let items = [gift];
    const mutations = createMutationTracker();
    let staleAtReconcile = true;
    const reconcile = vi.fn(() => {
      staleAtReconcile = mutations.isStale(mutations.stamp());
    });
    const result = updateItemOptimistically({
      id: gift._id,
      apply: (item) => ({ ...item, name: 'Renamed' }),
      request: stalledUpdate,
      setItems: (update) => {
        items = update(items);
      },
      mutations,
      reconcile,
    });
    expect(items[0].name).toBe('Renamed');

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toBeNull();
    expect(items).toEqual([gift]);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(staleAtReconcile).toBe(false);
  });
});
