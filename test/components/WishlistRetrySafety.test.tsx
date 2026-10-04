// @vitest-environment jsdom
// WIS-158: retrying an add, a proposal or a delete whose first attempt reached
// the server but whose answer was lost (a timeout) is safe. An add or proposal
// is sent again with the same Idempotency-Key, which the server answers with
// the item the first attempt saved; a delete answered 404 is already done.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
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
// The page gives up on an item request after 50ms here, not 20s.
vi.mock('@/lib/utils/requestTimeout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/requestTimeout')>();
  return {
    ...actual,
    withRequestTimeout: <T,>(request: (signal: AbortSignal) => Promise<T>) =>
      actual.withRequestTimeout(request, 50),
  };
});

import WishlistDetail from '@/app/wishlists/[id]/page';
import { REQUEST_TIMEOUT_MESSAGE } from '@/lib/utils/requestTimeout';

let userRole: 'owner' | 'member';
let listItems: ApiItem[];
/** What the fake server saved per Idempotency-Key. */
let savedByKey: Map<string, ApiItem>;
let postKeys: (string | undefined)[];
/** POSTs whose answer is lost: saved, but the response never comes. */
let losePosts: number;
let deleteAnswer: number;

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

beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  localStorage.clear();
  userRole = 'owner';
  listItems = [item('Lamp')];
  savedByKey = new Map();
  postKeys = [];
  losePosts = 0;
  deleteAnswer = 200;
  showToast.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/wishlists/birthday/items' && method === 'POST') {
      const key = (init?.headers as Record<string, string>)['Idempotency-Key'];
      postKeys.push(key);
      const known = key ? savedByKey.get(key) : undefined;
      if (known) return reply({ success: true, data: known });
      const body = JSON.parse(String(init?.body));
      const fresh = item(`${body.name}-${postKeys.length}`, {
        name: body.name,
        status: body.status ?? 'available',
        proposedBy: body.status === 'proposed' ? 'carol' : undefined,
      });
      listItems = [fresh, ...listItems];
      if (key) savedByKey.set(key, fresh);
      if (losePosts > 0) {
        losePosts -= 1;
        // Saved, but the answer never arrives: only the page's timeout ends it.
        return new Promise((_, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          )
        );
      }
      return reply({ success: true, data: fresh }, 201);
    }
    if (url === '/api/wishlists/birthday/items') return reply({ success: true, data: listItems });
    if (url.startsWith('/api/items/') && method === 'DELETE') {
      const id = url.slice('/api/items/'.length);
      listItems = listItems.filter((i) => i._id !== id);
      return deleteAnswer === 404
        ? reply({ success: false, error: 'Item not found' }, 404)
        : reply({ success: true });
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
  cleanup();
  vi.unstubAllGlobals();
});

async function open() {
  render(<WishlistDetail />);
  await screen.findByRole('heading', { level: 1, name: 'Birthday' });
  await screen.findByRole('article', { name: 'Item: Lamp' });
}

const articles = (name: string) => screen.queryAllByRole('article', { name: `Item: ${name}` });

