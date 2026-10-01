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

/** The gift-history entries "Mark as gifted" writes for each reservation. */
const legoGift = {
  ...gift,
  _id: 'gift-lego',
  itemName: 'Lego set',
  giftedAt: '2026-10-01T10:00:00.000Z',
};
const scarfGift = {
  ...gift,
  _id: 'gift-scarf',
  itemName: 'Scarf',
  giftedAt: '2026-10-01T10:05:00.000Z',
};

/** A JSON answer, a non-JSON one (`html`), or a network failure. */
type Reply = { status: number; body: unknown } | { status: number; html: true } | Error;

const ok: Reply = { status: 200, body: { success: true } };
/** The gift route's answer: the gift-history entry it wrote. */
const gifted = (entry: typeof legoGift): Reply => ({
  status: 201,
  body: { success: true, data: entry },
});
const failed = (error: string): Reply => ({ status: 500, body: { success: false, error } });
/** The route's own answer for a reservation or gift-history entry that's gone. */
const notFound = (error: string): Reply => ({ status: 404, body: { success: false, error } });

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
    const json =
      'html' in reply
        ? async () => {
            throw new SyntaxError('Unexpected token <');
          }
        : async () => reply.body;
    return { ok: reply.status < 400, status: reply.status, json };
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

/**
 * The name on the reservation card for `itemName`, or null once the card is off
 * the page. Its gift-history row, once it's gifted, doesn't count.
 */
const cardName = (itemName: string) =>
  screen.queryAllByText(itemName).find((el) => !el.closest('li')) ?? null;

/** The item names in the gift history (the page's only list), top to bottom. */
const historyNames = () =>
  within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((row) => row.querySelector('p')?.textContent);

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

    await answer(markGiftedKey('res-scarf'), gifted(scarfGift));
    await waitFor(() => expect(cardName('Scarf')).toBeNull());
    expect(showToast).toHaveBeenCalledWith('Added to your gift history', 'success');
    expectReservationEnabled('Lego set');
  });

  it('removes only the card whose request succeeded', async () => {
    const { answer } = await renderHeld();

    markGifted('Lego set');
    dismiss('Scarf');

    await answer(markGiftedKey('res-lego'), gifted(legoGift));
    await waitFor(() => expect(cardName('Lego set')).toBeNull());
    expectReservationDisabled('Scarf');

    await answer(dismissKey('res-scarf'), failed('Failed to remove reservation'));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Failed to remove reservation', 'error')
    );
    expectReservationEnabled('Scarf');
    expect(cardName('Lego set')).toBeNull();
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

  // regression: only the card's disabled buttons kept a second action off a busy
  // card; the actions themselves didn't check. With two confirmations open for
  // one card (Tab could leave the first for the card's other button before
  // WIS-116), confirming both sent a gift and a dismiss for one reservation, and
  // whichever settled first re-enabled the card while the other was in flight.
  it('regression: ignores a second action confirmed for a card whose first is in flight', async () => {
    const { answer, sent } = await renderHeld();
    const lego = reservationButtons('Lego set');

    // Both confirmations for one card, opened before either is confirmed.
    fireEvent.click(lego.gift);
    fireEvent.click(lego.dismiss);
    const confirm = (title: string, confirmText: string) =>
      fireEvent.click(
        within(screen.getByRole('alertdialog', { name: title })).getByRole('button', {
          name: confirmText,
        })
      );

    confirm('Mark as gifted?', 'Mark as gifted');
    expectReservationDisabled('Lego set');
    confirm('Remove from reservations?', 'Remove');
    expect(screen.queryByRole('alertdialog')).toBeNull();

    expect(sent(markGiftedKey('res-lego'))).toBe(1);
    expect(sent(dismissKey('res-lego'))).toBe(0);
    expectReservationDisabled('Lego set');

    await answer(markGiftedKey('res-lego'), failed('Failed to log gift'));
    await waitFor(() => expectReservationEnabled('Lego set'));
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(sent(dismissKey('res-lego'))).toBe(0);
  });
});

describe('BookedPage — gift history while actions settle', () => {
  // regression: a successful "Mark as gifted" re-read the whole gift history
  // and replaced the page's copy with the answer, unordered against anything
  // else settling on the list. A re-read the server answered before a
  // concurrent delete was saved, landing after that delete's success (here,
  // the history as the page loaded it), put the deleted entry back, and
  // deleting it again answered "Gift entry not found".
  it('regression: an entry deleted while "Mark as gifted" is in flight stays deleted', async () => {
    const { answer } = await renderHeld();

    markGifted('Lego set');
    deleteGift('Cookbook');

    await answer(deleteGiftKey('gift-book'), ok);
    await waitFor(() => expect(screen.queryByText('Cookbook')).toBeNull());

    await answer(markGiftedKey('res-lego'), gifted(legoGift));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Added to your gift history', 'success')
    );
    expect(cardName('Lego set')).toBeNull();
    expect(historyNames()).toEqual(['Lego set', 'Mug']);
  });

  // regression: the same whole-list re-read, done by each of two "Mark as
  // gifted" requests, let the one answering last overwrite the other's: a
  // re-read built before the newer gift was logged dropped it from the history,
  // though its toast had said "Added to your gift history".
  it('regression: keeps both gifts, newest first, when two "Mark as gifted" answers arrive out of order', async () => {
    const { answer } = await renderHeld();

    markGifted('Lego set');
    markGifted('Scarf');

    // The Scarf entry is the newer one, and its answer lands first.
    await answer(markGiftedKey('res-scarf'), gifted(scarfGift));
    await waitFor(() => expect(historyNames()).toEqual(['Scarf', 'Cookbook', 'Mug']));

    await answer(markGiftedKey('res-lego'), gifted(legoGift));
    await waitFor(() => expect(cardName('Lego set')).toBeNull());
    expect(historyNames()).toEqual(['Scarf', 'Lego set', 'Cookbook', 'Mug']);
    expect(showToast).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenNthCalledWith(2, 'Added to your gift history', 'success');
  });
});

