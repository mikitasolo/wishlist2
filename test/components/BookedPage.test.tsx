// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { push, showToast, signedIn } = vi.hoisted(() => ({
  push: vi.fn(),
  showToast: vi.fn(),
  // Mutable, so a test can sign another account in while the page is open.
  signedIn: { userId: 'me' },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: signedIn.userId } }, status: 'authenticated' }),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// The header has its own fetches and tests; this file is about the page's cards.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));

vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import BookedPage from '@/app/booked/page';
import type { Occasion } from '@/lib/utils/occasion';
import { ITEM_REQUEST_TIMEOUT_MS } from '@/lib/utils/requestTimeout';

const reservation = {
  itemImage: null,
  itemPrice: null as { value: number; currency: string } | null,
  wishlistName: 'Birthday',
  wishlistId: 'w1',
  wishlistSlug: 'birthday',
  listOpen: true,
};

const reservations = [
  // Still reserved, so it renders under "To give".
  {
    ...reservation,
    _id: 'res-lego',
    itemId: 'item-lego',
    itemName: 'Lego set',
    itemStatus: 'booked',
    stillReserved: true,
  },
  // Detached from its item, so it renders under "Needs your confirmation".
  {
    ...reservation,
    _id: 'res-scarf',
    itemId: 'item-scarf',
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

type Reservation = Omit<(typeof reservations)[number], 'wishlistSlug'> & {
  /** `null` for a list the gifter can no longer open, as the read has it. */
  wishlistSlug: string | null;
  wishlistOccasion?: Occasion | null;
};
type Gift = typeof legoGift;

/** A JSON answer, a non-JSON one (`html`), or a network failure. */
type Reply = { status: number; body: unknown } | { status: number; html: true } | Error;

const ok: Reply = { status: 200, body: { success: true } };
/** The gift route's answer: the gift-history entry it wrote. */
const gifted = (entry: Gift): Reply => ({
  status: 201,
  body: { success: true, data: entry },
});
const failed = (error: string): Reply => ({ status: 500, body: { success: false, error } });
/** The route's own answer for a reservation or gift-history entry that's gone. */
const notFound = (error: string): Reply => ({ status: 404, body: { success: false, error } });
/** A list route's answer. */
const listed = (data: unknown[]): Reply => ({ status: 200, body: { success: true, data } });

/** What one read of the page's two lists is answered with. */
interface Lists {
  reservations: Reply;
  gifts: Reply;
}

const newestFirst = (a: Gift, b: Gift) => Date.parse(b.giftedAt) - Date.parse(a.giftedAt);

function toResponse(reply: Reply) {
  if (reply instanceof Error) throw reply;
  const json =
    'html' in reply
      ? async () => {
          throw new SyntaxError('Unexpected token <');
        }
      : async () => reply.body;
  return { ok: reply.status < 400, status: reply.status, json };
}

/**
 * A fake server holding the user's reservations and gift history, which serves
 * both lists as they stand, and holds every action (POST / DELETE) open until
 * the test settles it with `answer`, so several cards can be in flight at once.
 * An action settled with a success, or with the route's own 404, is saved as
 * the route would save it, so the lists read afterwards reflect it. The test
 * can change the lists itself too (`server`), as another tab or device would.
 *
 * With `holdReads`, every read of the lists is held as well, until the test
 * answers it with `answerRead`: with the lists as they stand then, or with
 * any it gives (an older `snapshot()`, say, for a read the server answered
 * before a change was saved).
 */
function mockHeldFetch({
  holdReads = false,
  initial = reservations,
}: { holdReads?: boolean; initial?: Reservation[] } = {}) {
  const lists = { reservations: [...initial], gifts: [...gifts] };
  const server = {
    /** Both lists as the server holds them right now. */
    snapshot: (): Lists => ({
      reservations: listed([...lists.reservations]),
      gifts: listed([...lists.gifts]),
    }),
    /** A reservation is gifted elsewhere: it goes, and `entry` joins the history. */
    gift(reservationId: string, entry: Gift) {
      lists.reservations = lists.reservations.filter((r) => r._id !== reservationId);
      lists.gifts = [entry, ...lists.gifts].sort(newestFirst);
    },
    /** A reservation is dismissed, or released, elsewhere. */
    dropReservation(id: string) {
      lists.reservations = lists.reservations.filter((r) => r._id !== id);
    },
    /**
     * A reservation's item stops being booked by the gifter (an owner's status
     * change, someone else's booking after they left, the list archived): the
     * reservation stays, needing their confirmation.
     */
    detach(id: string, itemStatus: string) {
      lists.reservations = lists.reservations.map((r) =>
        r._id === id ? { ...r, itemStatus, stillReserved: false } : r
      );
    },
    /**
     * The gifter can no longer open a reservation's list (it was archived,
     * say), while the item is still booked by them: the read has no slug or
     * occasion for it, and says only that it isn't open to them.
     */
    closeList(id: string) {
      lists.reservations = lists.reservations.map((r) =>
        r._id === id ? { ...r, listOpen: false, wishlistSlug: null, wishlistOccasion: null } : r
      );
    },
    /** A gift-history entry is deleted elsewhere. */
    dropGift(id: string) {
      lists.gifts = lists.gifts.filter((g) => g._id !== id);
    },
    /** A gift is reserved elsewhere. */
    reserve(entry: Reservation) {
      lists.reservations = [entry, ...lists.reservations];
    },
    /** An owner changes or clears a list's occasion. */
    setOccasion(wishlistId: string, wishlistOccasion: Occasion | null) {
      lists.reservations = lists.reservations.map((r) =>
        r.wishlistId === wishlistId ? { ...r, wishlistOccasion } : r
      );
    },
  };

  /** Saves an action the way its route would, once it has answered `reply`. */
  function save(key: string, reply: Reply) {
    if (reply instanceof Error || !('body' in reply)) return;
    const [method, url] = key.split(' ');
    const id = url.split('/')[3];
    // Release: the item route's unbook. Its success ends the reservation of
    // that item; it refuses (or fails) without touching it.
    if (url.startsWith('/api/items/')) {
      if (reply.status === 200) {
        lists.reservations = lists.reservations.filter((r) => r.itemId !== id);
      }
      return;
    }
    if (reply.status >= 400 && reply.status !== 404) return;
    if (url.startsWith('/api/gifts/')) server.dropGift(id);
    else if (method === 'POST' && reply.status === 201) {
      server.gift(id, (reply.body as { data: Gift }).data);
    } else server.dropReservation(id);
  }

  const held = new Map<string, ((reply: Reply) => void)[]>();
  const heldReads: Record<'reservations' | 'gifts', ((reply: Reply) => void)[]> = {
    reservations: [],
    gifts: [],
  };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      const list =
        url === '/api/users/me/reservations'
          ? 'reservations'
          : url === '/api/users/me/gifts'
            ? 'gifts'
            : null;
      if (!list) throw new Error(`unexpected fetch ${url}`);
      if (!holdReads) return toResponse(server.snapshot()[list]);
      return toResponse(await new Promise<Reply>((resolve) => heldReads[list].push(resolve)));
    }
    const key = `${method} ${url}`;
    const reply = await new Promise<Reply>((resolve) =>
      held.set(key, [...(held.get(key) ?? []), resolve])
    );
    save(key, reply);
    return toResponse(reply);
  });
  vi.stubGlobal('fetch', fetchMock);

  return {
    server,
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
    /** How many times the page has read its lists, counting the first load. */
    reads: () =>
      fetchMock.mock.calls.filter(([url]) => url === '/api/users/me/reservations').length,
    /** Answers the page's `n`th read of its lists, counting from 0 (with `holdReads`). */
    answerRead: async (n: number, answers: Partial<Lists> = {}) => {
      const now = server.snapshot();
      await act(async () => {
        heldReads.reservations[n](answers.reservations ?? now.reservations);
        heldReads.gifts[n](answers.gifts ?? now.gifts);
      });
    },
  };
}

