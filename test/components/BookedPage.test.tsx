// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { push, showToast } = vi.hoisted(() => ({ push: vi.fn(), showToast: vi.fn() }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// The header has its own fetches and tests; this file is about the page's cards.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));

vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import BookedPage from '@/app/booked/page';

const reservation = {
  itemImage: null,
  itemPrice: null,
  wishlistName: 'Birthday',
  wishlistId: 'w1',
  wishlistSlug: 'birthday',
};

const reservations = [
  // Still reserved, so it renders under "To give".
  {
    ...reservation,
    _id: 'res-lego',
    itemName: 'Lego set',
    itemStatus: 'booked',
    stillReserved: true,
  },
  // Detached from its item, so it renders under "Needs your confirmation".
  {
    ...reservation,
    _id: 'res-scarf',
    itemName: 'Scarf',
    itemStatus: 'deleted',
    stillReserved: false,
  },
];

const gift = {
  itemImage: null,
  itemPrice: null,
  recipientUsername: 'alice',
  wishlistName: 'Birthday',
  wishlistId: 'w1',
  wishlistSlug: 'birthday',
  giftedAt: '2026-01-01T00:00:00.000Z',
};

const gifts = [
  { ...gift, _id: 'gift-book', itemName: 'Cookbook' },
  { ...gift, _id: 'gift-mug', itemName: 'Mug' },
];

/** A JSON answer, or a network failure. */
type Reply = { status: number; body: unknown } | Error;

const ok: Reply = { status: 200, body: { success: true } };
const failed = (error: string): Reply => ({ status: 500, body: { success: false, error } });

/**
 * Serves both lists, and holds every action (POST / DELETE) open until the test
 * settles it with `answer`, so several cards can be in flight at once.
 */
function mockHeldFetch() {
  const held = new Map<string, ((reply: Reply) => void)[]>();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      if (url === '/api/users/me/reservations') {
        return { ok: true, status: 200, json: async () => ({ success: true, data: reservations }) };
      }
      if (url === '/api/users/me/gifts') {
        return { ok: true, status: 200, json: async () => ({ success: true, data: gifts }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    }
    const key = `${method} ${url}`;
    const reply = await new Promise<Reply>((resolve) =>
      held.set(key, [...(held.get(key) ?? []), resolve])
    );
    if (reply instanceof Error) throw reply;
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
  });
  vi.stubGlobal('fetch', fetchMock);

  return {
    /** How many requests the page has sent for this action, settled or not. */
    sent: (key: string) =>
      fetchMock.mock.calls.filter(([url, init]) => `${init?.method ?? 'GET'} ${url}` === key)
        .length,
    /** Settles this action's request, which must be the only one in flight for it. */
    answer: async (key: string, reply: Reply) => {
      const pending = held.get(key) ?? [];
      if (pending.length !== 1) {
        throw new Error(`expected 1 request in flight for ${key}, found ${pending.length}`);
      }
      held.delete(key);
      await act(async () => pending[0](reply));
    },
  };
}

const markGiftedKey = (id: string) => `POST /api/reservations/${id}/gift`;
const dismissKey = (id: string) => `DELETE /api/reservations/${id}`;
const deleteGiftKey = (id: string) => `DELETE /api/gifts/${id}`;

/** The "Mark as gifted" and "Dismiss" buttons on the reservation card for `itemName`. */
function reservationButtons(itemName: string) {
  // The card is the nearest ancestor of its name that holds its buttons.
  let card: HTMLElement | null = screen.getByText(itemName);
  while (card && !within(card).queryByRole('button', { name: 'Mark as gifted' })) {
    card = card.parentElement;
  }
  const scope = within(card!);
  return {
    gift: scope.getByRole('button', { name: 'Mark as gifted' }),
    dismiss: scope.getByRole('button', { name: 'Dismiss' }),
  };
}

/** The delete button on the gift-history row for `itemName`. */
function deleteGiftButton(itemName: string) {
  return within(screen.getByText(itemName).closest('li')!).getByRole('button', {
    name: 'Delete from gift history',
  });
}

/** Clicks a card's button, then the confirm button of the dialog it opens. */
function clickAndConfirm(button: HTMLElement, confirmText: string) {
  fireEvent.click(button);
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: confirmText })
  );
}

const markGifted = (itemName: string) =>
  clickAndConfirm(reservationButtons(itemName).gift, 'Mark as gifted');
const dismiss = (itemName: string) =>
  clickAndConfirm(reservationButtons(itemName).dismiss, 'Remove');
const deleteGift = (itemName: string) => clickAndConfirm(deleteGiftButton(itemName), 'Delete');

function expectReservationDisabled(itemName: string) {
  const buttons = reservationButtons(itemName);
  expect(buttons.gift).toBeDisabled();
  expect(buttons.dismiss).toBeDisabled();
}
function expectReservationEnabled(itemName: string) {
  const buttons = reservationButtons(itemName);
  expect(buttons.gift).toBeEnabled();
  expect(buttons.dismiss).toBeEnabled();
}