/** Each card action, with the route's 404 for it and what the page says then. */
const cardActions = [
  {
    action: 'Mark as gifted',
    run: () => markGifted('Lego set'),
    key: markGiftedKey('res-lego'),
    itemName: 'Lego set',
    neighbour: 'Scarf',
    gone: notFound('Reservation not found'),
    goneToast: 'This reservation no longer exists',
    expectEnabled: () => expectReservationEnabled('Lego set'),
  },
  {
    action: 'Dismiss',
    run: () => dismiss('Scarf'),
    key: dismissKey('res-scarf'),
    itemName: 'Scarf',
    neighbour: 'Lego set',
    gone: notFound('Reservation not found'),
    goneToast: 'This reservation no longer exists',
    expectEnabled: () => expectReservationEnabled('Scarf'),
  },
  {
    action: 'Delete from gift history',
    run: () => deleteGift('Cookbook'),
    key: deleteGiftKey('gift-book'),
    itemName: 'Cookbook',
    neighbour: 'Mug',
    gone: notFound('Gift entry not found'),
    goneToast: 'This gift is no longer in your history',
    expectEnabled: () => expect(deleteGiftButton('Cookbook')).toBeEnabled(),
  },
];

describe('BookedPage — a reservation or gift that no longer exists', () => {
  // regression: a 404 from the gift, dismiss or gift-delete route (the record
  // was already gifted, dismissed or deleted in another tab or on another
  // device, or the reservation was cleared when the user became an owner of the
  // list) was shown as an error toast and the card stayed, so every retry 404'd
  // again until a reload.
  it.each(cardActions)(
    'regression: drops the card with an info toast when $action gets a 404',
    async ({ run, key, itemName, neighbour, gone, goneToast }) => {
      const { answer, sent } = await renderHeld();

      run();
      await answer(key, gone);

      await waitFor(() => expect(screen.queryByText(itemName)).toBeNull());
      expect(screen.getByText(neighbour)).toBeInTheDocument();
      expect(showToast).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledWith(goneToast, 'info');
      expect(sent(key)).toBe(1);
    }
  );

  it('drops a card whose reservation is gone while another is still in flight', async () => {
    const { answer } = await renderHeld();

    markGifted('Lego set');
    dismiss('Scarf');

    await answer(markGiftedKey('res-lego'), notFound('Reservation not found'));
    await waitFor(() => expect(screen.queryByText('Lego set')).toBeNull());
    expectReservationDisabled('Scarf');

    await answer(dismissKey('res-scarf'), failed('Failed to dismiss reservation'));
    await waitFor(() => expectReservationEnabled('Scarf'));
    expect(screen.queryByText('Lego set')).toBeNull();
  });
});

describe('BookedPage — failures worth retrying keep the card', () => {
  // Only the route's own JSON 404 means the record is gone; an HTML 404 from the
  // platform says nothing about it.
  const failures: { failure: string; reply: Reply; toast: string }[] = [
    {
      failure: 'a 429',
      reply: { status: 429, body: { success: false, error: 'Too many requests' } },
      toast: 'Too many requests',
    },
    { failure: 'a 500', reply: failed('Server error'), toast: 'Server error' },
    {
      failure: 'a 404 that is not JSON',
      reply: { status: 404, html: true },
      toast: 'Something went wrong',
    },
    {
      failure: 'a network error',
      reply: new TypeError('Failed to fetch'),
      toast: 'Something went wrong',
    },
  ];

  it.each(cardActions.flatMap((a) => failures.map((f) => ({ ...a, ...f }))))(
    'keeps the card and re-enables it when $action gets $failure',
    async ({ run, key, itemName, reply, toast, expectEnabled }) => {
      const { answer } = await renderHeld();

      run();
      await answer(key, reply);

      await waitFor(() => expect(showToast).toHaveBeenCalledWith(toast, 'error'));
      expect(screen.getByText(itemName)).toBeInTheDocument();
      // Re-enabled, so the user can try again.
      await waitFor(expectEnabled);
      expect(showToast).not.toHaveBeenCalledWith(expect.anything(), 'info');
    }
  );
});

describe('BookedPage — keyboard focus in a confirmation', () => {
  // regression: nothing kept Tab inside a confirmation, so with "Mark as
  // gifted?" open for a card, Tab reached the same card's Dismiss button behind
  // the backdrop, and Enter opened "Remove from reservations?" on top of it.
  // Confirming both sent two conflicting requests for one reservation.
  it('regression: Tab and Shift+Tab never reach the cards behind an open confirmation', async () => {
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

  it("hands focus back to the card's button once a failed request re-enables it", async () => {
    const user = userEvent.setup();
    const { answer } = await renderHeld();
    const lego = reservationButtons('Lego set');

    await user.click(lego.gift);
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Mark as gifted' })
    );
    // The confirmation is gone and the card's buttons are disabled while its
    // request runs, so focus has nowhere to go yet.
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expectReservationDisabled('Lego set');
    expect(document.body).toHaveFocus();

    await answer(markGiftedKey('res-lego'), failed('Failed to log gift'));
    await waitFor(() => expect(lego.gift).toHaveFocus());
  });
});
