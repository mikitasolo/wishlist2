// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useFetchItems } from '@/lib/hooks/useItems';
import { clearPendingRequests } from '@/lib/utils/requestDeduplication';
import { createMutationTracker } from '@/lib/utils/itemListMerge';
import type { ApiItem } from '@/types/api';

const ITEMS = [
  {
    _id: 'i1',
    wishlist: 'w1',
    name: 'Bike',
    status: 'available',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
] as ApiItem[];

const fetchMock = vi.fn();

function reply(status: number, body: unknown) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json' },
  });
}

// Counts up from 1 per request sent, so a test can tell which request a read got.
let requestsSent = 0;
const stamp = () => ++requestsSent;

function fetchItems() {
  const read = renderHook(() => useFetchItems()).result.current;
  return (wishlistId: string) => read(wishlistId, stamp);
}

beforeEach(() => {
  clearPendingRequests();
  requestsSent = 0;
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useFetchItems', () => {
  it("resolves the wishlist's items", async () => {
    fetchMock.mockResolvedValue(reply(200, { success: true, data: ITEMS }));

    await expect(fetchItems()('w1')).resolves.toEqual({ items: ITEMS, sentAt: 1 });
    expect(fetchMock).toHaveBeenCalledWith('/api/wishlists/w1/items', { cache: 'no-store' });
  });

  it('resolves an empty list when the list really is empty', async () => {
    fetchMock.mockResolvedValue(reply(200, { success: true, data: [] }));

    await expect(fetchItems()('w1')).resolves.toEqual({ items: [], sentAt: 1 });
  });

  // regression: the hook caught every failure and resolved [], so the wishlist
  // page replaced the list with nothing (a failed 5 s poll or reconcile read
  // showed "No items found") and its "Failed to load items" toast was
  // unreachable. A failed read must reject, never look like an empty list.
  describe('regression: rejects instead of resolving [] when the read fails', () => {
    it('on a network error', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(fetchItems()('w1')).rejects.toThrow('Failed to fetch');
    });

    it.each([
      [500, 'Internal server error'],
      [403, 'Unauthorized - No access to this wishlist'],
      [404, 'Wishlist not found'],
    ])('on a %i response', async (status, error) => {
      fetchMock.mockResolvedValue(reply(status, { success: false, error }));

      await expect(fetchItems()('w1')).rejects.toThrow(error);
    });

    it('on a non-2xx response that says it succeeded', async () => {
      fetchMock.mockResolvedValue(reply(502, { success: true, data: [] }));

      await expect(fetchItems()('w1')).rejects.toThrow('Failed to fetch items');
    });

    it('on a response that is not JSON', async () => {
      fetchMock.mockResolvedValue(reply(502, '<html>Bad Gateway</html>'));

      await expect(fetchItems()('w1')).rejects.toThrow();
    });

    it('on a 200 that reports a failure', async () => {
      fetchMock.mockResolvedValue(reply(200, { success: false, error: 'Nope' }));

      await expect(fetchItems()('w1')).rejects.toThrow('Nope');
    });

    it('on a success without a list', async () => {
      fetchMock.mockResolvedValue(reply(200, { success: true }));

      await expect(fetchItems()('w1')).rejects.toThrow('Failed to fetch items');
    });
  });

  it('shares one request between concurrent reads, and fails them all together', async () => {
    let fail!: (error: Error) => void;
    fetchMock.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    const fetch = fetchItems();

    const first = fetch('w1');
    const second = fetch('w1');
    fail(new TypeError('Failed to fetch'));

    await expect(first).rejects.toThrow('Failed to fetch');
    await expect(second).rejects.toThrow('Failed to fetch');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends a fresh request after a failed one, so the next poll can recover', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(reply(200, { success: true, data: ITEMS }));
    const fetch = fetchItems();

    await expect(fetch('w1')).rejects.toThrow();
    await expect(fetch('w1')).resolves.toEqual({ items: ITEMS, sentAt: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stamps a read as its request is sent', async () => {
    const sentAt = vi.fn(() => 7);
    fetchMock.mockImplementation(async () => {
      expect(sentAt).toHaveBeenCalledTimes(1);
      return reply(200, { success: true, data: ITEMS });
    });
    const read = renderHook(() => useFetchItems()).result.current;

    await expect(read('w1', sentAt)).resolves.toEqual({ items: ITEMS, sentAt: 7 });
    expect(sentAt).toHaveBeenCalledTimes(1);
  });

  // regression: the wishlist page stamped a poll when it was called, but a poll
  // called while another items read was in flight joined that request instead
  // of sending its own. A read sent before an edit settled then resolved into a
  // poll stamped after it, which kept the old list and undid the edit.
  it('regression: a read that joins one sent before a mutation settled is judged by that one', async () => {
    let answer!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
    const mutations = createMutationTracker();
    const read = renderHook(() => useFetchItems()).result.current;

    const poll = read('w1', mutations.stamp);
    await mutations.track(async () => 'edited');
    const joined = read('w1', mutations.stamp);
    answer(reply(200, { success: true, data: ITEMS }));

    const [first, second] = await Promise.all([poll, joined]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.sentAt).toBe(first.sentAt);
    expect(mutations.isStale(second.sentAt)).toBe(true);
  });

  it('gives a read sent once the shared one has landed a stamp of its own', async () => {
    fetchMock.mockImplementation(async () => reply(200, { success: true, data: ITEMS }));
    const mutations = createMutationTracker();
    const read = renderHook(() => useFetchItems()).result.current;

    const before = read('w1', mutations.stamp);
    await mutations.track(async () => 'edited');
    const stale = await before;
    const fresh = await read('w1', mutations.stamp);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mutations.isStale(stale.sentAt)).toBe(true);
    expect(mutations.isStale(fresh.sentAt)).toBe(false);
  });
});
