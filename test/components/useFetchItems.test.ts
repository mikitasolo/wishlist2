// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useFetchItems } from '@/lib/hooks/useItems';
import { clearPendingRequests } from '@/lib/utils/requestDeduplication';
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

function fetchItems() {
  return renderHook(() => useFetchItems()).result.current;
}

beforeEach(() => {
  clearPendingRequests();
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

    await expect(fetchItems()('w1')).resolves.toEqual(ITEMS);
    expect(fetchMock).toHaveBeenCalledWith('/api/wishlists/w1/items', { cache: 'no-store' });
  });

  it('resolves an empty list when the list really is empty', async () => {
    fetchMock.mockResolvedValue(reply(200, { success: true, data: [] }));

    await expect(fetchItems()('w1')).resolves.toEqual([]);
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
    await expect(fetch('w1')).resolves.toEqual(ITEMS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
