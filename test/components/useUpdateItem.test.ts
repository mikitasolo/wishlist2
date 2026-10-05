// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useDeleteItem, useUpdateItem } from '@/lib/hooks/useItems';
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
    ['a booking', { status: 'booked' }, 'This item is no longer available to reserve'],
    ['an unbook', { status: 'available' }, 'This item is no longer reserved by you'],
  ] as const)('reports %s refused with a 409 and resolves null', async (_, updates, error) => {
    fetchMock.mockResolvedValue(reply(409, { success: false, error }));
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const update = renderHook(() => useUpdateItem(onSuccess, onError)).result.current;

    await expect(update('i1', updates)).resolves.toBeNull();

    expect(onError).toHaveBeenCalledWith(error, { proposalReviewed: false });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

// The review dialog's approve and Decline expect a proposal (WIS-199).
describe('review requests', () => {
  const REVIEWED = 'This proposal has already been reviewed';

  it('an approve sends the expectation in its body, and nothing else does', async () => {
    fetchMock.mockImplementation(async () => reply(200, { success: true, data: { _id: 'i1' } }));
    const update = renderHook(() => useUpdateItem()).result.current;

    await update('i1', { status: 'available' }, { expectProposal: true });
    await update('i1', { status: 'draft' });

    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies).toEqual([
      { status: 'available', expectedStatus: 'proposed' },
      { status: 'draft' },
    ]);
  });

  it("an approve's 409 is reported as the proposal having been reviewed", async () => {
    fetchMock.mockResolvedValue(reply(409, { success: false, error: REVIEWED }));
    const onError = vi.fn();
    const update = renderHook(() => useUpdateItem(undefined, onError)).result.current;

    await expect(update('i1', { status: 'available' }, { expectProposal: true })).resolves.toBe(
      null
    );
    expect(onError).toHaveBeenCalledExactlyOnceWith(REVIEWED, { proposalReviewed: true });
  });

  it('an approve sends the version it shows, when given one', async () => {
    fetchMock.mockImplementation(async () => reply(200, { success: true, data: { _id: 'i1' } }));
    const update = renderHook(() => useUpdateItem()).result.current;

    await update(
      'i1',
      { status: 'available' },
      { expectProposal: true, expectedVersion: '2026-10-05T10:00:00.000Z' }
    );

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      status: 'available',
      expectedStatus: 'proposed',
      expectedUpdatedAt: '2026-10-05T10:00:00.000Z',
    });
  });

  // WIS-320: the proposer edited it since the dialog was filled.
  it("an approve's edited-proposal 409 hands over the proposal as it is now", async () => {
    const EDITED =
      'This proposal was edited while you were reviewing it. Check the changes, then add it again.';
    const now = { _id: 'i1', status: 'proposed', notes: 'Size L' };
    fetchMock.mockResolvedValue(reply(409, { success: false, error: EDITED, data: now }));
    const onError = vi.fn();
    const update = renderHook(() => useUpdateItem(undefined, onError)).result.current;

    await expect(update('i1', { status: 'available' }, { expectProposal: true })).resolves.toBe(
      null
    );
    expect(onError).toHaveBeenCalledExactlyOnceWith(EDITED, {
      proposalReviewed: false,
      editedProposal: now,
    });
  });

  it("any other failure of an approve isn't", async () => {
    fetchMock.mockResolvedValue(reply(500, { success: false, error: 'Failed to update item' }));
    const onError = vi.fn();
    const update = renderHook(() => useUpdateItem(undefined, onError)).result.current;

    await update('i1', { status: 'available' }, { expectProposal: true });
    expect(onError).toHaveBeenCalledExactlyOnceWith('Failed to update item', {
      proposalReviewed: false,
    });
  });

  it('a Decline sends the expectation in its query, and its 409 is reported the same way', async () => {
    fetchMock.mockResolvedValue(reply(409, { success: false, error: REVIEWED }));
    const onError = vi.fn();
    const remove = renderHook(() => useDeleteItem(undefined, onError)).result.current;

    await expect(remove('i1', { notFoundIsDone: true, expectProposal: true })).resolves.toBe(false);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/items/i1?expectedStatus=proposed');
    expect(onError).toHaveBeenCalledExactlyOnceWith(REVIEWED, { proposalReviewed: true });
  });

  it("a plain delete's 409 isn't a review's", async () => {
    fetchMock.mockResolvedValue(reply(409, { success: false, error: 'Conflict' }));
    const onError = vi.fn();
    const remove = renderHook(() => useDeleteItem(undefined, onError)).result.current;

    await remove('i1');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/items/i1');
    expect(onError).toHaveBeenCalledExactlyOnceWith('Conflict', { proposalReviewed: false });
  });
});
