// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import {
  useWishlistPeople,
  type DeleteConfirm,
  type WishlistPeopleOptions,
} from '@/lib/hooks/useWishlistPeople';
import type { ShareLinksControl } from '@/lib/hooks/useShareLinks';

const showToast = vi.fn();
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

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

const shareLinks = {
  read: 'loading',
  links: [],
  liveCount: 0,
} as unknown as ShareLinksControl;

type Props = Pick<WishlistPeopleOptions, 'isOwner' | 'tab'>;

// The hook with the page's shared confirmation state around it.
function setup(props: Props = { isOwner: true, tab: 'items' }) {
  return renderHook(
    ({ isOwner, tab }: Props) => {
      const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);
      const people = useWishlistPeople({
        wishlistId: 'w1',
        apiId: () => 'w1',
        isOwner,
        tab,
        chooseTab,
        ownerUsernames: ['me'],
        dropOwner,
        refreshOwners,
        shareLinks,
        inviteFormRef: { current: null },
        shareLinksRef: { current: null },
        deleteConfirm,
        setDeleteConfirm,
      });
      return { people, deleteConfirm, setDeleteConfirm };
    },
    { initialProps: props }
  );
}

const urls = () => fetchMock.mock.calls.map(([url]) => String(url));

beforeEach(() => {
  fetchMock.mockReset();
  refreshOwners.mockReset();
  refreshOwners.mockResolvedValue(null);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
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

  it("shares the page's one confirmation: Remove shows only for a person, never for Leave", async () => {
    fetchMock.mockImplementation(async () => reply({ success: true, data: [] }));
    const { result } = setup();
    await act(async () => {});

    act(() => result.current.setDeleteConfirm({ type: 'leave' }));
    expect(result.current.people.removeConfirm).toBeNull();

    // Opening Remove replaces whatever confirmation was open.
    act(() =>
      result.current.people.handleKickMember({
        id: 'm-ann',
        userId: 'ann',
        username: 'ann',
        role: 'member',
      })
    );
    expect(result.current.deleteConfirm).toEqual({
      type: 'member',
      memberId: 'm-ann',
      memberUserId: 'ann',
      memberUsername: 'ann',
    });
    expect(result.current.people.removeConfirm?.memberUserId).toBe('ann');
  });

  it("holds the person's row while their removal runs, then closes the confirmation", async () => {
    const removal = deferred<Response>();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      init?.method === 'DELETE' ? removal.promise : reply({ success: true, data: [] })
    );
    const { result } = setup();
    await act(async () => {});

    act(() =>
      result.current.people.handleKickMember({
        id: 'ann',
        userId: 'ann',
        username: 'ann',
        role: 'owner',
      })
    );
    let done!: Promise<void>;
    act(() => {
      done = result.current.people.confirmKickMember();
    });
    await waitFor(() => expect(result.current.people.rowBusy('ann')).toBe(true));
    expect(urls()).toContain('/api/wishlists/w1/owners/ann');

    await act(async () => {
      removal.resolve(reply({ success: true }));
      await done;
    });
    expect(result.current.people.rowBusy('ann')).toBe(false);
    expect(result.current.deleteConfirm).toBeNull();
    expect(dropOwner).toHaveBeenCalledWith({ id: 'ann', username: 'ann' });
    expect(refreshOwners).toHaveBeenCalled();
  });
});