const markGiftedKey = (id: string) => `POST /api/reservations/${id}/gift`;
const dismissKey = (id: string) => `DELETE /api/reservations/${id}`;
/** Release sends the list's own unbook, to the reserved item. */
const releaseKey = (itemId: string) => `PATCH /api/items/${itemId}`;
const deleteGiftKey = (id: string) => `DELETE /api/gifts/${id}`;

/**
 * The buttons on the reservation card for `itemName`: "Mark as gifted", then
 * Release on an active card or Dismiss on one that needs confirmation (each
 * null where the card doesn't have it), and `second`, whichever of the two it
 * has.
 */
function reservationButtons(itemName: string) {
  // The card is the nearest ancestor of its name that holds its buttons.
  let card: HTMLElement | null = cardName(itemName);
  if (!card) throw new Error(`no reservation card for ${itemName}`);
  while (card && !within(card).queryByRole('button', { name: 'Mark as gifted' })) {
    card = card.parentElement;
  }
  const scope = within(card!);
  const release = scope.queryByRole('button', { name: 'Release' });
  const dismiss = scope.queryByRole('button', { name: 'Dismiss' });
  const second = release ?? dismiss;
  if (!second) throw new Error(`no Release or Dismiss on the card for ${itemName}`);
  return {
    gift: scope.getByRole('button', { name: 'Mark as gifted' }),
    release,
    dismiss,
    second,
  };
}

/**
 * The name on the reservation card for `itemName`, or null once the card is off
 * the page. Its gift-history row, once it's gifted, doesn't count.
 */
const cardName = (itemName: string) =>
  screen.queryAllByText(itemName).find((el) => !el.closest('li')) ?? null;

/** The note on the reservation card for `itemName` (why it needs confirmation), or null. */
function noteOn(itemName: string) {
  let card: HTMLElement | null = cardName(itemName);
  while (card && !within(card).queryByRole('button', { name: 'Mark as gifted' })) {
    card = card.parentElement;
  }
  if (!card) throw new Error(`no reservation card for ${itemName}`);
  return card.querySelector('p.rounded-full')?.textContent ?? null;
}

/** The link to its list on the reservation card for `itemName`. */
function listLink(itemName: string) {
  // The card is the nearest ancestor of its name that holds a link.
  let card: HTMLElement | null = cardName(itemName);
  while (card && !within(card).queryByRole('link')) card = card.parentElement;
  if (!card) throw new Error(`no reservation card for ${itemName}`);
  return within(card).getByRole('link');
}

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
function dismiss(itemName: string) {
  const { dismiss } = reservationButtons(itemName);
  if (!dismiss) throw new Error(`no Dismiss on the card for ${itemName}`);
  clickAndConfirm(dismiss, 'Remove');
}
function release(itemName: string) {
  const { release } = reservationButtons(itemName);
  if (!release) throw new Error(`no Release on the card for ${itemName}`);
  clickAndConfirm(release, 'Release');
}
const deleteGift = (itemName: string) => clickAndConfirm(deleteGiftButton(itemName), 'Delete');

function expectReservationDisabled(itemName: string) {
  const buttons = reservationButtons(itemName);
  expect(buttons.gift).toBeDisabled();
  expect(buttons.second).toBeDisabled();
}
function expectReservationEnabled(itemName: string) {
  const buttons = reservationButtons(itemName);
  expect(buttons.gift).toBeEnabled();
  expect(buttons.second).toBeEnabled();
}

