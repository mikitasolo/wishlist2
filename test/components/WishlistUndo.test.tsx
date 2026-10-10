// @vitest-environment jsdom
// WIS-387: the wishlist page's deferred deletes and releases, through the real
// page: the change shows at once, a poll can't undo it while it waits, the
// request goes only once the Undo window has passed, and Undo sends nothing.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiItem } from '@/types/api';

const { router, showToast } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  showToast: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'carol', username: 'carol' } },
    status: 'authenticated',
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => ({ id: 'birthday' }),
}));
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/components/ImageUpload', () => ({
  default: () => <div data-testid="image-upload" />,
}));

import WishlistDetail from '@/app/wishlists/[id]/page';
import { flushUndoableActions } from '@/lib/hooks/useUndoableAction';
import { reconnect } from '@/test/returnToTab';

let userRole: 'owner' | 'member';
let listItems: ApiItem[];
let deleteStatus: number;

const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

function item(id: string, fields: Partial<ApiItem> = {}): ApiItem {
  return {
    _id: `item-${id}`,
    wishlist: 'w-birthday',
    name: id,
    status: 'available',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...fields,
  } as ApiItem;
}

const fetchMock = vi.fn();
const writes = (method: string) =>
  fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method);

beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  localStorage.clear();
  userRole = 'owner';
  listItems = [item('Lamp'), item('Kite')];
  deleteStatus = 200;
  showToast.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/wishlists/birthday/items') return reply({ success: true, data: listItems });
    if (url.startsWith('/api/items/') && method === 'DELETE') {
      if (deleteStatus !== 200) {
        return reply({ success: false, error: 'Server error' }, deleteStatus);
      }
      const id = url.slice('/api/items/'.length);
      listItems = listItems.filter((i) => i._id !== id);
      return reply({ success: true });
    }
    if (url.startsWith('/api/items/') && method === 'PATCH') {
      const id = url.slice('/api/items/'.length);
      const body = JSON.parse(String(init?.body));
      listItems = listItems.map((i) =>
        i._id === id
          ? { ...i, ...body, bookedBy: body.status === 'available' ? null : i.bookedBy }
          : i
      );
      return reply({ success: true, data: listItems.find((i) => i._id === id) });
    }
    if (url === '/api/wishlists/birthday' && method === 'GET') {
      return reply({
        success: true,
        data: {
          _id: 'birthday',
          name: 'Birthday',
          slug: 'birthday',
          description: '',
          owners: userRole === 'owner' ? ['carol'] : ['alice'],
          ownerUsernames: userRole === 'owner' ? ['carol'] : ['alice'],
          userRole,
          visibility: 'everyone',
          isPublic: true,
          archived: false,
          featured: false,
          currency: 'EUR',
          bannerUrl: null,
          occasion: null,
        },
      });
    }
    if (method === 'GET') return reply({ success: true, data: [] });
    return reply({ success: false, error: 'Not mocked' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  flushUndoableActions();
  cleanup();
  vi.unstubAllGlobals();
});

async function open() {
  render(<WishlistDetail />);
  await screen.findByRole('heading', { level: 1, name: 'Birthday' });
  await screen.findByRole('article', { name: 'Item: Lamp' });
}

const articles = (name: string) => screen.queryAllByRole('article', { name: `Item: ${name}` });

/** The Undo toast's button, as the page asked for it. */
function undoToast(message: string) {
  const call = showToast.mock.calls.find(([text]) => text === message);
  expect(call).toBeDefined();
  const options = call![2] as { action: { label: string; onClick: () => void } };
  expect(options.action.label).toBe('Undo');
  return options.action;
}

/** Back online (not a hidden tab, which would send the delete), which reads the list in the background like the 5s poll. */
async function poll() {
  await act(async () => reconnect());
  await act(async () => {});
}

