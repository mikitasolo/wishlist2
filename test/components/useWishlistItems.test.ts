// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { ToastProvider } from '@/components/ToastProvider';
import { useWishlistItems, type WishlistItemsOptions } from '@/lib/hooks/useWishlistItems';
import { flushUndoableActions } from '@/lib/hooks/useUndoableAction';
import { clearPendingRequests } from '@/lib/utils/requestDeduplication';
import { SHARE_TOKEN_HEADER } from '@/lib/utils/shareLinkFields';
import type { ApiItem } from '@/types/api';

function item(id: string, status: ApiItem['status'], extra: Partial<ApiItem> = {}): ApiItem {
  return {
    _id: id,
    wishlist: 'w1',
    name: id,
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  } as ApiItem;
}

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ok = (data: ApiItem[]) => reply(200, { success: true, data });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const fetchMock = vi.fn();
const onRefused = vi.fn();
const onReadFailed = vi.fn();
const updateItem = vi.fn();

function setup(overrides: Partial<WishlistItemsOptions> = {}) {
  const options: WishlistItemsOptions = {
    wishlistId: 'w1',
    readInit: undefined,
    previewAsVisitor: false,
    polling: true,
    pageLoad: 'ready',
    onItems: true,
    readsSent: { current: 0 },
    onRefused,
    onReadFailed,
    viewerId: 'me',
    updateItem,
    ...overrides,
  };
  const hook = renderHook((props: WishlistItemsOptions) => useWishlistItems(props), {
    initialProps: options,
    wrapper: ({ children }: { children: ReactNode }) =>
      createElement(ToastProvider, null, children),
  });
  return { ...hook, options };
}

