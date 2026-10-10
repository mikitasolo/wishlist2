// @vitest-environment jsdom
// WIS-386: an owner's Select mode, through the real page: pick items, act on
// them with one request (one Idempotency-Key), shown at once and put back item
// by item when the server couldn't change them; a delete offers Undo and sends
// nothing until its window has passed.
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

let userRole: 'owner' | 'member';
let listItems: ApiItem[];
/** How the bulk endpoint answers: by default it applies everything. */
let bulkReply: ((body: { action: string; itemIds: string[] }) => unknown) | null;
let bulkStatus: number;

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

const STATUS: Record<string, string> = {
  publish: 'available',
  draft: 'draft',
  received: 'completed',
};

const fetchMock = vi.fn();
const bulkCalls = () =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/wishlists/birthday/items/bulk');
const bulkBody = (n: number) => JSON.parse(String(bulkCalls()[n][1].body));
const bulkKey = (n: number) =>
  (bulkCalls()[n][1].headers as Record<string, string>)['Idempotency-Key'];

beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  localStorage.clear();
  userRole = 'owner';
  listItems = [
    item('Lamp', { status: 'draft' }),
    item('Kite', { status: 'draft' }),
    item('Mug'),
    item('Idea', { status: 'proposed' }),
  ];
  bulkReply = null;
  bulkStatus = 200;
  showToast.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/wishlists/birthday/items') return reply({ success: true, data: listItems });
    if (url === '/api/wishlists/birthday/items/bulk' && method === 'POST') {
      if (bulkStatus !== 200) return reply({ success: false, error: 'Server error' }, bulkStatus);
      const body = JSON.parse(String(init?.body));
      if (bulkReply) return reply({ success: true, data: bulkReply(body) });
      const ids: string[] = body.itemIds;
      if (body.action === 'delete') {
        listItems = listItems.filter((i) => !ids.includes(i._id));
        return reply({
          success: true,
          data: { done: ids, skipped: [], gone: [], failed: [], items: [] },
        });
      }
      listItems = listItems.map((i) =>
        ids.includes(i._id)
          ? {
              ...i,
              ...(STATUS[body.action]
                ? { status: STATUS[body.action] }
                : { mostWanted: body.action === 'mostWanted' }),
            }
          : i
      ) as ApiItem[];
      return reply({
        success: true,
        data: {
          done: ids,
          skipped: [],
          gone: [],
          failed: [],
          items: listItems.filter((i) => ids.includes(i._id)),
        },
      });
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

const card = (name: string) => screen.queryByRole('article', { name: `Item: ${name}` });
const statusOf = (name: string) => card(name)?.getAttribute('data-status');
const bar = () => screen.getByRole('region', { name: 'Selected items' });

async function pick(...names: string[]) {
  const user = userEvent.setup();
  if (!screen.queryByRole('region', { name: 'Selected items' })) {
    await user.click(screen.getByRole('button', { name: 'Select' }));
  }
  for (const name of names) {
    await user.click(screen.getByRole('checkbox', { name: `Select ${name}` }));
  }
  return user;
}

function undoToast(message: string) {
  const call = showToast.mock.calls.find(([text]) => text === message);
  expect(call).toBeDefined();
  return (call![2] as { action: { label: string; onClick: () => void } }).action;
}

describe('Select mode (WIS-386)', () => {
  it('is an owner’s only', async () => {
    userRole = 'member';
    listItems = [item('Lamp'), item('Kite')];
    await open();
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
  });

  it('makes each card a checkbox, but never a proposal, and Done leaves it', async () => {
    await open();
    const user = await pick('Lamp');
    expect(screen.getByRole('checkbox', { name: 'Select Lamp' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.queryByRole('checkbox', { name: 'Select Idea' })).toBeNull();
    expect(within(bar()).getByText('1 selected')).toBeInTheDocument();
    await user.click(within(bar()).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('checkbox', { name: 'Select Lamp' })).toBeNull();
  });

  it('enables only the actions that would change a picked item', async () => {
    await open();
    await pick('Lamp');
    expect(within(bar()).getByRole('button', { name: 'Publish' })).toBeEnabled();
    expect(within(bar()).getByRole('button', { name: 'Move to draft' })).toBeDisabled();
    expect(within(bar()).getByRole('button', { name: 'Mark as received' })).toBeDisabled();
    expect(within(bar()).getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  it('publishes the picked drafts with one request and one key, shown at once', async () => {
    await open();
    const user = await pick('Lamp', 'Kite', 'Mug');
    await user.click(within(bar()).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkBody(0)).toEqual({ action: 'publish', itemIds: ['item-Lamp', 'item-Kite'] });
    expect(bulkKey(0)).toMatch(/.{16,}/);
    await waitFor(() => expect(statusOf('Lamp')).toBe('available'));
    expect(statusOf('Kite')).toBe('available');
    expect(showToast).toHaveBeenCalledWith('2 items published', 'success');
    // Picks are cleared, Select mode stays.
    expect(within(bar()).getByText('Select items')).toBeInTheDocument();
  });

  it('puts back only the items the server couldn’t change, with a count and no reason', async () => {
    bulkReply = ({ itemIds }) => {
      // The first lands (as the reconcile read then shows), the second doesn't.
      listItems = listItems.map((i) =>
        i._id === itemIds[0] ? { ...i, status: 'available' as const } : i
      );
      return {
        done: [itemIds[0]],
        skipped: [],
        gone: [],
        failed: [itemIds[1]],
        items: [listItems[0]],
      };
    };
    await open();
    const user = await pick('Lamp', 'Kite');
    await user.click(within(bar()).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('1 item published', 'success'));
    expect(statusOf('Lamp')).toBe('available');
    await waitFor(() => expect(statusOf('Kite')).toBe('draft'));
    expect(showToast).toHaveBeenCalledWith('1 item couldn’t be changed. Try again.', 'error');
  });

  it('puts every item back when the request fails, and a retry sends the same key', async () => {
    bulkStatus = 500;
    await open();
    let user = await pick('Lamp', 'Kite');
    await user.click(within(bar()).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Server error', 'error'));
    await waitFor(() => expect(statusOf('Lamp')).toBe('draft'));
    expect(statusOf('Kite')).toBe('draft');

    bulkStatus = 200;
    user = await pick('Lamp', 'Kite');
    await user.click(within(bar()).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(2));
    expect(bulkKey(1)).toBe(bulkKey(0));
    await waitFor(() => expect(statusOf('Lamp')).toBe('available'));

    // After a success, the next batch gets a new key.
    user = await pick('Lamp');
    await user.click(within(bar()).getByRole('button', { name: 'Mark as most wanted' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(3));
    expect(bulkKey(2)).not.toBe(bulkKey(1));
  });

  it('asks before moving live items to draft, as a single one does', async () => {
    await open();
    const user = await pick('Mug');
    await user.click(within(bar()).getByRole('button', { name: 'Move to draft' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Move 1 item to draft?')).toBeInTheDocument();
    expect(bulkCalls()).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Move to draft' }));
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkBody(0)).toEqual({ action: 'draft', itemIds: ['item-Mug'] });
  });
});

describe('bulk delete offers Undo (WIS-386 with WIS-387)', () => {
  it('takes the items off at once, sends nothing until the window has passed, then one request', async () => {
    await open();
    const user = await pick('Lamp', 'Mug');
    await user.click(within(bar()).getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(card('Lamp')).toBeNull();
    expect(card('Mug')).toBeNull();
    expect(card('Kite')).not.toBeNull();
    undoToast('2 items deleted');
    expect(bulkCalls()).toHaveLength(0);

    await act(async () => flushUndoableActions());
    await waitFor(() => expect(bulkCalls()).toHaveLength(1));
    expect(bulkBody(0)).toEqual({ action: 'delete', itemIds: ['item-Lamp', 'item-Mug'] });
    expect(card('Lamp')).toBeNull();
  });

  it('puts them back on Undo, where they were, and never sends the delete', async () => {
    await open();
    const user = await pick('Lamp', 'Mug');
    await user.click(within(bar()).getByRole('button', { name: 'Delete' }));
    await act(async () => undoToast('2 items deleted').onClick());
    const names = screen
      .getAllByRole('article')
      .map((a) => a.getAttribute('aria-label'))
      .filter((n) => n !== 'Item: Idea');
    expect(names).toEqual(['Item: Lamp', 'Item: Kite', 'Item: Mug']);
    await act(async () => flushUndoableActions());
    expect(bulkCalls()).toHaveLength(0);
  });

  it('puts back the ones the server kept, and all of them when the request fails', async () => {
    bulkReply = ({ itemIds }) => {
      // The first is deleted (as the read after shows), the second isn't.
      listItems = listItems.filter((i) => i._id !== itemIds[0]);
      return { done: [itemIds[0]], skipped: [], gone: [], failed: [itemIds[1]], items: [] };
    };
    await open();
    let user = await pick('Lamp', 'Mug');
    await user.click(within(bar()).getByRole('button', { name: 'Delete' }));
    await act(async () => flushUndoableActions());
    await waitFor(() => expect(card('Mug')).not.toBeNull());
    expect(card('Lamp')).toBeNull();
    expect(showToast).toHaveBeenCalledWith('1 item couldn’t be changed. Try again.', 'error');

    bulkReply = null;
    bulkStatus = 500;
    user = await pick('Kite');
    await user.click(within(bar()).getByRole('button', { name: 'Delete' }));
    expect(card('Kite')).toBeNull();
    const reads = () =>
      fetchMock.mock.calls.filter(([url]) => url === '/api/wishlists/birthday/items').length;
    const readsBefore = reads();
    await act(async () => flushUndoableActions());
    await waitFor(() => expect(card('Kite')).not.toBeNull());
    // It may have landed all the same: the list is read again.
    await waitFor(() => expect(reads()).toBeGreaterThan(readsBefore));
  });
});

describe('the pick limit (WIS-386)', () => {
  it('never lets more items be picked than one request takes', async () => {
    listItems = Array.from({ length: 101 }, (_, i) => item(`Thing ${i}`));
    listItems[0] = item('Lamp');
    await open();
    const user = await pick();
    await user.click(within(bar()).getByRole('button', { name: 'Select all' }));
    expect(within(bar()).getByText('100 selected')).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith('You can pick up to 100 items at a time', 'info');
    const unpicked = screen
      .getAllByRole('checkbox')
      .find((box) => box.getAttribute('aria-checked') === 'false')!;
    showToast.mockClear();
    await user.click(unpicked);
    expect(unpicked).toHaveAttribute('aria-checked', 'false');
    expect(within(bar()).getByText('100 selected')).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith('You can pick up to 100 items at a time', 'info');
  });
});
