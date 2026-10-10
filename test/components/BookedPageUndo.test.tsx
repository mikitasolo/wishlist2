// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';

// WIS-387: the Reserved page's Release, Dismiss, Leave group gift and Delete
// from gift history ask nothing. The card goes at once with an Undo toast, and
// the request goes out only once the Undo window has passed: Undo sends
// nothing at all, so nothing is released, removed or withdrawn.

const { showToast, dismissToast } = vi.hoisted(() => ({
  showToast: vi.fn(),
  dismissToast: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'me', defaultCurrency: 'USD' } },
    status: 'authenticated',
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast, dismissToast }) }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import BookedPage from '@/app/booked/page';
import { flushUndoableActions } from '@/lib/hooks/useUndoableAction';
import { UNDO_WINDOW_MS } from '@/lib/utils/deferredCommit';

const base = {
  itemImage: null,
  itemPrice: null,
  wishlistName: 'Birthday',
  wishlistId: 'w1',
  wishlistSlug: 'birthday',
  listOpen: true,
  listArchived: false,
};
const lego = {
  ...base,
  _id: 'res-lego',
  itemId: 'item-lego',
  itemName: 'Lego set',
  itemStatus: 'booked',
  stillReserved: true,
};
const scarf = {
  ...base,
  _id: 'res-scarf',
  itemId: 'item-scarf',
  itemName: 'Scarf',
  itemStatus: 'deleted',
  stillReserved: false,
};
// The last one in a group gift they organize.
const kite = {
  ...base,
  _id: 'res-kite',
  itemId: 'item-kite',
  itemName: 'Kite',
  itemStatus: 'booked',
  stillReserved: true,
  pledge: { value: 2000, currency: 'USD' },
  groupGift: {
    contributing: true as const,
    organizer: true,
    status: 'open' as const,
    target: { value: 5000, currency: 'USD' },
    pledgedTotal: 2000,
    percentFunded: 40,
    contributors: [{ name: 'Me', pledged: 2000, organizer: true, you: true }],
  },
};
const cookbook = {
  itemImage: null,
  itemPrice: null,
  recipientUsername: 'alice',
  wishlistName: 'Birthday',
  wishlistId: 'w1',
  giftedAt: '2026-01-01T00:00:00.000Z',
  _id: 'gift-book',
  itemName: 'Cookbook',
};

const reply = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

let actionStatus: number;
let fetchMock: ReturnType<typeof vi.fn>;
const actions = () =>
  fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') !== 'GET') as [
    string,
    RequestInit,
  ][];

function mockFetch() {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url === '/api/users/me/reservations')
      return reply(200, { success: true, data: [lego, scarf, kite] });
    if (method === 'GET' && url === '/api/users/me/gifts')
      return reply(200, { success: true, data: [cookbook] });
    if (method === 'GET') return reply(200, { success: true, data: { rates: { USD: 1 } } });
    return actionStatus < 400
      ? reply(actionStatus, { success: true, data: {} })
      : reply(actionStatus, { success: false, error: 'Something broke' });
  });
  vi.stubGlobal('fetch', fetchMock);
}

const card = (name: string) => screen.queryByRole('article', { name });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** The Undo toast's last call: its line and its button. */
function lastUndoToast() {
  const call = [...showToast.mock.calls]
    .reverse()
    .find(([, , options]) => options?.action?.label === 'Undo');
  if (!call) throw new Error('no Undo toast');
  return { message: call[0] as string, undo: () => act(() => call[2].action.onClick()) };
}

function release() {
  fireEvent.click(within(card('Lego set')!).getByRole('button', { name: 'More actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Release' }));
}
const dismiss = () =>
  fireEvent.click(within(card('Scarf')!).getByRole('button', { name: 'Dismiss' }));
