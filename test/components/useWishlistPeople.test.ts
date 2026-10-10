// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useWishlistPeople, type WishlistPeopleOptions } from '@/lib/hooks/useWishlistPeople';
import type { ShareLinksControl } from '@/lib/hooks/useShareLinks';
import { UNDO_WINDOW_MS } from '@/lib/utils/deferredCommit';

type ToastOptions = { action?: { label: string; onClick: () => void }; onDismiss?: () => void };
const showToast = vi.fn((_message: string, _type?: string, _options?: ToastOptions) => 'toast-1');
const dismissToast = vi.fn();
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast, dismissToast }) }));

/** Presses Undo on the latest toast that offers it. */
async function pressUndo() {
  const call = [...showToast.mock.calls].reverse().find(([, , o]) => o?.action?.label === 'Undo');
  if (!call) throw new Error('No Undo toast');
  await act(async () => call[2]!.action!.onClick());
}

function reply(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function person(id: string, role: 'owner' | 'member') {
  return { _id: `m-${id}`, role, user: { _id: id, username: id } };
}

const fetchMock = vi.fn();
const dropOwner = vi.fn();
const refreshOwners = vi.fn();
const chooseTab = vi.fn();
// Stable, as the page's is: People's reads follow it.
const apiId = () => 'w1';

const shareLinks = {
  read: 'loading',
  links: [],
  liveCount: 0,
} as unknown as ShareLinksControl;

type Props = Pick<WishlistPeopleOptions, 'isOwner' | 'tab'>;

function setup(props: Props = { isOwner: true, tab: 'items' }) {
  return renderHook(
    ({ isOwner, tab }: Props) => {
      const people = useWishlistPeople({
        wishlistId: 'w1',
        apiId,
        isOwner,
        tab,
        chooseTab,
        ownerUsernames: ['me'],
        dropOwner,
        refreshOwners,
        shareLinks,
        inviteFormRef: { current: null },
        shareLinksRef: { current: null },
      });
      return { people };
    },
    { initialProps: props }
  );
}

const urls = () => fetchMock.mock.calls.map(([url]) => String(url));

beforeEach(() => {
  showToast.mockClear();
  fetchMock.mockReset();
  dropOwner.mockReset();
  refreshOwners.mockReset();
  refreshOwners.mockResolvedValue(null);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
});

describe('useWishlistPeople', () => {
  it('sends none of the owner-only reads for a viewer who is not an owner', async () => {
    fetchMock.mockImplementation(async () => reply({ success: true, data: [] }));
    const { result } = setup({ isOwner: false, tab: 'items' });
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.people.peopleCount).toBeNull();
  });

  it("reads an owner's people once off People, and the invites and requests only on it", async () => {
    fetchMock.mockImplementation(async () => reply({ success: true, data: [] }));
    const { rerender } = setup();
    await waitFor(() => expect(urls()).toEqual(['/api/wishlists/w1/members']));

    rerender({ isOwner: true, tab: 'people' });
    await waitFor(() =>
      expect(urls().slice(1).sort()).toEqual(
        expect.arrayContaining([
          '/api/wishlists/w1/invites',
          '/api/wishlists/w1/requests',
          '/api/wishlists/w1/members',
        ])
      )
    );
  });

  it('drops a read of the people sent before the one on screen', async () => {
    const first = deferred<Response>();
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith('/members') ? first.promise : reply({ success: true, data: [] })
    );
    const { result } = setup();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // A later read (after a change on the page) lands first.
    fetchMock.mockImplementationOnce(async () =>
      reply({ success: true, data: [person('me', 'owner'), person('ann', 'member')] })
    );
    await act(async () => {
      await result.current.people.refreshMembers();
    });
    expect(result.current.people.members).toHaveLength(2);

    // The older one answers late, without Ann: it's dropped.
    await act(async () => {
      first.resolve(reply({ success: true, data: [person('me', 'owner')] }));
    });
    expect(result.current.people.members).toHaveLength(2);
    expect(result.current.people.peopleCount).toBe(2);
  });
});

