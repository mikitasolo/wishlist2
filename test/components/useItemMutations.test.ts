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
const NOT_A_REVIEW = { proposalReviewed: false };

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
    // What onError is told besides the message (none for a create).
    failure: [NOT_A_REVIEW],
    send: () => renderHook(() => useUpdateItem(undefined, onError)).result.current('i1', {}),
  },
  {
    name: 'useCreateItem',
    failed: null,
    failure: [],
    send: () =>
      renderHook(() => useCreateItem(undefined, onError)).result.current('w1', { name: 'Bike' }),
  },
  {
    name: 'useDeleteItem',
    failed: false,
    failure: [NOT_A_REVIEW],
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

describe.each(hooks)('$name', ({ send, failed, failure }) => {
  // regression: the item hooks sent their request with no timeout, so one that
  // stalled kept the card or modal busy, and the wishlist page's polls held
  // off, until the browser gave up on it minutes later.
  it('regression: gives up on a request that stalls, and reports it as a failure', async () => {
    stallFetch();
    const result = send();

    await vi.advanceTimersByTimeAsync(ITEM_REQUEST_TIMEOUT_MS - 1);
    expect(onError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(onError).toHaveBeenCalledExactlyOnceWith(REQUEST_TIMEOUT_MESSAGE, ...failure);
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
    fetchMock.mockResolvedValueOnce(reply(403, { success: false, error: 'Not allowed' }));

    await expect(send()).resolves.toBe(failed);
    expect(onError).toHaveBeenCalledExactlyOnceWith('Not allowed', ...failure);
  });
});

describe('a retry whose first attempt went through (WIS-158)', () => {
  // regression: a delete retried after its first attempt timed out but landed
  // got the server's 404 "Item not found" as an error, and the Edit/Review
  // dialog stayed open over an item that was gone.
  it('takes a 404 on an owner’s delete as already deleted, with no error', async () => {
    fetchMock.mockResolvedValueOnce(reply(404, { success: false, error: 'Item not found' }));
    const onDeleted = vi.fn();

    const result = renderHook(() => useDeleteItem(onDeleted, onError)).result.current('i1', {
      notFoundIsDone: true,
    });

    await expect(result).resolves.toBe(true);
    expect(onDeleted).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  // A proposer's 404 may be an archived list refusing them, the proposal
  // still there: never reported as deleted.
  it('keeps a 404 an error without notFoundIsDone', async () => {
    fetchMock.mockResolvedValueOnce(reply(404, { success: false, error: 'Item not found' }));

    const result = renderHook(() => useDeleteItem(undefined, onError)).result.current('i1');

    await expect(result).resolves.toBe(false);
    expect(onError).toHaveBeenCalledExactlyOnceWith('Item not found', NOT_A_REVIEW);
  });

  it('sends a create with its idempotency key, and none without one', async () => {
    fetchMock.mockResolvedValue(reply(201, { success: true, data: ITEM }));
    const create = renderHook(() => useCreateItem(undefined, onError)).result.current;

    await create('w1', { name: 'Bike' }, 'key-0123456789abcdef');
    await create('w1', { name: 'Lamp' });

    const headers = fetchMock.mock.calls.map(([, init]) => init.headers as Record<string, string>);
    expect(headers[0]['Idempotency-Key']).toBe('key-0123456789abcdef');
    expect(headers[1]).not.toHaveProperty('Idempotency-Key');
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
  expect(onError).toHaveBeenCalledExactlyOnceWith(REQUEST_TIMEOUT_MESSAGE, NOT_A_REVIEW);
  await expect(result).resolves.toBeNull();
});