/** A tab return, which reads the list in the background like the 5s poll. */
function poll() {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  clearPendingRequests();
  fetchMock.mockReset();
  onRefused.mockReset();
  onReadFailed.mockReset();
  updateItem.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useWishlistItems', () => {
  it("reads the list's items, sending a share link's token in link mode", async () => {
    fetchMock.mockResolvedValue(ok([item('a', 'available')]));
    const readInit = { headers: { [SHARE_TOKEN_HEADER]: 'tok' } };
    const { result } = setup({ readInit });

    expect(result.current.itemsLoaded).toBe(false);
    await waitFor(() => expect(result.current.itemsLoaded).toBe(true));
    expect(result.current.items.map((i) => i._id)).toEqual(['a']);
    expect(result.current.loadingItems).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/wishlists/w1/items',
      expect.objectContaining({ headers: { [SHARE_TOKEN_HEADER]: 'tok' } })
    );
  });

  it("keeps an owner's Preview as visitor to what a visitor is shown", async () => {
    fetchMock.mockResolvedValue(
      ok([item('live', 'available'), item('draft', 'draft'), item('idea', 'proposed')])
    );
    const { result } = setup({ previewAsVisitor: true });

    await waitFor(() => expect(result.current.itemsLoaded).toBe(true));
    expect(result.current.items.map((i) => i._id)).toEqual(['live']);
  });

  it('shows a failed first read as failed, never as an empty list, and Try again reads it', async () => {
    fetchMock.mockResolvedValueOnce(reply(500, { success: false, error: 'boom' }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = setup();

    await waitFor(() => expect(result.current.itemsFailed).toBe(true));
    expect(result.current.itemsLoaded).toBe(false);
    expect(onReadFailed).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(ok([item('a', 'available')]));
    act(() => result.current.retryItems());
    await waitFor(() => expect(result.current.itemsLoaded).toBe(true));
    expect(result.current.itemsFailed).toBe(false);
    expect(result.current.items).toHaveLength(1);
  });

  it('keeps the items shown when a later read fails', async () => {
    fetchMock.mockResolvedValueOnce(ok([item('a', 'available')]));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, rerender, options } = setup();
    await waitFor(() => expect(result.current.itemsLoaded).toBe(true));

    // A failed poll: silent, the list stays.
    fetchMock.mockResolvedValueOnce(reply(500, { success: false }));
    poll();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.items).toHaveLength(1);
    expect(onReadFailed).not.toHaveBeenCalled();

    // Coming back to Items: that read fails, the list stays, and it's toasted.
    fetchMock.mockResolvedValueOnce(reply(500, { success: false }));
    rerender({ ...options, onItems: false });
    rerender({ ...options, onItems: true });
    await waitFor(() => expect(onReadFailed).toHaveBeenCalledTimes(1));
    expect(result.current.itemsFailed).toBe(false);
    expect(result.current.items).toHaveLength(1);
  });

  it("passes a refused read's number on, so the page can say the list is unavailable", async () => {
    fetchMock.mockResolvedValue(reply(404, { success: false, error: 'Wishlist not found' }));
    const readsSent = { current: 4 };
    const { result } = setup({ readsSent });

    await waitFor(() => expect(onRefused).toHaveBeenCalledWith(5));
    expect(readsSent.current).toBe(5);
    expect(result.current.itemsFailed).toBe(false);
  });

  it('reads nothing while the list is unavailable or failed', () => {
    setup({ polling: false, pageLoad: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps an optimistic reserve over a poll that lands while it is in flight', async () => {
    fetchMock.mockResolvedValueOnce(ok([item('a', 'available')]));
    const { result } = setup();
    await waitFor(() => expect(result.current.itemsLoaded).toBe(true));

    const answer = deferred<ApiItem | null>();
    updateItem.mockReturnValue(answer.promise);
    let update!: Promise<ApiItem | null>;
    act(() => {
      update = result.current.handleUpdateItem('a', { status: 'booked' });
    });
    expect(result.current.items[0]).toMatchObject({ status: 'booked', bookedBy: 'me' });

    // A poll answering with the list as it was before the reserve.
    fetchMock.mockResolvedValueOnce(ok([item('a', 'available')]));
    poll();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(result.current.items[0]).toMatchObject({ status: 'booked', bookedBy: 'me' });

    // The reserve lands; the list is read again once idle, and that read wins.
    fetchMock.mockResolvedValue(ok([item('a', 'booked', { bookedBy: 'me' })]));
    await act(async () => {
      answer.resolve(item('a', 'booked', { bookedBy: 'me' }));
      await update;
    });
    expect(result.current.items[0]).toMatchObject({ status: 'booked', bookedBy: 'me' });
    expect(updateItem).toHaveBeenCalledWith('a', { status: 'booked' }, undefined);
  });

  it('undoes an update that fails, and reads the list again', async () => {
    fetchMock.mockResolvedValueOnce(ok([item('a', 'booked', { bookedBy: 'me' })]));
    const { result } = setup();
    await waitFor(() => expect(result.current.itemsLoaded).toBe(true));

    updateItem.mockResolvedValue(null);
    fetchMock.mockResolvedValue(ok([item('a', 'booked', { bookedBy: 'me' })]));
    await act(async () => {
      await expect(result.current.handleUpdateItem('a', { status: 'available' })).resolves.toBe(
        null
      );
    });
    expect(result.current.items[0]).toMatchObject({ status: 'booked', bookedBy: 'me' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  // WIS-376: the poll runs through the shared useLiveRead. It used to tick on
  // while the tab was hidden (skipping the read), and never read on focus.
  it('polls every 5 s only while the tab is visible, and reads on focus and on return', async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    const flush = (ms = 0) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    try {
      fetchMock.mockImplementation(async () => ok([item('a', 'available')]));
      const { result } = setup();
      await flush();
      expect(result.current.itemsLoaded).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await flush(5000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      visibility = 'hidden';
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await flush(30_000);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      visibility = 'visible';
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
        // The same return's focus: no second read.
        window.dispatchEvent(new Event('focus'));
      });
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(3);

      await flush(2000);
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
      await flush();
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(result.current.items.map((i) => i._id)).toEqual(['a']);
    } finally {
      vi.useRealTimers();
    }
  });

  // WIS-387: a deferred change shows at once and is sent only when flushed;
  // another change to the item waits for it to settle (settlePending).
  describe('deferItemChange', () => {
    it('shows the change, sends nothing until flushed, and settles before the next change', async () => {
      fetchMock.mockResolvedValueOnce(ok([item('a', 'booked', { bookedBy: 'me' })]));
      const { result } = setup();
      await waitFor(() => expect(result.current.itemsLoaded).toBe(true));

      const answer = deferred<ApiItem | null>();
      const commit = vi.fn(() => answer.promise);
      act(() => {
        result.current.deferItemChange({
          id: 'a',
          kind: 'release',
          message: 'Released',
          apply: (i) => ({ ...i, status: 'available', bookedBy: null }),
          commit,
        });
      });
      expect(result.current.items[0]).toMatchObject({ status: 'available', bookedBy: null });
      expect(result.current.pendingFor('a')?.kind).toBe('release');
      expect(commit).not.toHaveBeenCalled();

      let settled = false;
      act(() => {
        void result.current.settlePending('a').then(() => (settled = true));
      });
      expect(commit).toHaveBeenCalledTimes(1);
      await act(async () => {});
      expect(settled).toBe(false);
      await act(async () => {
        answer.resolve(item('a', 'available'));
      });
      await waitFor(() => expect(settled).toBe(true));
      expect(result.current.pendingFor('a')).toBeUndefined();
    });

    it('puts the item back when the commit fails, or on Undo', async () => {
      fetchMock.mockResolvedValue(ok([item('a', 'booked', { bookedBy: 'me' })]));
      const { result } = setup();
      await waitFor(() => expect(result.current.itemsLoaded).toBe(true));
      const change = (commit: () => Promise<ApiItem | null>) =>
        act(() => {
          result.current.deferItemChange({
            id: 'a',
            kind: 'release',
            message: 'Released',
            apply: (i) => ({ ...i, status: 'available', bookedBy: null }),
            commit,
          });
        });

      const failing = vi.fn().mockResolvedValue(null);
      change(failing);
      await act(async () => {
        await result.current.settlePending('a');
      });
      expect(failing).toHaveBeenCalledTimes(1);
      expect(result.current.items[0]).toMatchObject({ status: 'booked', bookedBy: 'me' });

      const undone = vi.fn();
      change(undone);
      act(() => {
        result.current.pendingFor('a')!.pending.undo();
      });
      expect(result.current.items[0]).toMatchObject({ status: 'booked', bookedBy: 'me' });
      flushUndoableActions();
      expect(undone).not.toHaveBeenCalled();
    });
  });
});