async function deleteFromMenu(name: string) {
  const user = userEvent.setup();
  const card = screen.getByRole('article', { name: `Item: ${name}` });
  await user.click(within(card).getByRole('button', { name: 'More actions' }));
  await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
}

describe('deleting an item offers Undo (WIS-387)', () => {
  it('takes the item off at once, keeps it off over a poll, and sends the delete once the window has passed', async () => {
    await open();
    await deleteFromMenu('Lamp');

    expect(articles('Lamp')).toHaveLength(0);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    undoToast('Item deleted');
    expect(writes('DELETE')).toHaveLength(0);

    // The server still lists it while its delete waits: a read can't bring it back.
    const reads = () =>
      fetchMock.mock.calls.filter(([url]) => url === '/api/wishlists/birthday/items').length;
    const readsBefore = reads();
    await poll();
    expect(reads()).toBeGreaterThan(readsBefore);
    expect(writes('DELETE')).toHaveLength(0);
    expect(articles('Lamp')).toHaveLength(0);
    expect(articles('Kite')).toHaveLength(1);

    await act(async () => flushUndoableActions());
    await waitFor(() => expect(writes('DELETE')).toHaveLength(1));
    expect(writes('DELETE')[0][0]).toBe('/api/items/item-Lamp');
    expect(articles('Lamp')).toHaveLength(0);
  });

  it('puts the item back on Undo and never sends the delete', async () => {
    await open();
    await deleteFromMenu('Lamp');
    expect(articles('Lamp')).toHaveLength(0);

    await act(async () => undoToast('Item deleted').onClick());
    expect(articles('Lamp')).toHaveLength(1);

    await act(async () => flushUndoableActions());
    await poll();
    expect(writes('DELETE')).toHaveLength(0);
    expect(articles('Lamp')).toHaveLength(1);
  });

  it('puts the item back when the delete fails', async () => {
    deleteStatus = 500;
    await open();
    await deleteFromMenu('Lamp');
    expect(articles('Lamp')).toHaveLength(0);

    await act(async () => flushUndoableActions());
    await waitFor(() => expect(articles('Lamp')).toHaveLength(1));
    expect(writes('DELETE')).toHaveLength(1);
  });
});

describe("a member's Release offers Undo (WIS-387)", () => {
  beforeEach(() => {
    userRole = 'member';
    listItems = [item('Lamp', { status: 'booked', bookedBy: 'carol' }), item('Kite')];
  });

  const lampButton = (name: string | RegExp) =>
    within(screen.getByRole('article', { name: 'Item: Lamp' })).queryByRole('button', { name });

  it('shows the item released at once and sends the unbook once the window has passed', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(lampButton('Release this item')!);

    expect(lampButton('Release this item')).toBeNull();
    undoToast('Released');
    expect(writes('PATCH')).toHaveLength(0);

    // The server still has it booked: a read can't bring the Release back.
    await poll();
    expect(lampButton('Release this item')).toBeNull();

    await act(async () => flushUndoableActions());
    await waitFor(() => expect(writes('PATCH')).toHaveLength(1));
    expect(JSON.parse(String(writes('PATCH')[0][1].body))).toEqual({ status: 'available' });
  });

  it('keeps the reservation on Undo, sending nothing', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(lampButton('Release this item')!);

    await act(async () => undoToast('Released').onClick());
    expect(lampButton('Release this item')).not.toBeNull();

    await act(async () => flushUndoableActions());
    await poll();
    expect(writes('PATCH')).toHaveLength(0);
    expect(lampButton('Release this item')).not.toBeNull();
  });

  // Reserve on the same card within the window is the Release's Undo: nothing
  // is sent either way, so the item is never freed for anyone else meanwhile.
  it('takes Reserve during the window as Undo', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(lampButton('Release this item')!);
    await user.click(lampButton(/^reserve/i)!);

    await waitFor(() => expect(lampButton('Release this item')).not.toBeNull());
    await act(async () => flushUndoableActions());
    expect(writes('PATCH')).toHaveLength(0);
  });
});