describe('a retried add (WIS-158)', () => {
  // regression: an add whose POST was saved but timed out was sent again as a
  // new request, and the list got a second copy.
  it('sends the retry with the same key and lists the item once', async () => {
    losePosts = 1;
    const user = userEvent.setup();
    await open();

    await user.click(screen.getAllByRole('button', { name: 'Add item' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Add new item' });
    await user.type(within(dialog).getByLabelText(/item name/i), 'Bike');
    await user.click(within(dialog).getByRole('button', { name: 'Add to list' }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(REQUEST_TIMEOUT_MESSAGE, 'error'));
    expect(screen.getByRole('dialog', { name: 'Add new item' })).toBe(dialog);

    await user.click(within(dialog).getByRole('button', { name: 'Add to list' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add new item' })).toBeNull());

    expect(postKeys).toHaveLength(2);
    expect(postKeys[0]).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(postKeys[1]).toBe(postKeys[0]);
    expect(listItems.filter((i) => i.name === 'Bike')).toHaveLength(1);
    await waitFor(() => expect(articles('Bike')).toHaveLength(1));
    expect(showToast).toHaveBeenLastCalledWith('Item added successfully', 'success');
  });

  it('gives each item Keep adding saves its own key', async () => {
    const user = userEvent.setup();
    await open();

    await user.click(screen.getAllByRole('button', { name: 'Add item' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Add new item' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Keep adding' }));
    for (let i = 0; i < 2; i += 1) {
      await user.type(within(dialog).getByLabelText(/item name/i), 'Bike');
      await user.click(within(dialog).getByRole('button', { name: 'Add to list' }));
      await waitFor(() => expect(postKeys).toHaveLength(i + 1));
      await waitFor(() => expect(within(dialog).getByLabelText(/item name/i)).toHaveValue(''));
    }

    // Two of the same name, on purpose: two items, not one answered twice.
    expect(postKeys[1]).not.toBe(postKeys[0]);
    await waitFor(() => expect(articles('Bike')).toHaveLength(2));
  });

  it('gives a dialog opened afresh a new key', async () => {
    losePosts = 1;
    const user = userEvent.setup();
    await open();

    await user.click(screen.getAllByRole('button', { name: 'Add item' })[0]);
    let dialog = await screen.findByRole('dialog', { name: 'Add new item' });
    await user.type(within(dialog).getByLabelText(/item name/i), 'Bike');
    await user.click(within(dialog).getByRole('button', { name: 'Add to list' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(REQUEST_TIMEOUT_MESSAGE, 'error'));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    const discard = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    await user.click(within(discard).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add new item' })).toBeNull());

    await user.click(screen.getAllByRole('button', { name: 'Add item' })[0]);
    dialog = await screen.findByRole('dialog', { name: 'Add new item' });
    await user.type(within(dialog).getByLabelText(/item name/i), 'Bike');
    await user.click(within(dialog).getByRole('button', { name: 'Add to list' }));
    await waitFor(() => expect(postKeys).toHaveLength(2));
    expect(postKeys[1]).not.toBe(postKeys[0]);
  });
});

describe('a retried proposal (WIS-158)', () => {
  // regression: a member can't delete their own proposal, so a retried one
  // left the owners two to review.
  it('sends the retry with the same key and lists the proposal once', async () => {
    userRole = 'member';
    losePosts = 1;
    const user = userEvent.setup();
    await open();

    await user.click(screen.getAllByRole('button', { name: /^Propose/ })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Propose new item' });
    await user.type(within(dialog).getByLabelText(/item name/i), 'Kite');
    await user.click(within(dialog).getByRole('button', { name: 'Propose' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(REQUEST_TIMEOUT_MESSAGE, 'error'));

    await user.click(within(dialog).getByRole('button', { name: 'Propose' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Propose new item' })).toBeNull()
    );

    expect(postKeys).toHaveLength(2);
    expect(postKeys[1]).toBe(postKeys[0]);
    expect(listItems.filter((i) => i.name === 'Kite')).toHaveLength(1);
    await waitFor(() => expect(articles('Kite')).toHaveLength(1));
  });
});

describe('a retried delete (WIS-158)', () => {
  // regression: a delete whose first attempt went through got "Item not
  // found" as an error on its retry, and the Edit dialog stayed open.
  it('takes a 404 as already deleted: closes the dialog and drops the item, with no error', async () => {
    deleteAnswer = 404;
    const user = userEvent.setup();
    await open();

    const card = screen.getByRole('article', { name: 'Item: Lamp' });
    await user.click(within(card).getByRole('button', { name: 'Edit item' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit item' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete item' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Delete item' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit item' })).toBeNull());
    expect(articles('Lamp')).toHaveLength(0);
    expect(showToast.mock.calls.filter(([, type]) => type === 'error')).toEqual([]);
  });
});