type Held = ReturnType<typeof mockHeldFetch>;

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
  signedIn.userId = 'me';
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
    fireEvent.click(reservationButtons('Lego set').second);
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
    expect(sent(releaseKey('item-lego'))).toBe(0);
  });

  it('re-enables only the card whose request failed', async () => {
    const { answer } = await renderHeld();

    release('Lego set');
    markGifted('Scarf');

    await answer(releaseKey('item-lego'), new TypeError('Failed to fetch'));
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
    fireEvent.click(lego.second);
    const confirm = (title: string, confirmText: string) =>
      fireEvent.click(
        within(screen.getByRole('alertdialog', { name: title })).getByRole('button', {
          name: confirmText,
        })
      );

    confirm('Mark as gifted?', 'Mark as gifted');
    expectReservationDisabled('Lego set');
    confirm('Release this gift?', 'Release');
    expect(screen.queryByRole('alertdialog')).toBeNull();

    expect(sent(markGiftedKey('res-lego'))).toBe(1);
    expect(sent(releaseKey('item-lego'))).toBe(0);
    expectReservationDisabled('Lego set');

    await answer(markGiftedKey('res-lego'), failed('Failed to log gift'));
    await waitFor(() => expectReservationEnabled('Lego set'));
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(sent(releaseKey('item-lego'))).toBe(0);
  });
});

