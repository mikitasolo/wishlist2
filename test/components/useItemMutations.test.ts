// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useCreateItem, useDeleteItem, useUpdateItem } from '@/lib/hooks/useItems';
import { clearPendingRequests } from '@/lib/utils/requestDeduplication';
import { ITEM_REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MESSAGE } from '@/lib/utils/requestTimeout';
import type { ApiItem } from '@/types/api';

const ITEM = {
  _id: 'i1',
  wishlist: 'w1',
  name: 'Bike',
  status: 'available',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as ApiItem;

const fetchMock = vi.fn();
const onError = vi.fn();

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// A fetch that never answers, as on a dropped connection: it only rejects once
// its signal aborts, so without one it never settles.
function stallFetch() {
  fetchMock.mockImplementationOnce(
    (_url: string, init: RequestInit) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        );
      })
  );
}

// Each item mutation hook, sending a request for the same item.
const hooks = [
  {
    name: 'useUpdateItem',
    failed: null,
    send: () => renderHook(() => useUpdateItem(undefined, onError)).result.current('i1', {}),
  },
  {
    name: 'useCreateItem',
    failed: null,
    send: () =>
      renderHook(() => useCreateItem(undefined, onError)).result.current('w1', { name: 'Bike' }),
  },
  {
    name: 'useDeleteItem',
    failed: false,
    send: () => renderHook(() => useDeleteItem(undefined, onError)).result.current('i1'),
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  clearPendingRequests();
  fetchMock.mockReset();
  onError.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each(hooks)('$name', ({ send, failed }) => {
  // regression: the item hooks sent their request with no timeout, so one that
  // stalled kept the card or modal busy, and the wishlist page's polls held
  // off, until the browser gave up on it minutes later.
  it('regression: gives up on a request that stalls, and reports it as a failure', async () => {
    stallFetch();
    const result = send();

    await vi.advanceTimersByTimeAsync(ITEM_REQUEST_TIMEOUT_MS - 1);
    expect(onError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onError).toHaveBeenCalledExactlyOnceWith(REQUEST_TIMEOUT_MESSAGE);
    await expect(result).resolves.toBe(failed);
    // So the browser drops the connection too.
    const init: RequestInit = fetchMock.mock.calls[0][1];
    expect(init.signal?.aborted).toBe(true);
  });

  it('sends a fresh request on a retry, rather than joining the one it gave up on', async () => {
    stallFetch();
    fetchMock.mockResolvedValueOnce(reply(200, { success: true, data: ITEM }));
    const stalled = send();
    await vi.advanceTimersByTimeAsync(ITEM_REQUEST_TIMEOUT_MS);
    await expect(stalled).resolves.toBe(failed);

    await expect(send()).resolves.toEqual(failed === false ? true : ITEM);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('leaves a request that answers in time alone', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { success: true, data: ITEM }));

    await expect(send()).resolves.toEqual(failed === false ? true : ITEM);
    await vi.advanceTimersByTimeAsync(ITEM_REQUEST_TIMEOUT_MS);
    const init: RequestInit = fetchMock.mock.calls[0][1];
    expect(init.signal?.aborted).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps the server's own error for a request that fails in time", async () => {
    fetchMock.mockResolvedValueOnce(reply(404, { success: false, error: 'Item not found' }));

    await expect(send()).resolves.toBe(failed);
    expect(onError).toHaveBeenCalledExactlyOnceWith('Item not found');
  });
});

it('gives up on a response whose body never finishes arriving', async () => {
  // The headers came, the body stalls: fetch resolved, but reading the JSON
  // never does.
  fetchMock.mockResolvedValueOnce({
    status: 200,
    json: () => new Promise(() => {}),
  });
  const result = renderHook(() => useUpdateItem(undefined, onError)).result.current('i1', {});

  await vi.advanceTimersByTimeAsync(ITEM_REQUEST_TIMEOUT_MS);
  expect(onError).toHaveBeenCalledExactlyOnceWith(REQUEST_TIMEOUT_MESSAGE);
  await expect(result).resolves.toBeNull();
});