// WIS-387: Remove, Make member, cancelling an invite and declining a request
// are deferred with Undo. Nothing is sent before the Undo window ends, and an
// undone one is never sent, so nobody is notified of a change that didn't
// happen.
describe('useWishlistPeople deferred row actions', () => {
  const MEMBERS = [person('me', 'owner'), person('bob', 'owner'), person('ann', 'member')];
  const INVITES = [{ _id: 'inv-1', username: 'cat', role: 'member' }];
  const REQUESTS = [{ _id: 'req-1', user: { _id: 'dan', username: 'dan' } }];

  // People open, everything read, then the clock is ours.
  async function openPeople(
    write: (url: string, init: RequestInit) => Response = () => reply({ success: true })
  ) {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method) return write(String(url), init);
      if (String(url).endsWith('/members')) return reply({ success: true, data: MEMBERS });
      if (String(url).endsWith('/invites')) return reply({ success: true, data: INVITES });
      if (String(url).endsWith('/requests')) return reply({ success: true, data: REQUESTS });
      return reply({ success: true, data: [] });
    });
    const hook = setup({ isOwner: true, tab: 'people' });
    await waitFor(() => {
      expect(hook.result.current.people.members).toHaveLength(3);
      expect(hook.result.current.people.pendingInvites).toHaveLength(1);
      expect(hook.result.current.people.joinRequests).toHaveLength(1);
    });
    vi.useFakeTimers();
    return hook;
  }

  const writes = () =>
    fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method)
      .map(([url, init]) => `${(init as RequestInit).method} ${url}`);

  async function advance(ms: number) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
    // The commit's answer and the reads after it.
    await act(async () => {});
    await act(async () => {});
  }

  it('takes a removed member off at once and sends the removal only after the Undo window', async () => {
    const { result } = await openPeople();
    act(() => {
      void result.current.people.handleKickMember({
        id: 'm-ann',
        userId: 'ann',
        username: 'ann',
        role: 'member',
      });
    });
    expect(result.current.people.memberRows).toHaveLength(0);
    expect(result.current.people.peopleCount).toBe(2);
    expect(result.current.people.rowBusy('ann')).toBe(true);
    expect(showToast).toHaveBeenCalledWith(
      'Removed @ann from the list',
      'success',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) })
    );

    await advance(UNDO_WINDOW_MS - 1);
    expect(writes()).toEqual([]);
    await advance(1);
    expect(writes()).toEqual(['DELETE /api/wishlists/w1/members/m-ann']);
  });

  // regression: an undone kick must never reach the route, which notifies the person.
  it('sends nothing for an undone removal of a co-owner, so they are never told', async () => {
    const { result } = await openPeople();
    act(() => {
      void result.current.people.handleKickMember({
        id: 'bob',
        userId: 'bob',
        username: 'bob',
        role: 'owner',
      });
    });
    expect(result.current.people.members.map((m) => m.user.username)).not.toContain('bob');
    await pressUndo();
    await advance(UNDO_WINDOW_MS * 3);
    expect(writes()).toEqual([]);
    expect(result.current.people.members.map((m) => m.user.username)).toContain('bob');
    expect(result.current.people.rowBusy('bob')).toBe(false);
    expect(dropOwner).not.toHaveBeenCalled();
  });

  it('drops a removed co-owner from the owners only once the removal went through', async () => {
    const { result } = await openPeople();
    act(() => {
      void result.current.people.handleKickMember({
        id: 'bob',
        userId: 'bob',
        username: 'bob',
        role: 'owner',
      });
    });
    expect(dropOwner).not.toHaveBeenCalled();
    await advance(UNDO_WINDOW_MS);
    expect(writes()).toEqual(['DELETE /api/wishlists/w1/owners/bob']);
    expect(dropOwner).toHaveBeenCalledWith({ id: 'bob', username: 'bob' });
    expect(refreshOwners).toHaveBeenCalled();
  });

  it('puts a person back when their removal fails', async () => {
    const { result } = await openPeople(() => reply({ success: false, error: 'Nope' }));
    act(() => {
      void result.current.people.handleKickMember({
        id: 'm-ann',
        userId: 'ann',
        username: 'ann',
        role: 'member',
      });
    });
    await advance(UNDO_WINDOW_MS);
    expect(showToast).toHaveBeenCalledWith('Nope', 'error');
    expect(result.current.people.memberRows.map((m) => m.user.username)).toEqual(['ann']);
    expect(result.current.people.rowBusy('ann')).toBe(false);
  });

  // regression: an undone demotion must never reach the route, which notifies them.
  it('shows a demoted owner as a member at once, and sends nothing if undone', async () => {
    const { result } = await openPeople();
    act(() => result.current.people.handleDemoteOwner({ userId: 'bob', username: 'bob' }));
    expect(result.current.people.memberRows.map((m) => m.user.username)).toEqual(['bob', 'ann']);
    expect(showToast).toHaveBeenCalledWith('@bob is now a member', 'success', expect.anything());
    await pressUndo();
    await advance(UNDO_WINDOW_MS * 3);
    expect(writes()).toEqual([]);
    expect(result.current.people.memberRows.map((m) => m.user.username)).toEqual(['ann']);
  });

  it('sends a demotion once its Undo window has passed', async () => {
    const { result } = await openPeople();
    act(() => result.current.people.handleDemoteOwner({ userId: 'bob', username: 'bob' }));
    await advance(UNDO_WINDOW_MS - 1);
    expect(writes()).toEqual([]);
    await advance(1);
    expect(writes()).toEqual(['PATCH /api/wishlists/w1/owners/bob']);
    expect(dropOwner).toHaveBeenCalledWith({ id: 'bob', username: 'bob' });
  });

  it('cancels an invite and declines a request only after the Undo window, and not if undone', async () => {
    const { result } = await openPeople();
    act(() => {
      void result.current.people.cancelInvite('inv-1', 'inv-1');
    });
    expect(result.current.people.pendingInvites).toEqual([]);
    await pressUndo();
    expect(result.current.people.pendingInvites).toHaveLength(1);

    act(() => {
      void result.current.people.answerJoinRequest(
        REQUESTS[0] as Parameters<typeof result.current.people.answerJoinRequest>[0],
        'decline'
      );
    });
    expect(result.current.people.joinRequests).toEqual([]);
    expect(showToast).toHaveBeenCalledWith('Request declined', 'success', expect.anything());
    await advance(UNDO_WINDOW_MS - 1);
    expect(writes()).toEqual([]);
    await advance(1);
    expect(writes()).toEqual(['PATCH /api/wishlists/w1/requests/req-1']);
    expect(result.current.people.joinRequests).toEqual([]);
  });
});