function leave() {
  fireEvent.click(within(card('Kite')!).getByRole('button', { name: 'More actions' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Leave group gift' }));
}
const deleteGift = () =>
  fireEvent.click(
    within(screen.getByText('Cookbook').closest('li')!).getByRole('button', {
      name: 'Delete from gift history',
    })
  );

const cases = [
  {
    action: 'Release',
    run: release,
    shown: () => card('Lego set'),
    message: 'Released. Others on the list can reserve it now.',
    url: '/api/items/item-lego',
    method: 'PATCH',
  },
  {
    action: 'Dismiss',
    run: dismiss,
    shown: () => card('Scarf'),
    message: 'Removed from your reservations',
    url: '/api/reservations/res-scarf',
    method: 'DELETE',
  },
  {
    action: 'Leave group gift',
    run: leave,
    shown: () => card('Kite'),
    message: 'You left the group gift. It ends, and others on the list can reserve the item.',
    url: '/api/items/item-kite/group-gift/me',
    method: 'DELETE',
  },
  {
    action: 'Delete from gift history',
    run: deleteGift,
    shown: () => screen.queryByText('Cookbook'),
    message: 'Removed from your gift history',
    url: '/api/gifts/gift-book',
    method: 'DELETE',
  },
];

async function renderPage() {
  mockFetch();
  render(<BookedPage />);
  await screen.findByText('Lego set');
  vi.useFakeTimers();
}

beforeEach(() => {
  cleanup();
  showToast.mockReset();
  showToast.mockReturnValue('toast-1');
  dismissToast.mockReset();
  actionStatus = 200;
});
afterEach(() => {
  // Nothing left waiting for the next test.
  flushUndoableActions();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('BookedPage — Undo instead of a confirmation (WIS-387)', () => {
  it.each(cases)(
    '$action takes it off at once and sends once the Undo window has passed',
    async ({ run, shown, message, url, method }) => {
      await renderPage();
      run();
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(shown()).toBeNull();
      expect(lastUndoToast().message).toBe(message);

      await advance(UNDO_WINDOW_MS - 1);
      expect(actions()).toEqual([]);

      await advance(1);
      expect(actions()).toEqual([[url, expect.objectContaining({ method, keepalive: false })]]);
      await advance(0);
      expect(shown()).toBeNull();
      // Its toast goes once the request has: Undo means nothing any more.
      expect(dismissToast).toHaveBeenCalledWith('toast-1');
      // The Undo toast said it; no second success toast.
      expect(showToast).toHaveBeenCalledTimes(1);
    }
  );

  it.each(cases)('Undo on $action sends nothing and puts it back', async ({ run, shown }) => {
    await renderPage();
    run();
    expect(shown()).toBeNull();
    lastUndoToast().undo();
    await advance(0);
    expect(shown()).not.toBeNull();
    await advance(UNDO_WINDOW_MS * 2);
    expect(actions()).toEqual([]);
    expect(shown()).not.toBeNull();
  });

  it.each(cases)('$action failing once sent puts it back and says so', async ({ run, shown }) => {
    actionStatus = 500;
    await renderPage();
    run();
    await advance(UNDO_WINDOW_MS);
    expect(actions()).toHaveLength(1);
    await advance(0);
    expect(shown()).not.toBeNull();
    expect(showToast).toHaveBeenCalledWith('Something broke', 'error');
  });

  it('a card whose Undo is offered stays off through a read that still lists it', async () => {
    await renderPage();
    dismiss();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await advance(0);
    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/users/me/reservations')
    ).toHaveLength(2);
    expect(card('Scarf')).toBeNull();
    // Undo still brings it back, as the read left it.
    lastUndoToast().undo();
    await advance(0);
    expect(card('Scarf')).not.toBeNull();
    expect(actions()).toEqual([]);
  });

  it('leaving the page sends what is waiting at once, with keepalive', async () => {
    await renderPage();
    dismiss();
    deleteGift();
    expect(actions()).toEqual([]);
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(actions()).toEqual([
      ['/api/reservations/res-scarf', expect.objectContaining({ keepalive: true })],
      ['/api/gifts/gift-book', expect.objectContaining({ keepalive: true })],
    ]);
    // Sent once only: the window passing later sends nothing more.
    await advance(UNDO_WINDOW_MS);
    expect(actions()).toHaveLength(2);
  });

  it('an organizer leaving is told who takes over', async () => {
    const { leftGroupGiftMessage } = await import('@/app/booked/useReservedData');
    const contributors = [
      { name: 'Me', pledged: 2000, organizer: true, you: true },
      { name: 'Ben Helper', pledged: 1000, organizer: false, you: false },
    ];
    expect(leftGroupGiftMessage({ ...kite.groupGift, contributors })).toBe(
      'You left the group gift. Ben Helper becomes the organizer.'
    );
    expect(leftGroupGiftMessage({ ...kite.groupGift, organizer: false, contributors })).toBe(
      'You left the group gift'
    );
  });
});