describe('BookedPage — Release on an active card, Dismiss on a changed one', () => {
  const refused = (status: number, error: string): Reply => ({
    status,
    body: { success: false, error },
  });
  const REFUSED_TOAST = 'This gift can’t be released from its list any more.';

  // regression: every card offered Dismiss, active ones included, and Dismiss
  // only deletes the Reservation: the item stayed reserved under the gifter's
  // name on the list, so the other members kept seeing it taken and nobody
  // bought it, while the gifter had lost the only page that tracked it.
  it('regression: an active card offers Release, not Dismiss; a changed card offers Dismiss', async () => {
    await renderHeld();

    const lego = reservationButtons('Lego set');
    expect(lego.release).toBeInTheDocument();
    expect(lego.dismiss).toBeNull();

    const scarf = reservationButtons('Scarf');
    expect(scarf.dismiss).toBeInTheDocument();
    expect(scarf.release).toBeNull();
  });

  it("asks first, then sends the list's own unbook to the item, and takes the card off once it lands", async () => {
    const { answer, sent } = await renderHeld();

    fireEvent.click(reservationButtons('Lego set').release!);
    const dialog = screen.getByRole('alertdialog', { name: 'Release this gift?' });
    expect(dialog).toHaveTextContent('Others on the list will be able to reserve it.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release' }));

    // The item route's unbook, as Unbook on the list sends it: nothing else
    // frees the item, and the reservation isn't dismissed on its own.
    expect(sent(releaseKey('item-lego'))).toBe(1);
    expect(fetch).toHaveBeenCalledWith(
      '/api/items/item-lego',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'available' }) })
    );
    expect(sent(dismissKey('res-lego'))).toBe(0);
    expectReservationDisabled('Lego set');

    await answer(releaseKey('item-lego'), ok);
    await waitFor(() => expect(cardName('Lego set')).toBeNull());
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      'Released. Others on the list can reserve it now.',
      'success'
    );
    expect(screen.getByText('Scarf')).toBeInTheDocument();
    // Released, not given: the gift history is as it was.
    expect(historyNames()).toEqual(['Cookbook', 'Mug']);
  });

  it('sends nothing when the confirmation is cancelled', async () => {
    const { sent } = await renderHeld();

    fireEvent.click(reservationButtons('Lego set').release!);
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' })
    );

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sent(releaseKey('item-lego'))).toBe(0);
    expectReservationEnabled('Lego set');
  });

  // The item route refuses an unbook the gifter can no longer make, and the
  // Reservation is still there: the card is out of date, not gone. So the page
  // says so, keeps it, and reads both lists again, which show it needing their
  // confirmation, with Dismiss.
  it.each([
    {
      refusal: 'no longer a member (403)',
      reply: refused(403, 'Unauthorized - No access to this wishlist'),
      itemStatus: 'available',
    },
    {
      refusal: 'someone else holds it now (403)',
      reply: refused(403, 'You can only unbook items you have booked'),
      itemStatus: 'booked',
    },
    {
      refusal: 'the owner marked it received (400)',
      reply: refused(400, 'Invalid status transition'),
      itemStatus: 'completed',
    },
    {
      refusal: 'it changed while the unbook was on its way (409)',
      reply: refused(409, 'This item is no longer booked by you'),
      itemStatus: 'draft',
    },
    {
      refusal: 'the item is gone, or the list archived (404)',
      reply: notFound('Item not found'),
      itemStatus: 'deleted',
    },
  ])(
    'a refused Release ($refusal) says so, keeps the card, and reads both lists again',
    async ({ reply, itemStatus }) => {
      const { server, answer, reads } = await renderHeld();

      release('Lego set');
      // What the route found: the item is no longer theirs to release.
      server.detach('res-lego', itemStatus);
      await answer(releaseKey('item-lego'), reply);

      await waitFor(() => expect(showToast).toHaveBeenCalledWith(REFUSED_TOAST, 'info'));
      expect(showToast).toHaveBeenCalledTimes(1);
      expect(reads()).toBe(2);
      // The read moves it to "Needs your confirmation", where it offers Dismiss.
      await waitFor(() => expect(reservationButtons('Lego set').dismiss).not.toBeNull());
      expect(reservationButtons('Lego set').release).toBeNull();
      expectReservationEnabled('Lego set');
      expect(screen.getByText('Scarf')).toBeInTheDocument();
    }
  );

  // The route's 404 is all a list gone out of reach gives: the item is still
  // booked by them, so the read keeps the card, and its note says only that
  // the list isn't available to them, never why.
  it('a Release refused because the list is out of reach moves the card to confirmation, saying so', async () => {
    const { server, answer } = await renderHeld();

    release('Lego set');
    server.closeList('res-lego');
    await answer(releaseKey('item-lego'), notFound('Item not found'));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(REFUSED_TOAST, 'info'));
    await waitFor(() => expect(reservationButtons('Lego set').dismiss).not.toBeNull());
    expect(reservationButtons('Lego set').release).toBeNull();
    expect(noteOn('Lego set')).toBe('This list is no longer available to you');
  });

  // regression: a gift still reserved to them, on a list they could no longer
  // open, said "No longer reserved to you", which isn't so. It says only that
  // the list isn't available to them (an archived list must look exactly like
  // a missing one), and keeps Dismiss: Release can't reach that list.
  it('regression: a card on a list no longer available to them says so, and offers Dismiss', async () => {
    mockHeldFetch({
      initial: [
        { ...reservations[0], listOpen: false, wishlistSlug: null },
        // Booked by someone else since: really no longer theirs.
        {
          ...reservations[0],
          _id: 'res-kite',
          itemId: 'item-kite',
          itemName: 'Kite',
          stillReserved: false,
        },
      ],
    });
    render(<BookedPage />);
    await screen.findByText('Lego set');

    const lego = reservationButtons('Lego set');
    expect(lego.dismiss).toBeInTheDocument();
    expect(lego.release).toBeNull();
    expect(noteOn('Lego set')).toBe('This list is no longer available to you');
    expect(noteOn('Kite')).toBe('No longer reserved to you');
    expect(document.body.textContent).not.toMatch(/archiv/i);
    // Both need confirmation; nothing is left to give.
    expect(
      screen.getByRole('heading', { level: 2, name: /Needs your confirmation/ })
    ).toHaveTextContent('Needs your confirmation2');
    expect(screen.getByText('Nothing actively reserved right now.')).toBeInTheDocument();
  });

  it('releases nothing, and says why, for a card a read has found changed while its confirmation was open', async () => {
    const { server, sent } = await renderHeld();

    fireEvent.click(reservationButtons('Lego set').release!);
    // Elsewhere, meanwhile: the owner marks it received, and the page reads it.
    server.detach('res-lego', 'completed');
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(reservationButtons('Lego set').dismiss).not.toBeNull());

    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Release' })
    );
    expect(sent(releaseKey('item-lego'))).toBe(0);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(REFUSED_TOAST, 'info');
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

  // regression: the page read its gift history once, so a reservation gifted
  // elsewhere left the history as it was. "Mark as gifted" 404'd, the card
  // went with "This reservation no longer exists", and the gift wasn't listed
  // until a reload, so it looked lost.
  it.each([
    {
      how: 'in another tab',
      giftElsewhere: async ({ server }: Held) => server.gift('res-lego', legoGift),
    },
    {
      how: "by this tab's own earlier request, whose answer was lost",
      giftElsewhere: async ({ server, answer }: Held) => {
        markGifted('Lego set');
        // The route saved the gift, but its answer never reached the page.
        server.gift('res-lego', legoGift);
        await answer(markGiftedKey('res-lego'), new TypeError('Failed to fetch'));
        await waitFor(() =>
          expect(showToast).toHaveBeenCalledWith('Something went wrong', 'error')
        );
        await waitFor(() => expectReservationEnabled('Lego set'));
      },
    },
  ])(
    'regression: shows the gift-history entry of a reservation gifted $how once "Mark as gifted" 404s',
    async ({ giftElsewhere }) => {
      const held = await renderHeld();
      const { answer, reads } = held;
      await giftElsewhere(held);
      // The page can't tell yet.
      expect(historyNames()).toEqual(['Cookbook', 'Mug']);
      expect(reads()).toBe(1);

      // Trying it (again) finds the reservation gone...
      markGifted('Lego set');
      await answer(markGiftedKey('res-lego'), notFound('Reservation not found'));
      await waitFor(() => expect(cardName('Lego set')).toBeNull());
      expect(showToast).toHaveBeenLastCalledWith('This reservation no longer exists', 'info');

      // ...and the gift it was given shows in the history, without a reload.
      await waitFor(() => expect(historyNames()).toEqual(['Lego set', 'Cookbook', 'Mug']));
      expect(reads()).toBe(2);
      expect(screen.getByText('Scarf')).toBeInTheDocument();
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

  // Release's own 404 is a refusal, not a record that's gone (see below), so it
  // isn't in `cardActions`; its failures worth retrying are as theirs.
  const retryable = [
    ...cardActions,
    {
      action: 'Release',
      run: () => release('Lego set'),
      key: releaseKey('item-lego'),
      itemName: 'Lego set',
      expectEnabled: () => expectReservationEnabled('Lego set'),
    },
  ];

  it.each(retryable.flatMap((a) => failures.map((f) => ({ ...a, ...f }))))(
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

describe('BookedPage — reading both lists again while the page is open', () => {
  const headphones = {
    ...reservation,
    _id: 'res-headphones',
    itemId: 'item-headphones',
    itemName: 'Headphones',
    itemStatus: 'booked',
    stillReserved: true,
  };
  const skeleton = () => document.querySelector('.skeleton');
  const comeBack = (event: 'focus' | 'visibilitychange') =>
    act(() => {
      (event === 'focus' ? window : document).dispatchEvent(new Event(event));
    });

  /** Renders the page with every read held, and lets the first load land. */
  async function renderLoaded() {
    const held = mockHeldFetch({ holdReads: true });
    const view = render(<BookedPage />);
    expect(held.reads()).toBe(1);
    await held.answerRead(0);
    expect(screen.getByText('Lego set')).toBeInTheDocument();
    return { ...held, rerender: view.rerender };
  }

  it.each(['focus', 'visibilitychange'] as const)(
    'coming back to the tab (%s) picks up what changed elsewhere, without the skeleton',
    async (event) => {
      const { server, reads, answerRead } = await renderLoaded();

      // Elsewhere: Lego is gifted, Headphones reserved, and Mug deleted from the history.
      server.gift('res-lego', legoGift);
      server.reserve(headphones);
      server.dropGift('gift-mug');

      comeBack(event);
      expect(reads()).toBe(2);
      // The cards stay up while it's on its way.
      expect(skeleton()).toBeNull();
      expect(cardName('Lego set')).not.toBeNull();

      await answerRead(1);
      expect(cardName('Lego set')).toBeNull();
      expect(screen.getByText('Headphones')).toBeInTheDocument();
      expect(screen.getByText('Scarf')).toBeInTheDocument();
      expect(historyNames()).toEqual(['Lego set', 'Cookbook']);
      expect(skeleton()).toBeNull();
      expect(showToast).not.toHaveBeenCalled();
    }
  );

  it('sends one read for a return that fires both events, and none while the tab is hidden', async () => {
    const { reads, answerRead } = await renderLoaded();

    comeBack('visibilitychange');
    comeBack('focus');
    expect(reads()).toBe(2);
    await answerRead(1);

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    comeBack('visibilitychange');
    expect(reads()).toBe(2);
    visibility.mockRestore();

    comeBack('focus');
    expect(reads()).toBe(3);
  });

  it('a read that fails keeps the cards, without an error toast', async () => {
    const { reads, answerRead } = await renderLoaded();

    comeBack('focus');
    await answerRead(1, {
      reservations: failed('Failed to fetch reservations'),
      gifts: new TypeError('Failed to fetch'),
    });
    expect(screen.getByText('Lego set')).toBeInTheDocument();
    expect(historyNames()).toEqual(['Cookbook', 'Mug']);
    expect(showToast).not.toHaveBeenCalled();

    // The next return reads again.
    comeBack('focus');
    expect(reads()).toBe(3);
  });

  it('a read where one list fails still updates the other', async () => {
    const { server, answerRead } = await renderLoaded();

    server.gift('res-lego', legoGift);
    comeBack('focus');
    await answerRead(1, { gifts: failed('Failed to fetch gift history') });

    expect(cardName('Lego set')).toBeNull();
    expect(historyNames()).toEqual(['Cookbook', 'Mug']);
    expect(showToast).not.toHaveBeenCalled();
  });

  // The reservations route returns a list's slug only while the gifter may
  // still open the list: once they've left it, say, a read has none for it.
  it("links a card's list by its slug, and by its id once a read has no slug for it", async () => {
    const { answerRead } = await renderLoaded();
    expect(listLink('Lego set')).toHaveAttribute('href', '/wishlists/birthday');

    comeBack('focus');
    await answerRead(1, {
      reservations: listed(reservations.map((r) => ({ ...r, wishlistSlug: null }))),
    });
    expect(listLink('Lego set')).toHaveAttribute('href', '/wishlists/w1');
    expect(listLink('Scarf')).toHaveAttribute('href', '/wishlists/w1');
  });

  it('the first load failing says so, and a later read fills the lists in', async () => {
    const { reads, answerRead } = mockHeldFetch({ holdReads: true });
    render(<BookedPage />);

    await answerRead(0, {
      reservations: new TypeError('Failed to fetch'),
      gifts: new TypeError('Failed to fetch'),
    });
    expect(showToast).toHaveBeenCalledWith('Failed to load your reservations', 'error');
    expect(screen.getByText('Nothing reserved yet')).toBeInTheDocument();

    comeBack('focus');
    expect(reads()).toBe(2);
    await answerRead(1);
    expect(screen.getByText('Lego set')).toBeInTheDocument();
    expect(historyNames()).toEqual(['Cookbook', 'Mug']);
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('the first load failing for one list says so, and shows the other', async () => {
    const { answerRead } = mockHeldFetch({ holdReads: true });
    render(<BookedPage />);

    await answerRead(0, { gifts: failed('Failed to fetch gift history') });
    expect(showToast).toHaveBeenCalledWith('Failed to load some data', 'error');
    expect(screen.getByText('Lego set')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('a return while the first load is on its way sends no second read', async () => {
    const { reads, answerRead } = mockHeldFetch({ holdReads: true });
    render(<BookedPage />);

    comeBack('focus');
    expect(reads()).toBe(1);
    await answerRead(0);
    expect(screen.getByText('Lego set')).toBeInTheDocument();
    expect(skeleton()).toBeNull();
  });

  it.each([
    {
      action: 'Dismiss',
      run: () => dismiss('Scarf'),
      key: dismissKey('res-scarf'),
      gone: notFound('Reservation not found'),
    },
    {
      action: 'Delete from gift history',
      run: () => deleteGift('Cookbook'),
      key: deleteGiftKey('gift-book'),
      gone: notFound('Gift entry not found'),
    },
  ])('a 404 on $action reads both lists again too', async ({ run, key, gone }) => {
    const { server, answer, reads, answerRead } = await renderLoaded();

    // Elsewhere, meanwhile: Scarf is gifted, and Cookbook deleted.
    server.gift('res-scarf', scarfGift);
    server.dropGift('gift-book');

    run();
    await answer(key, gone);
    expect(reads()).toBe(2);
    await answerRead(1);
    expect(cardName('Scarf')).toBeNull();
    expect(historyNames()).toEqual(['Scarf', 'Mug']);
  });

  // regression: a read of the gift history the server answered before a delete
  // was saved, landing after that delete's success, put the deleted entry back
  // (and deleting it again answered "Gift entry not found").
  it('regression: an entry deleted while a read is on its way stays deleted', async () => {
    const { server, answer, answerRead } = await renderLoaded();

    server.gift('res-lego', legoGift);
    markGifted('Lego set');
    await answer(markGiftedKey('res-lego'), notFound('Reservation not found'));
    // The read the 404 sent is answered with the lists as they stand now...
    const beforeDelete = server.snapshot();

    // ...but lands only after Cookbook's delete has.
    deleteGift('Cookbook');
    await answer(deleteGiftKey('gift-book'), ok);
    await waitFor(() => expect(screen.queryByText('Cookbook')).toBeNull());

    await answerRead(1, beforeDelete);
    expect(historyNames()).toEqual(['Lego set', 'Mug']);
  });

  // regression: the same read, answered before another "Mark as gifted" was
  // saved and landing after it, dropped that gift's new entry from the history
  // and brought its card back.
  it('regression: a reservation gifted while a read is on its way stays gifted', async () => {
    const { server, answer, answerRead } = await renderLoaded();

    markGifted('Scarf');
    server.gift('res-lego', legoGift);
    markGifted('Lego set');
    await answer(markGiftedKey('res-lego'), notFound('Reservation not found'));
    const beforeScarf = server.snapshot();

    await answer(markGiftedKey('res-scarf'), gifted(scarfGift));
    await waitFor(() => expect(cardName('Scarf')).toBeNull());

    await answerRead(1, beforeScarf);
    expect(cardName('Scarf')).toBeNull();
    expect(cardName('Lego set')).toBeNull();
    expect(historyNames()).toEqual(['Scarf', 'Lego set', 'Cookbook', 'Mug']);
  });

  it('a reservation dismissed while a read is on its way stays dismissed', async () => {
    const { server, answer, answerRead } = await renderLoaded();

    comeBack('focus');
    const beforeDismiss = server.snapshot();
    dismiss('Scarf');
    await answer(dismissKey('res-scarf'), ok);
    await waitFor(() => expect(screen.queryByText('Scarf')).toBeNull());

    await answerRead(1, beforeDismiss);
    expect(screen.queryByText('Scarf')).toBeNull();
    expect(screen.getByText('Lego set')).toBeInTheDocument();
  });

  // A read can't tell whether the server has taken an action that's still on
  // its way, so it leaves that card alone: the card stays as it is, disabled,
  // until its own answer decides it.
  it('a read landing while an action is in flight leaves that card alone', async () => {
    const { answer, answerRead } = await renderLoaded();

    markGifted('Lego set');
    deleteGift('Cookbook');
    comeBack('focus');
    // The server has saved both already, and the read says so.
    await answerRead(1, {
      reservations: listed([reservations[1]]),
      gifts: listed([legoGift, gifts[1]]),
    });
    expect(cardName('Lego set')).not.toBeNull();
    expectReservationDisabled('Lego set');
    expect(deleteGiftButton('Cookbook')).toBeDisabled();
    // Everything else follows the read.
    expect(historyNames()).toEqual(['Lego set', 'Cookbook', 'Mug']);

    // Their answers then take them off, once each.
    await answer(markGiftedKey('res-lego'), gifted(legoGift));
    await answer(deleteGiftKey('gift-book'), ok);
    await waitFor(() => expect(historyNames()).toEqual(['Lego set', 'Mug']));
    expect(cardName('Lego set')).toBeNull();
  });

  it('a read landing while an action is in flight keeps the card if that action then fails', async () => {
    const { answer, answerRead } = await renderLoaded();

    dismiss('Scarf');
    comeBack('focus');
    await answerRead(1);
    expectReservationDisabled('Scarf');

    await answer(dismissKey('res-scarf'), failed('Failed to remove reservation'));
    await waitFor(() => expectReservationEnabled('Scarf'));
  });

  it('ignores a read that lands after a newer one', async () => {
    const { server, answer, reads, answerRead } = await renderLoaded();

    comeBack('focus');
    const older = server.snapshot();
    // Mug is deleted elsewhere, then a 404 sends a newer read, which lands first.
    server.dropGift('gift-mug');
    dismiss('Scarf');
    await answer(dismissKey('res-scarf'), notFound('Reservation not found'));
    expect(reads()).toBe(3);
    await answerRead(2);
    expect(historyNames()).toEqual(['Cookbook']);

    // The older read, landing late, changes nothing.
    await answerRead(1, older);
    expect(historyNames()).toEqual(['Cookbook']);
    expect(screen.queryByText('Scarf')).toBeNull();
  });

  // regression: the page loaded its lists once, when the session became
  // 'authenticated'. Another account signing in from another tab leaves the
  // status 'authenticated', so the previous account's reservations and gift
  // history stayed up, and every action on them failed.
  it("regression: another account signing in never shows the previous account's lists", async () => {
    const { reads, answerRead, rerender } = await renderLoaded();

    // A read for the previous account is still on its way when the account changes.
    comeBack('focus');
    signedIn.userId = 'someone-else';
    rerender(<BookedPage />);

    // Its cards are gone at once, and the skeleton stands in for the new account's lists.
    expect(screen.queryByText('Lego set')).toBeNull();
    expect(screen.queryByText('Cookbook')).toBeNull();
    expect(skeleton()).not.toBeNull();
    expect(reads()).toBe(3);

    // The previous account's read, landing first, changes nothing...
    await answerRead(1);
    expect(screen.queryByText('Lego set')).toBeNull();
    expect(screen.queryByText('Cookbook')).toBeNull();
    expect(skeleton()).not.toBeNull();

    // ...and the new account's lists replace the skeleton.
    await answerRead(2, { reservations: listed([headphones]), gifts: listed([]) });
    expect(screen.getByText('Headphones')).toBeInTheDocument();
    expect(screen.queryByText('Lego set')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    expect(skeleton()).toBeNull();
  });

  it.each([
    { dialog: 'Mark as gifted?', open: () => reservationButtons('Lego set').gift },
    { dialog: 'Remove from reservations?', open: () => reservationButtons('Scarf').second },
    { dialog: 'Release this gift?', open: () => reservationButtons('Lego set').second },
    { dialog: 'Delete from gift history?', open: () => deleteGiftButton('Cookbook') },
  ])(
    'another account signing in closes a "$dialog" confirmation left open for the previous one',
    async ({ dialog, open }) => {
      const { rerender, sent } = await renderLoaded();

      fireEvent.click(open());
      expect(screen.getByRole('alertdialog', { name: dialog })).toBeInTheDocument();
      signedIn.userId = 'someone-else';
      rerender(<BookedPage />);

      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(sent(markGiftedKey('res-lego'))).toBe(0);
    }
  );

  it('a read that stalls is given up on, so the next return reads again', async () => {
    const { reads, answerRead } = await renderLoaded();
    vi.useFakeTimers();
    try {
      comeBack('focus');
      expect(reads()).toBe(2);
      // While it's on its way, a return sends nothing more...
      comeBack('focus');
      expect(reads()).toBe(2);

      // ...until the page gives up on it, silently.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ITEM_REQUEST_TIMEOUT_MS);
      });
      expect(showToast).not.toHaveBeenCalled();
      expect(screen.getByText('Lego set')).toBeInTheDocument();

      comeBack('focus');
      expect(reads()).toBe(3);
    } finally {
      vi.useRealTimers();
    }
    await answerRead(2, { reservations: listed([headphones]) });
    expect(screen.getByText('Headphones')).toBeInTheDocument();
    expect(screen.queryByText('Lego set')).toBeNull();
  });

  it("the new account's first load failing doesn't bring the previous account's lists back", async () => {
    const { answerRead, rerender } = await renderLoaded();

    // The previous account's read lands while the new account's first load is on its way.
    comeBack('focus');
    signedIn.userId = 'someone-else';
    rerender(<BookedPage />);
    await answerRead(1);
    await answerRead(2, {
      reservations: new TypeError('Failed to fetch'),
      gifts: new TypeError('Failed to fetch'),
    });

    expect(showToast).toHaveBeenCalledWith('Failed to load your reservations', 'error');
    expect(screen.getByText('Nothing reserved yet')).toBeInTheDocument();
    expect(screen.queryByText('Lego set')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it("the previous account's first load failing late doesn't end the new account's skeleton", async () => {
    const { answerRead } = mockHeldFetch({ holdReads: true });
    const view = render(<BookedPage />);

    signedIn.userId = 'someone-else';
    view.rerender(<BookedPage />);
    await answerRead(0, {
      reservations: new TypeError('Failed to fetch'),
      gifts: new TypeError('Failed to fetch'),
    });
    expect(showToast).not.toHaveBeenCalled();
    expect(skeleton()).not.toBeNull();

    await answerRead(1, { reservations: listed([headphones]), gifts: listed([]) });
    expect(screen.getByText('Headphones')).toBeInTheDocument();
  });

  it.each([
    { outcome: 'succeeding', reply: gifted(legoGift) },
    { outcome: 'failing', reply: new TypeError('Failed to fetch') },
    { outcome: 'finding it gone', reply: notFound('Reservation not found') },
  ])(
    'an action the previous account took, $outcome after the switch, stays off the new page',
    async ({ reply }) => {
      const { answer, reads, answerRead, rerender } = await renderLoaded();

      markGifted('Lego set');
      signedIn.userId = 'someone-else';
      rerender(<BookedPage />);
      await answerRead(1, { reservations: listed([headphones]), gifts: listed([]) });
      expect(screen.getByText('Headphones')).toBeInTheDocument();
      // Its card is still in flight, but it isn't the new account's to keep.
      expect(cardName('Lego set')).toBeNull();

      await answer(markGiftedKey('res-lego'), reply);
      expect(showToast).not.toHaveBeenCalled();
      expect(screen.queryByRole('list')).toBeNull();
      expect(cardName('Lego set')).toBeNull();
      expect(screen.getByText('Headphones')).toBeInTheDocument();
      // Nor does it read the lists again on the new account's behalf.
      expect(reads()).toBe(2);
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
    expect(lego.second).not.toHaveFocus();

    // Closing it hands focus back to the card's button that opened it.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(lego.gift).toHaveFocus();
    expect(sent(markGiftedKey('res-lego'))).toBe(0);
    expect(sent(releaseKey('item-lego'))).toBe(0);
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

describe('BookedPage — "To give" grouped by the list’s upcoming occasion', () => {
  // From Oct 2, 2026 (the viewer's local today): a yearly birthday on Oct 14,
  // stored on the placeholder year; a wedding on Oct 5; a party that's passed.
  const BIRTHDAY: Occasion = { kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' };
  const WEDDING: Occasion = { kind: 'wedding', date: '2026-10-05', recurrence: null };
  const PASSED: Occasion = { kind: 'other', date: '2026-01-01', recurrence: null };

  const toGive = (
    _id: string,
    itemName: string,
    wishlistId: string,
    wishlistName: string,
    wishlistOccasion: Occasion | null
  ): Reservation => ({
    ...reservation,
    _id,
    itemId: `item-${_id}`,
    itemName,
    wishlistId,
    wishlistName,
    wishlistSlug: wishlistId,
    wishlistOccasion,
    itemStatus: 'booked',
    stillReserved: true,
  });

  const grouped = [
    toGive('res-train', 'Toy train', 'w-anna', 'Anna’s birthday', BIRTHDAY),
    toGive('res-mug', 'Plain mug', 'w-misc', 'Odds and ends', null),
    toGive('res-vase', 'Vase', 'w-wed', 'Wedding registry', WEDDING),
    toGive('res-kite', 'Kite', 'w-anna', 'Anna’s birthday', BIRTHDAY),
    toGive('res-hat', 'Party hat', 'w-party', 'Last party', PASSED),
    // Detached from its item: under "Needs your confirmation", which isn't grouped.
    {
      ...toGive('res-scarf', 'Wool scarf', 'w-wed', 'Wedding registry', WEDDING),
      itemStatus: 'deleted',
      stillReserved: false,
    },
  ];

  const WEDDING_GROUP = 'Wedding · in 3 days Wedding registry';
  const BIRTHDAY_GROUP = 'Birthday · in 12 days Anna’s birthday';

  /** The group headings in "To give", top to bottom. */
  const headings = () => screen.queryAllByRole('heading', { level: 3 }).map((h) => h.textContent);

  /** The heading of the group the card for `itemName` is in, or null if it's in none. */
  const groupOf = (itemName: string) =>
    cardName(itemName)?.closest('section')?.querySelector('h3')?.textContent ?? null;

  /** The item names of the cards in the group under `heading`, top to bottom. */
  function cardsUnder(heading: string) {
    const group = screen
      .getAllByRole('heading', { level: 3 })
      .find((h) => h.textContent === heading)
      ?.closest('section');
    if (!group) throw new Error(`no group headed ${heading}`);
    return grouped
      .map((r) => cardName(r.itemName))
      .filter((el): el is HTMLElement => !!el && group.contains(el))
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .map((el) => el.textContent);
  }

  async function renderGrouped() {
    const held = mockHeldFetch({ initial: grouped });
    render(<BookedPage />);
    await screen.findByText('Toy train');
    return held;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // Local noon, so the local date is Oct 2 in any time zone.
    vi.setSystemTime(new Date(2026, 9, 2, 12));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('groups the gifts to give by their list, nearest occasion first, "No date" last', async () => {
    await renderGrouped();

    expect(headings()).toEqual([WEDDING_GROUP, BIRTHDAY_GROUP, 'No date']);
    expect(cardsUnder(WEDDING_GROUP)).toEqual(['Vase']);
    // One group per list, its cards in the page's order.
    expect(cardsUnder(BIRTHDAY_GROUP)).toEqual(['Toy train', 'Kite']);
    // No occasion, or one that has passed.
    expect(cardsUnder('No date')).toEqual(['Plain mug', 'Party hat']);
    // "Needs your confirmation" isn't grouped, and "To give" still counts all five.
    expect(groupOf('Wool scarf')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: /To give/ })).toHaveTextContent(
      'To give5'
    );
    // A yearly occasion's placeholder year never shows.
    expect(document.body.innerHTML).not.toContain('2000');
  });

  it('shows no group headings while no list has an occasion coming up', async () => {
    mockHeldFetch({
      initial: [
        toGive('res-mug', 'Plain mug', 'w-misc', 'Odds and ends', null),
        toGive('res-hat', 'Party hat', 'w-party', 'Last party', PASSED),
      ],
    });
    render(<BookedPage />);
    await screen.findByText('Plain mug');
    expect(screen.getByText('Party hat')).toBeInTheDocument();
    expect(headings()).toEqual([]);
  });

  it('a card action inside a group still removes the card, and a group left empty goes', async () => {
    const { answer } = await renderGrouped();

    markGifted('Kite');
    release('Vase');
    expectReservationDisabled('Kite');
    expectReservationDisabled('Vase');
    expectReservationEnabled('Toy train');

    await answer(markGiftedKey('res-kite'), gifted({ ...legoGift, _id: 'gift-kite' }));
    await waitFor(() => expect(cardName('Kite')).toBeNull());
    expect(cardsUnder(BIRTHDAY_GROUP)).toEqual(['Toy train']);
    expectReservationDisabled('Vase');

    await answer(releaseKey('item-res-vase'), ok);
    await waitFor(() => expect(cardName('Vase')).toBeNull());
    expect(headings()).toEqual([BIRTHDAY_GROUP, 'No date']);
    expect(showToast).toHaveBeenCalledWith(
      'Released. Others on the list can reserve it now.',
      'success'
    );
  });

  it('regroups the cards on the next read once an owner changes a date, and leaves a card in flight alone', async () => {
    const { server, answer } = await renderGrouped();

    release('Vase');
    // Elsewhere: the odds-and-ends list gets a holiday tomorrow, Anna's birthday
    // is cleared, and the wedding moves to next week.
    server.setOccasion('w-misc', { kind: 'holiday', date: '2026-10-03', recurrence: null });
    server.setOccasion('w-anna', null);
    server.setOccasion('w-wed', { ...WEDDING, date: '2026-10-09' });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    const HOLIDAY_GROUP = 'Holiday · tomorrow Odds and ends';
    await waitFor(() => expect(headings()).toEqual([HOLIDAY_GROUP, WEDDING_GROUP, 'No date']));
    expect(cardsUnder(HOLIDAY_GROUP)).toEqual(['Plain mug']);
    expect(cardsUnder('No date')).toEqual(['Toy train', 'Kite', 'Party hat']);
    // The card in flight keeps the page's copy (the read leaves it alone), so it
    // stays where it was, under the date it had, disabled, until its own answer.
    expect(cardsUnder(WEDDING_GROUP)).toEqual(['Vase']);
    expectReservationDisabled('Vase');

    await answer(releaseKey('item-res-vase'), ok);
    await waitFor(() => expect(cardName('Vase')).toBeNull());
    expect(headings()).toEqual([HOLIDAY_GROUP, 'No date']);
  });
});

describe('BookedPage — prices', () => {
  // regression: the page printed `${CODE} ${toFixed(2)}` ("EUR 1234.50"), with
  // no locale and no thousands separator, unlike the rest of the app.
  it('regression: shows reservation and gift prices in the viewer’s locale', async () => {
    const language = vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
    try {
      const priced = { ...reservations[0], itemPrice: { value: 123450, currency: 'eur' } };
      mockHeldFetch({ initial: [priced] });
      render(<BookedPage />);
      await screen.findByText('Lego set');

      // The price is the gifter's own snapshot, shown exactly: never converted.
      expect(screen.getByText('1.234,50 €')).toBeInTheDocument();
      expect(screen.queryByText(/≈/)).toBeNull();
    } finally {
      language.mockRestore();
    }
  });
});
