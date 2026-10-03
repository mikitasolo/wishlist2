// @vitest-environment jsdom
// The unread count Activity's badge shows (WIS-302). It used to live in the
// header's bell (NotificationBell), which this hook replaces: the bell's
// freshness rules are covered here, plus what WIS-187 asked of it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';

type Session = { data: { user: { id: string } } | null; status: string };

const { session } = vi.hoisted(() => ({
  session: { current: null as unknown as Session },
}));
vi.mock('next-auth/react', () => ({ useSession: () => session.current }));

import { useUnreadNotifications } from '@/lib/hooks/useUnreadNotifications';

const signedIn = (id: string): Session => ({ data: { user: { id } }, status: 'authenticated' });

/** A read of `/api/notifications` the test answers when it chooses. */
interface PendingRead {
  answer: (unreadCount: number) => Promise<void>;
  fail: () => Promise<void>;
}

const fetchMock = vi.fn();
let reads: PendingRead[] = [];

function reply(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  cleanup();
  session.current = signedIn('alice');
  reads = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    () =>
      new Promise<Response>((resolve, reject) => {
        reads.push({
          answer: async (unreadCount) => {
            await act(async () => resolve(reply({ success: true, data: [], unreadCount })));
          },
          fail: async () => {
            await act(async () => reject(new TypeError('Failed to fetch')));
          },
        });
      })
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function render() {
  return renderHook(() => useUnreadNotifications());
}

describe('useUnreadNotifications', () => {
  it('reads the count once someone is signed in, without the feed’s actors', async () => {
    const { result } = render();
    expect(result.current).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/notifications', { cache: 'no-store' });

    await reads[0].answer(3);
    expect(result.current).toBe(3);
  });

  it('reads nothing for a signed-out visitor, nor while the session loads', () => {
    session.current = { data: null, status: 'unauthenticated' };
    const { result, rerender } = render();
    session.current = { data: null, status: 'loading' };
    rerender();
    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('notifications-changed'));
    });
    expect(result.current).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['focus', 'notifications-changed', 'invites-changed'])(
    'reads the count again on %s',
    async (event) => {
      const { result } = render();
      await reads[0].answer(2);

      act(() => {
        window.dispatchEvent(new Event(event));
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await reads[1].answer(0);
      expect(result.current).toBe(0);
    }
  );

  it('stops listening once unmounted', async () => {
    const { unmount } = render();
    await reads[0].answer(1);
    unmount();
    window.dispatchEvent(new Event('notifications-changed'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the count when a read fails, or answers with an error', async () => {
    const { result } = render();
    await reads[0].answer(4);

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await reads[1].fail();
    expect(result.current).toBe(4);

    fetchMock.mockResolvedValueOnce(reply({ success: false, error: 'Unauthorized' }));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(result.current).toBe(4);
  });

  it('keeps the count up through an update(), which puts a known session back through loading', async () => {
    const { result, rerender } = render();
    await reads[0].answer(5);

    session.current = { data: { user: { id: 'alice' } }, status: 'loading' };
    rerender();
    expect(result.current).toBe(5);
  });

  it('drops the count when the visitor signs out', async () => {
    const { result, rerender } = render();
    await reads[0].answer(5);

    session.current = { data: null, status: 'unauthenticated' };
    rerender();
    expect(result.current).toBe(0);
  });

  // Visiting Activity marks everything read and fires notifications-changed:
  // the read that event sends is the one the badge has to end on.
  it('drops a read that lands after a newer one', async () => {
    const { result } = render();
    act(() => {
      window.dispatchEvent(new Event('notifications-changed'));
    });
    await reads[1].answer(0);
    await reads[0].answer(3);
    expect(result.current).toBe(0);
  });

  // regression (WIS-187): the bell's read was keyed on the session status
  // alone, which stays 'authenticated' when another account signs in from
  // another tab, so it kept the previous account's count until the next focus;
  // and a read still on its way for that account could land on the new one.
  it('regression: reads again when another account signs in, and never shows the previous one’s count', async () => {
    const { result, rerender } = render();
    await reads[0].answer(7);
    expect(result.current).toBe(7);

    // A read for alice is on its way when bob signs in.
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    session.current = signedIn('bob');
    rerender();
    expect(result.current).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // alice's read lands late: it's not bob's.
    await reads[1].answer(9);
    expect(result.current).toBe(0);

    await reads[2].answer(1);
    expect(result.current).toBe(1);
  });

  it('shows nothing for the new account until its own read lands', async () => {
    const { result, rerender } = render();
    await reads[0].answer(7);
    session.current = signedIn('bob');
    rerender();
    expect(result.current).toBe(0);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await reads[1].fail();
    expect(result.current).toBe(0);
  });
});
