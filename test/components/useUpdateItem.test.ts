// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useUpdateItem } from '@/lib/hooks/useItems';
import { clearPendingRequests } from '@/lib/utils/requestDeduplication';

const fetchMock = vi.fn();

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  clearPendingRequests();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useUpdateItem', () => {
  // A book or unbook that lost a race to another change is answered 409. The
  // page relies on the hook resolving null (it then re-reads the list, undoing
  // the optimistic booking) and toasting the server's message.
  it.each([
    ['a booking', { status: 'booked' }, 'This item is no longer available to book'],
    ['an unbook', { status: 'available' }, 'This item is no longer booked by you'],
  ] as const)('reports %s refused with a 409 and resolves null', async (_, updates, error) => {
    fetchMock.mockResolvedValue(reply(409, { success: false, error }));
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const update = renderHook(() => useUpdateItem(onSuccess, onError)).result.current;

    await expect(update('i1', updates)).resolves.toBeNull();

    expect(onError).toHaveBeenCalledWith(error);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