async function renderHeld() {
  const held = mockHeldFetch();
  render(<BookedPage />);
  await screen.findByText('Lego set');
  return held;
}

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => {
  cleanup();
  push.mockReset();
  showToast.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BookedPage — acting on several cards at once', () => {
  // regression: the page tracked one busy id for all its cards, so acting on
  // card B while A's request was in flight re-enabled A's buttons, and whichever
  // request settled first re-enabled every card. A could then be acted on twice:
  // marked as gifted twice (the second POST 404'd into "Reservation not found"),
  // or marked as gifted and dismissed, sending two conflicting requests.
  it("regression: acting on B while A's request is in flight leaves A disabled", async () => {
    const { answer, sent } = await renderHeld();

    markGifted('Lego set');
    expectReservationDisabled('Lego set');

    dismiss('Scarf');
    expectReservationDisabled('Lego set');
    expectReservationDisabled('Scarf');

    // A's disabled buttons open no second dialog, so nothing more goes out for A.
    fireEvent.click(reservationButtons('Lego set').gift);
    fireEvent.click(reservationButtons('Lego set').dismiss);
    expect(screen.queryByRole('alertdialog')).toBeNull();

    // B settling first doesn't unlock A either...
    await answer(dismissKey('res-scarf'), ok);
    await waitFor(() => expect(screen.queryByText('Scarf')).toBeNull());
    expectReservationDisabled('Lego set');

    // ...only A's own request does.
    await answer(markGiftedKey('res-lego'), failed('Failed to log gift'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to log gift', 'error'));
    expectReservationEnabled('Lego set');
    expect(sent(markGiftedKey('res-lego'))).toBe(1);
    expect(sent(dismissKey('res-lego'))).toBe(0);
  });

  it('re-enables only the card whose request failed', async () => {
    const { answer } = await renderHeld();

    dismiss('Lego set');
    markGifted('Scarf');

    await answer(dismissKey('res-lego'), new TypeError('Failed to fetch'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Something went wrong', 'error'));
    expectReservationEnabled('Lego set');
    expectReservationDisabled('Scarf');

    await answer(markGiftedKey('res-scarf'), ok);
    await waitFor(() => expect(screen.queryByText('Scarf')).toBeNull());
    expect(showToast).toHaveBeenCalledWith('Added to your gift history', 'success');
    expectReservationEnabled('Lego set');
  });

  it('removes only the card whose request succeeded', async () => {
    const { answer } = await renderHeld();

    markGifted('Lego set');
    dismiss('Scarf');

    await answer(markGiftedKey('res-lego'), ok);
    await waitFor(() => expect(screen.queryByText('Lego set')).toBeNull());
    expectReservationDisabled('Scarf');

    await answer(dismissKey('res-scarf'), failed('Failed to remove reservation'));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Failed to remove reservation', 'error')
    );
    expectReservationEnabled('Scarf');
    expect(screen.queryByText('Lego set')).toBeNull();
  });

  it("keeps a gift-history entry's delete disabled until its own request settles", async () => {
    const { answer, sent } = await renderHeld();

    deleteGift('Cookbook');
    deleteGift('Mug');
    // A reservation's request is tracked alongside the gift-history ones.
    markGifted('Lego set');
    expect(deleteGiftButton('Cookbook')).toBeDisabled();
    expect(deleteGiftButton('Mug')).toBeDisabled();

    await answer(deleteGiftKey('gift-mug'), ok);
    await waitFor(() => expect(screen.queryByText('Mug')).toBeNull());
    expect(deleteGiftButton('Cookbook')).toBeDisabled();
    expectReservationDisabled('Lego set');

    await answer(deleteGiftKey('gift-book'), failed('Failed to delete gift'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to delete gift', 'error'));
    expect(deleteGiftButton('Cookbook')).toBeEnabled();
    expectReservationDisabled('Lego set');
    expect(sent(deleteGiftKey('gift-book'))).toBe(1);

    await answer(markGiftedKey('res-lego'), failed('Failed to log gift'));
    await waitFor(() => expectReservationEnabled('Lego set'));
  });
});

describe('BookedPage — keyboard focus in a confirmation', () => {
  // regression: nothing kept Tab inside a confirmation, so with "Mark as
  // gifted?" open for a card, Tab reached the same card's Dismiss button behind
  // the backdrop, and Enter opened "Remove from reservations?" on top of it.
  // Confirming both sent two conflicting requests for one reservation.
  it("regression: Tab and Shift+Tab never reach the cards behind an open confirmation", async () => {
    const user = userEvent.setup();
    const { sent } = await renderHeld();
    const lego = reservationButtons('Lego set');

    await user.click(lego.gift);
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    // More presses than there are buttons on the page, in each direction.
    const presses = screen.getAllByRole('button').length + 1;
    for (const shift of [false, true]) {
      for (let i = 0; i < presses; i++) {
        await user.tab({ shift });
        expect(dialog).toContainElement(document.activeElement as HTMLElement);
      }
    }
    expect(lego.dismiss).not.toHaveFocus();

    // Closing it hands focus back to the card's button that opened it.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(lego.gift).toHaveFocus();
    expect(sent(markGiftedKey('res-lego'))).toBe(0);
    expect(sent(dismissKey('res-lego'))).toBe(0);
  });
});
