// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react';

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

// The header has its own fetches and tests;
// this file is about the invitations pinned above the feed.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));

vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import ActivityPage from '@/app/notifications/page';
import { track } from '@/lib/analytics';
import type { NotificationView } from '@/lib/utils/notifications';
import { ITEM_REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MESSAGE } from '@/lib/utils/requestTimeout';

const invites = [
  {
    _id: 'inv-birthday',
    role: 'member',
    wishlistId: 'w1',
    wishlistName: 'Birthday',
    wishlistSlug: 'birthday',
    invitedByUsername: 'alice',
    invitedByImage: null,
  },
  {
    _id: 'inv-housewarming',
    role: 'member',
    wishlistId: 'w2',
    wishlistName: 'Housewarming',
    wishlistSlug: 'housewarming',
    invitedByUsername: 'bob',
    invitedByImage: null,
  },
];
type Invite = (typeof invites)[number] & { yourReservations?: number };
const [, housewarming] = invites;
const anniversary: Invite = {
  _id: 'inv-anniversary',
  role: 'member',
  wishlistId: 'w3',
  wishlistName: 'Anniversary',
  wishlistSlug: 'anniversary',
  invitedByUsername: 'carol',
  invitedByImage: null,
};

/**
 * The page's notifications feed, which every test serves as is (empty unless a
 * test fills it in). These tests are about the invitations pinned above it.
 */
const feed: {
  rows: NotificationView[];
  /** Set, every feed read is held here until the test answers it (with the rows as they are then). */
  held: (() => void)[] | null;
  reads: number;
} = { rows: [], held: null, reads: 0 };

/** A JSON answer, a non-JSON one (`html`), or a network failure. */
type Reply = { status: number; body: unknown } | { status: number; html: true } | Error;

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

/** The invite list answering with `data`. */
const listed = (data: Invite[]): Reply => ({ status: 200, body: { success: true, data } });

/**
 * Answers each PATCH with whatever `patch` resolves to, and each list request
 * with whatever `list` resolves to. By default the list is the server's: both
 * invites, less any that a PATCH has answered or found gone or already answered.
 */
function stubFetch(patch: (url: string) => Promise<Reply>, list?: () => Promise<Reply>) {
  const settled = new Set<string>();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH' && url.startsWith('/api/invites/')) {
      const reply = await patch(url);
      if ('body' in reply && (reply.status < 400 || reply.status === 404 || reply.status === 409)) {
        settled.add(url.slice('/api/invites/'.length));
      }
      return toResponse(reply);
    }
    if (url === '/api/notifications?actors=1' && !init?.method) {
      feed.reads += 1;
      // Read as the rows are when it's sent.
      const reply = toResponse({
        status: 200,
        body: { success: true, data: feed.rows, unreadCount: 0 },
      });
      const held = feed.held;
      if (held) await new Promise<void>((resolve) => held.push(resolve));
      return reply;
    }
    if (url === '/api/users/me/invites') {
      return toResponse(
        await (list?.() ?? listed(invites.filter((invite) => !settled.has(invite._id))))
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Serves the invite list, and answers every PATCH with `reply`. */
function mockFetch(reply: Reply) {
  return stubFetch(async () => reply);
}

/**
 * Serves the invite list, and holds every PATCH open until the test settles it
 * with `answer`, so several invites can be in flight at once. With `holdLists`,
 * every list request is held too, until the test answers it with `list`, so a
 * refetch can still be on its way while the user answers a card, or several
 * can settle out of order.
 */
function mockHeldFetch({ holdLists = false } = {}) {
  const held = new Map<string, ((reply: Reply) => void)[]>();
  const lists: ((reply: Reply) => void)[] = [];
  const fetchMock = stubFetch(
    (url) => new Promise<Reply>((resolve) => held.set(url, [...(held.get(url) ?? []), resolve])),
    holdLists ? () => new Promise<Reply>((resolve) => lists.push(resolve)) : undefined
  );
  return {
    /** How many times the page has asked for the list (with `holdLists`). */
    listRequests: () => lists.length,
    /** Answers the page's `n`th request for the list, counting from 0 (with `holdLists`). */
    list: async (n: number, reply: Reply) => {
      await act(async () => lists[n](reply));
    },
    /** How many answers the page has sent for this invite, settled or not. */
    patchesFor: (inviteId: string) =>
      fetchMock.mock.calls.filter(
        ([url, init]) => url === `/api/invites/${inviteId}` && init?.method === 'PATCH'
      ).length,
    /** Settles this invite's answer, which must be the only one in flight for it. */
    answer: async (inviteId: string, reply: Reply) => {
      const url = `/api/invites/${inviteId}`;
      const pending = held.get(url) ?? [];
      if (pending.length !== 1) {
        throw new Error(`expected 1 answer in flight for ${inviteId}, found ${pending.length}`);
      }
      held.delete(url);
      await act(async () => pending[0](reply));
    },
  };
}

/** The Accept and Decline buttons on the card for `wishlistName`. */
function cardButtons(wishlistName: string) {
  const card = within(screen.getByText(wishlistName).closest('li')!);
  return {
    accept: card.getByRole('button', { name: 'Accept' }),
    decline: card.getByRole('button', { name: 'Decline' }),
  };
}

const expectDisabled = (wishlistName: string) => {
  const { accept, decline } = cardButtons(wishlistName);
  expect(accept).toBeDisabled();
  expect(decline).toBeDisabled();
};
const expectEnabled = (wishlistName: string) => {
  const { accept, decline } = cardButtons(wishlistName);
  expect(accept).toBeEnabled();
  expect(decline).toBeEnabled();
};

const declined: Reply = { status: 200, body: { success: true, data: { status: 'declined' } } };
const failed: Reply = { status: 500, body: { success: false, error: 'Failed to update invite' } };
const gone: Reply = { status: 404, body: { success: false, error: 'Invite not found' } };
const joined = (wishlistSlug: string, wishlistId: string): Reply => ({
  status: 200,
  body: { success: true, data: { status: 'accepted', wishlistSlug, wishlistId } },
});

const invitesChanged = vi.fn();

async function clickOnFirstCard(name: 'Accept' | 'Decline') {
  render(<ActivityPage />);
  await screen.findByText('Birthday');
  // Let the whole response handler settle inside act, busy-state reset included.
  await act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name })[0]);
  });
}

beforeEach(() => {
  cleanup();
  push.mockReset();
  showToast.mockReset();
  invitesChanged.mockReset();
  signedIn.userId = 'me';
  feed.rows = [];
  feed.held = null;
  feed.reads = 0;
  window.addEventListener('invites-changed', invitesChanged);
});
afterEach(() => {
  window.removeEventListener('invites-changed', invitesChanged);
  vi.unstubAllGlobals();
});

describe('Activity, pinned invites — an invite that no longer exists', () => {
  // regression: a 404 from PATCH /api/invites/[id] (the invite was cancelled,
  // its list deleted, or the invitee kicked or demoted while the page was open)
  // was shown as a generic error toast and the card stayed, so every retry 404'd
  // again and the header's invitation dot stayed lit until a reload.
  it.each(['Accept', 'Decline'] as const)(
    'regression: drops the card and tells the rest of the app when %s gets a 404',
    async (name) => {
      mockFetch({ status: 404, body: { success: false, error: 'Invite not found' } });
      await clickOnFirstCard(name);

      await waitFor(() => expect(screen.queryByText('Birthday')).toBeNull());
      expect(screen.getByText('Housewarming')).toBeInTheDocument();
      expect(invitesChanged).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledWith('This invitation is no longer available', 'info');
      expect(showToast).not.toHaveBeenCalledWith(expect.anything(), 'error');
      expect(push).not.toHaveBeenCalled();
    }
  );
});

// WIS-100: an invite answered from another tab or device was told apart from a
// gone one only by the route's 409, which says what the answer was.
describe('Activity, pinned invites — an invite already answered elsewhere', () => {
  const alreadyAnswered = (data: Record<string, unknown>): Reply => ({
    status: 409,
    body: { success: false, error: 'This invitation has already been answered.', data },
  });

  it.each(['Accept', 'Decline'] as const)(
    'says they already joined, links the list, and drops the card (%s)',
    async (name) => {
      mockFetch(
        alreadyAnswered({ status: 'accepted', wishlistSlug: 'birthday', wishlistId: 'w1' })
      );
      await clickOnFirstCard(name);

      await waitFor(() => expect(screen.queryByText('Birthday')).toBeNull());
      expect(screen.getByText('Housewarming')).toBeInTheDocument();
      expect(invitesChanged).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledWith("You've already joined “Birthday”", 'info', {
        action: { label: 'Open list', href: '/wishlists/birthday' },
      });
      expect(showToast).not.toHaveBeenCalledWith(expect.anything(), 'error');
      // This click joined nothing, so nothing navigates.
      expect(push).not.toHaveBeenCalled();
    }
  );

  it('links the list by its id when it has no slug', async () => {
    mockFetch(alreadyAnswered({ status: 'accepted', wishlistSlug: null, wishlistId: 'w1' }));
    await clickOnFirstCard('Accept');

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("You've already joined “Birthday”", 'info', {
        action: { label: 'Open list', href: '/wishlists/w1' },
      })
    );
  });

  it('says they already joined without a link when the route gave none', async () => {
    mockFetch(alreadyAnswered({ status: 'accepted' }));
    await clickOnFirstCard('Accept');

    await waitFor(() => expect(screen.queryByText('Birthday')).toBeNull());
    expect(showToast).toHaveBeenCalledWith("You've already joined “Birthday”", 'info', undefined);
  });

  it('says they already declined it, and drops the card', async () => {
    mockFetch(alreadyAnswered({ status: 'declined' }));
    await clickOnFirstCard('Accept');

    await waitFor(() => expect(screen.queryByText('Birthday')).toBeNull());
    expect(showToast).toHaveBeenCalledWith(
      'You already declined this invitation',
      'info',
      undefined
    );
    expect(push).not.toHaveBeenCalled();
  });

  it('keeps the card on a 409 that says nothing about the answer', async () => {
    mockFetch({ status: 409, body: { success: false, error: 'Conflict' } });
    await clickOnFirstCard('Accept');

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Conflict', 'error'));
    expect(screen.getByText('Birthday')).toBeInTheDocument();
  });
});

describe('Activity, pinned invites — failures worth retrying keep the card', () => {
  it.each([
    { status: 429, error: 'Too many requests' },
    { status: 500, error: 'Failed to update invite' },
  ])('keeps the card and shows the error on a $status', async ({ status, error }) => {
    mockFetch({ status, body: { success: false, error } });
    await clickOnFirstCard('Accept');

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(error, 'error'));
    expect(screen.getByText('Birthday')).toBeInTheDocument();
    // Re-enabled, so the user can try again.
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Accept' })[0]).toBeEnabled());
    expect(invitesChanged).not.toHaveBeenCalled();
  });

  // Only the route's own JSON 404 means the invite is gone; an HTML 404 from the
  // platform says nothing about it.
  it('keeps the card on a 404 that is not the route answering', async () => {
    mockFetch({ status: 404, html: true });
    await clickOnFirstCard('Accept');

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Something went wrong', 'error'));
    expect(screen.getByText('Birthday')).toBeInTheDocument();
    expect(invitesChanged).not.toHaveBeenCalled();
  });

  it('keeps the card on a network error', async () => {
    mockFetch(new TypeError('Failed to fetch'));
    await clickOnFirstCard('Decline');

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Something went wrong', 'error'));
    expect(screen.getByText('Birthday')).toBeInTheDocument();
    expect(invitesChanged).not.toHaveBeenCalled();
  });
});

describe('Activity, pinned invites — answering an invite', () => {
  const notificationsChanged = vi.fn();
  beforeEach(() => {
    notificationsChanged.mockReset();
    vi.mocked(track).mockReset();
    window.addEventListener('notifications-changed', notificationsChanged);
  });
  afterEach(() => window.removeEventListener('notifications-changed', notificationsChanged));

  it('declining drops the card and tells the rest of the app', async () => {
    mockFetch({ status: 200, body: { success: true, data: { status: 'declined' } } });
    await clickOnFirstCard('Decline');

    await waitFor(() => expect(screen.queryByText('Birthday')).toBeNull());
    expect(invitesChanged).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('Invitation declined', 'info');
    // WIS-329: only an accept is counted.
    expect(track).not.toHaveBeenCalled();
  });

  // regression: answering marks the invite's notification read on the server,
  // but the header's bell (Activity's badge since WIS-302) only re-counted on
  // focus, so after a decline (which stays on this page) it kept counting the
  // notification.
  it.each([
    ['Decline', { status: 'declined' }],
    ['Accept', { status: 'accepted', wishlistSlug: 'birthday', wishlistId: 'w1' }],
  ] as const)('regression: %s has the unread badge re-count', async (name, data) => {
    mockFetch({ status: 200, body: { success: true, data } });
    await clickOnFirstCard(name);

    await waitFor(() => expect(notificationsChanged).toHaveBeenCalledTimes(1));
  });

  it('leaves the unread badge alone when the answer failed', async () => {
    mockFetch({ status: 500, body: { success: false, error: 'Failed to update invite' } });
    await clickOnFirstCard('Decline');

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to update invite', 'error'));
    expect(notificationsChanged).not.toHaveBeenCalled();
  });

  it('counts no accept that failed', async () => {
    mockFetch({ status: 500, body: { success: false, error: 'Failed to update invite' } });
    await clickOnFirstCard('Accept');

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to update invite', 'error'));
    expect(track).not.toHaveBeenCalled();
  });

  it('accepting drops the card and opens the list', async () => {
    mockFetch({
      status: 200,
      body: {
        success: true,
        data: { status: 'accepted', wishlistSlug: 'birthday', wishlistId: 'w1' },
      },
    });
    await clickOnFirstCard('Accept');

    await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/birthday?welcome=1'));
    expect(screen.queryByText('Birthday')).toBeNull();
    expect(invitesChanged).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('Joined “Birthday”', 'success');
    // WIS-329: counted once, by role, with nothing about the list.
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('invite_accepted', { role: 'member' });
  });
});

describe('Activity, pinned invites — accepting a co-owner invite', () => {
  const ownerInvite: Invite = {
    _id: 'inv-garden',
    role: 'owner',
    wishlistId: 'w4',
    wishlistName: "Chloe's garden",
    wishlistSlug: 'garden',
    invitedByUsername: 'chloe',
    invitedByImage: null,
  };
  /** The accept's answer: the items it freed, and the reservations it ended. */
  const accepted = (releasedBookings: number, cancelledReservations: number): Reply => ({
    status: 200,
    body: {
      success: true,
      data: {
        status: 'accepted',
        role: 'owner',
        wishlistSlug: 'garden',
        wishlistId: 'w4',
        releasedBookings,
        cancelledReservations,
      },
    },
  });

  async function accept(reply: Reply) {
    stubFetch(
      async () => reply,
      async () => listed([ownerInvite])
    );
    render(<ActivityPage />);
    await screen.findByText("Chloe's garden");
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/garden'));
  }

  // regression: accepting became "Joined “…”", and the counts the accept
  // answers with were dropped. It's the invitee's own, so it goes back to them.
  it('regression: says they are now a co-owner, and how many gifts they had reserved were released', async () => {
    await accept(accepted(2, 2));
    expect(showToast).toHaveBeenCalledWith(
      "You're now a co-owner of “Chloe's garden” · 2 gifts you'd reserved here were released",
      'success'
    );
  });

  // The reservations the accept ended are what go from their Reserved page.
  // There can be more of them than items it freed: one whose item an owner
  // drafted, or that they kept on leaving the list earlier, has no booking left
  // to free.
  it('counts the reservations it ended, not the items it freed', async () => {
    await accept(accepted(1, 3));
    expect(showToast).toHaveBeenCalledWith(
      "You're now a co-owner of “Chloe's garden” · 3 gifts you'd reserved here were released",
      'success'
    );
  });

  it('counts them even when it freed no item', async () => {
    await accept(accepted(0, 1));
    expect(showToast).toHaveBeenCalledWith(
      "You're now a co-owner of “Chloe's garden” · 1 gift you'd reserved here was released",
      'success'
    );
  });

  it('says only that they are a co-owner when it ended no reservation', async () => {
    await accept(accepted(0, 0));
    expect(showToast).toHaveBeenCalledWith("You're now a co-owner of “Chloe's garden”", 'success');
  });
});

describe('Activity, pinned invites — answering several invites at once', () => {
  async function renderHeld() {
    const held = mockHeldFetch();
    render(<ActivityPage />);
    await screen.findByText('Birthday');
    return held;
  }

  // regression: the page tracked one busy id for all its cards, so answering
  // card B while A's answer was in flight re-enabled A's buttons, and whichever
  // answer settled first re-enabled both. A could then be answered twice:
  // accepted twice (the second 404'd into "no longer available"), or accepted
  // and declined, sending two conflicting answers to race on the server.
  it("regression: answering B while A's answer is in flight leaves A disabled", async () => {
    const { answer, patchesFor } = await renderHeld();

    fireEvent.click(cardButtons('Birthday').accept);
    expectDisabled('Birthday');

    fireEvent.click(cardButtons('Housewarming').decline);
    expectDisabled('Birthday');
    expectDisabled('Housewarming');

    // Nothing more goes out for A while its first answer is pending.
    fireEvent.click(cardButtons('Birthday').accept);
    fireEvent.click(cardButtons('Birthday').decline);
    expect(patchesFor('inv-birthday')).toBe(1);

    // B settling first doesn't unlock A either...
    await answer('inv-housewarming', declined);
    await waitFor(() => expect(screen.queryByText('Housewarming')).toBeNull());
    expectDisabled('Birthday');

    // ...only A's own answer does.
    await answer('inv-birthday', failed);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to update invite', 'error'));
    expectEnabled('Birthday');
    expect(patchesFor('inv-birthday')).toBe(1);
  });

  // regression: only the card's disabled buttons kept a second answer off a busy
  // invite; respond itself didn't check, so an answer reaching it before the
  // buttons re-rendered went out too.
  it('regression: ignores a second answer for an invite whose first is in flight', async () => {
    const { answer, patchesFor } = await renderHeld();
    const birthday = cardButtons('Birthday');

    // Both clicks inside one act, so the buttons haven't re-rendered as
    // disabled when the second lands.
    act(() => {
      fireEvent.click(birthday.accept);
      fireEvent.click(birthday.decline);
    });
    expect(patchesFor('inv-birthday')).toBe(1);
    expectDisabled('Birthday');

    await answer('inv-birthday', failed);
    await waitFor(() => expectEnabled('Birthday'));
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(patchesFor('inv-birthday')).toBe(1);
  });

  it('re-enables a card whose answer failed while another is still in flight', async () => {
    const { answer } = await renderHeld();

    fireEvent.click(cardButtons('Birthday').accept);
    fireEvent.click(cardButtons('Housewarming').accept);

    await answer('inv-birthday', failed);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to update invite', 'error'));
    expectEnabled('Birthday');
    expectDisabled('Housewarming');

    await answer('inv-housewarming', joined('housewarming', 'w2'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/housewarming?welcome=1'));
    expect(screen.queryByText('Housewarming')).toBeNull();
    expectEnabled('Birthday');
  });

  it('drops a card whose invite is gone while another is still in flight', async () => {
    const { answer } = await renderHeld();

    fireEvent.click(cardButtons('Birthday').accept);
    fireEvent.click(cardButtons('Housewarming').decline);

    await answer('inv-birthday', gone);
    await waitFor(() => expect(screen.queryByText('Birthday')).toBeNull());
    expectDisabled('Housewarming');

    await answer('inv-housewarming', failed);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to update invite', 'error'));
    expectEnabled('Housewarming');
    expect(screen.queryByText('Birthday')).toBeNull();
  });

  // Accepting A redirects. B's answer settling after that lands on B's card
  // alone: it doesn't bring A's card back or redirect again.
  describe('after accepting A redirects', () => {
    async function acceptAWhileBInFlight() {
      const held = await renderHeld();
      fireEvent.click(cardButtons('Birthday').accept);
      fireEvent.click(cardButtons('Housewarming').decline);

      await held.answer('inv-birthday', joined('birthday', 'w1'));
      await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/birthday?welcome=1'));
      expect(screen.queryByText('Birthday')).toBeNull();
      expectDisabled('Housewarming');
      return held;
    }

    it("B's decline landing afterwards drops only B's card", async () => {
      const { answer } = await acceptAWhileBInFlight();

      await answer('inv-housewarming', declined);
      await waitFor(() => expect(screen.queryByText('Housewarming')).toBeNull());
      expect(showToast).toHaveBeenCalledWith('Invitation declined', 'info');
      expect(screen.queryByText('Birthday')).toBeNull();
      expect(push).toHaveBeenCalledTimes(1);
    });

    it("B failing afterwards re-enables only B's card", async () => {
      const { answer } = await acceptAWhileBInFlight();

      await answer('inv-housewarming', failed);
      await waitFor(() =>
        expect(showToast).toHaveBeenCalledWith('Failed to update invite', 'error')
      );
      expectEnabled('Housewarming');
      expect(screen.queryByText('Birthday')).toBeNull();
      expect(push).toHaveBeenCalledTimes(1);
    });
  });

  // WIS-121: every accept that succeeded redirected, so accepting A and then B
  // took the user to A's list and, seconds later, pulled them over to B's. Now
  // only the last accept clicked, among those still able to succeed, opens its
  // list; any other accept that succeeds only says it joined.
  describe('accepting A, then B, before either is back', () => {
    async function acceptBoth() {
      const held = await renderHeld();
      fireEvent.click(cardButtons('Birthday').accept);
      fireEvent.click(cardButtons('Housewarming').accept);
      return held;
    }

    it("A landing first only says it joined, and B's landing opens B's list", async () => {
      const { answer } = await acceptBoth();

      await answer('inv-birthday', joined('birthday', 'w1'));
      await waitFor(() => expect(screen.queryByText('Birthday')).toBeNull());
      expect(showToast).toHaveBeenCalledWith('Joined “Birthday”', 'success');
      expect(push).not.toHaveBeenCalled();

      await answer('inv-housewarming', joined('housewarming', 'w2'));
      await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/housewarming?welcome=1'));
      expect(showToast).toHaveBeenCalledWith('Joined “Housewarming”', 'success');
      expect(push).toHaveBeenCalledTimes(1);
    });

    it("B landing first opens B's list, and A's landing afterwards only says it joined", async () => {
      const { answer } = await acceptBoth();

      await answer('inv-housewarming', joined('housewarming', 'w2'));
      await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/housewarming?welcome=1'));

      await answer('inv-birthday', joined('birthday', 'w1'));
      await waitFor(() => expect(screen.queryByText('Birthday')).toBeNull());
      expect(showToast).toHaveBeenCalledWith('Joined “Birthday”', 'success');
      expect(push).toHaveBeenCalledTimes(1);
    });

    // B not succeeding leaves A as the last accept that could, so A's list
    // opens once B is back, even though A landed first.
    it.each([
      ['fails', failed, 'Failed to update invite'],
      ['is gone', gone, 'This invitation is no longer available'],
      ['hits a network error', new Error('offline'), 'Something went wrong'],
    ] as const)("A landing first, then B %s, opens A's list", async (_, reply, message) => {
      const { answer } = await acceptBoth();

      await answer('inv-birthday', joined('birthday', 'w1'));
      await waitFor(() => expect(screen.queryByText('Birthday')).toBeNull());
      expect(push).not.toHaveBeenCalled();

      await answer('inv-housewarming', reply);
      await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/birthday?welcome=1'));
      expect(showToast).toHaveBeenCalledWith(message, expect.any(String));
      expect(push).toHaveBeenCalledTimes(1);
    });

    it("B failing first lets A's landing open A's list", async () => {
      const { answer } = await acceptBoth();

      await answer('inv-housewarming', failed);
      await waitFor(() => expectEnabled('Housewarming'));
      expect(push).not.toHaveBeenCalled();

      await answer('inv-birthday', joined('birthday', 'w1'));
      await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/birthday?welcome=1'));
      expect(push).toHaveBeenCalledTimes(1);
    });

    // A's redirect, held for B, mustn't fire once the user has gone elsewhere.
    it.each([
      ['fails', failed],
      ['lands', joined('housewarming', 'w2')],
    ] as const)('B that %s after the user left the page redirects nowhere', async (_, reply) => {
      const { answer } = await acceptBoth();

      await answer('inv-birthday', joined('birthday', 'w1'));
      await waitFor(() => expect(screen.queryByText('Birthday')).toBeNull());
      cleanup();

      await answer('inv-housewarming', reply);
      expect(push).not.toHaveBeenCalled();
    });

    it('A failing changes nothing for B, which still opens its list', async () => {
      const { answer } = await acceptBoth();

      await answer('inv-birthday', failed);
      await waitFor(() => expectEnabled('Birthday'));
      expect(push).not.toHaveBeenCalled();

      await answer('inv-housewarming', joined('housewarming', 'w2'));
      await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/housewarming?welcome=1'));
      expect(push).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Activity, pinned invites — keeping the list fresh while it is open', () => {
  const graduation: Invite = { ...anniversary, _id: 'inv-graduation', wishlistName: 'Graduation' };
  const loadFailed: Reply = {
    status: 500,
    body: { success: false, error: 'Failed to load invites' },
  };
  const skeleton = () => document.querySelector('.skeleton');
  const refetchOn = (event: 'focus' | 'invites-changed') =>
    act(() => {
      window.dispatchEvent(new Event(event));
    });

  /** Renders the page with every list request held, and lets the first load land. */
  async function renderLoaded() {
    const held = mockHeldFetch({ holdLists: true });
    const view = render(<ActivityPage />);
    expect(held.listRequests()).toBe(1);
    await held.list(0, listed(invites));
    expect(screen.getByText('Birthday')).toBeInTheDocument();
    return { ...held, rerender: view.rerender };
  }

  it.each(['focus', 'invites-changed'] as const)(
    'a refetch on %s replaces the list, without flashing the skeleton',
    async (event) => {
      const { list, listRequests } = await renderLoaded();

      refetchOn(event);
      expect(listRequests()).toBe(2);
      // The cards stay up while it's on its way.
      expect(skeleton()).toBeNull();
      expect(screen.getByText('Birthday')).toBeInTheDocument();

      // Meanwhile an owner cancelled Birthday, and someone sent Anniversary.
      await list(1, listed([anniversary, housewarming]));
      expect(screen.queryByText('Birthday')).toBeNull();
      expect(screen.getByText('Anniversary')).toBeInTheDocument();
      expect(screen.getByText('Housewarming')).toBeInTheDocument();
      expect(skeleton()).toBeNull();
    }
  );

  it('ignores a refetch that settles after a newer one', async () => {
    const { list } = await renderLoaded();

    refetchOn('focus');
    refetchOn('focus');
    await list(2, listed([anniversary]));
    await list(1, listed(invites));

    expect(screen.getByText('Anniversary')).toBeInTheDocument();
    expect(screen.queryByText('Birthday')).toBeNull();
    expect(screen.queryByText('Housewarming')).toBeNull();
  });

  it('a first load overtaken by a refetch still lands, even if the refetch fails', async () => {
    const { list } = mockHeldFetch({ holdLists: true });
    render(<ActivityPage />);

    refetchOn('focus');
    await list(0, listed(invites));
    expect(screen.getByText('Birthday')).toBeInTheDocument();
    expect(skeleton()).toBeNull();

    await list(1, loadFailed);
    expect(screen.getByText('Birthday')).toBeInTheDocument();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('a refetch failing while the first load is on its way keeps the skeleton up', async () => {
    const { list } = mockHeldFetch({ holdLists: true });
    render(<ActivityPage />);

    refetchOn('focus');
    await list(1, loadFailed);
    expect(skeleton()).not.toBeNull();
    expect(screen.queryByText('You’re all caught up')).toBeNull();

    await list(0, listed(invites));
    expect(screen.getByText('Birthday')).toBeInTheDocument();
    expect(showToast).not.toHaveBeenCalled();
  });

  // regression: refetching replaces the cards with the server's list, so a list
  // read before an answer landed would bring the answered card back, its next
  // click 404'ing into "no longer available".
  it('regression: a list read before an answer landed does not bring the card back', async () => {
    const { list, listRequests, answer } = await renderLoaded();

    refetchOn('focus');
    fireEvent.click(cardButtons('Birthday').decline);
    await answer('inv-birthday', declined);
    await waitFor(() => expect(screen.queryByText('Birthday')).toBeNull());
    // Dropping the card fired invites-changed, which re-reads the list.
    expect(listRequests()).toBe(3);

    // The focus refetch lands now, still listing Birthday, and is dropped,
    // without another read: the one sent after the answer is on its way...
    await list(1, listed(invites));
    expect(screen.queryByText('Birthday')).toBeNull();
    expect(screen.getByText('Housewarming')).toBeInTheDocument();
    expect(listRequests()).toBe(3);

    // ...and lands.
    await list(2, listed([anniversary, housewarming]));
    expect(screen.queryByText('Birthday')).toBeNull();
    expect(screen.getByText('Anniversary')).toBeInTheDocument();
  });

  // A list read while an answer is on its way can't tell whether the server
  // has taken it yet, so it leaves the cards alone: the card being answered
  // stays as it is, disabled, until its own answer decides it.
  it('a refetch landing while an answer is in flight leaves the cards alone', async () => {
    const { list, listRequests, answer } = await renderLoaded();

    fireEvent.click(cardButtons('Birthday').accept);
    refetchOn('focus');
    await list(1, listed([anniversary, housewarming]));
    expect(screen.getByText('Birthday')).toBeInTheDocument();
    expect(screen.queryByText('Anniversary')).toBeNull();
    expectDisabled('Birthday');
    expectEnabled('Housewarming');

    // Once the answer settles (here, a failure worth retrying), the list is read
    // again, and that read has the last word: an owner had cancelled Birthday.
    expect(listRequests()).toBe(2);
    await answer('inv-birthday', failed);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to update invite', 'error'));
    expect(listRequests()).toBe(3);
    await list(2, listed([anniversary, housewarming]));
    expect(screen.queryByText('Birthday')).toBeNull();
    expect(screen.getByText('Anniversary')).toBeInTheDocument();
  });

  it('a refetch that fails keeps the cards, without an error toast', async () => {
    const { list } = await renderLoaded();

    refetchOn('focus');
    await list(1, loadFailed);

    expect(screen.getByText('Birthday')).toBeInTheDocument();
    expect(screen.getByText('Housewarming')).toBeInTheDocument();
    expect(showToast).not.toHaveBeenCalled();
  });

  // regression: a failed first load toasted, then said "No pending
  // invitations", which claims there are none.
  it('regression: the first load failing says so in place, and a later refetch fills the list in', async () => {
    const { list } = mockHeldFetch({ holdLists: true });
    render(<ActivityPage />);

    await list(0, loadFailed);
    expect(screen.getByRole('heading', { name: 'Couldn’t load your invitations' })).toBeVisible();
    expect(screen.queryByText('You’re all caught up')).toBeNull();
    expect(showToast).not.toHaveBeenCalled();

    // A refetch failing too keeps the panel, and says nothing more.
    refetchOn('focus');
    await list(1, loadFailed);
    expect(screen.getByRole('heading', { name: 'Couldn’t load your invitations' })).toBeVisible();

    refetchOn('focus');
    await list(2, listed(invites));
    expect(screen.getByText('Birthday')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Couldn’t load your invitations' })).toBeNull();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('Try again after a failed first load reads the list afresh', async () => {
    const { list, listRequests } = mockHeldFetch({ holdLists: true });
    render(<ActivityPage />);

    await list(0, loadFailed);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    // The skeleton while it's read again, then the list.
    expect(skeleton()).not.toBeNull();
    expect(listRequests()).toBe(2);
    await list(1, listed(invites));
    expect(screen.getByText('Birthday')).toBeInTheDocument();
    expect(showToast).not.toHaveBeenCalled();
  });

  // regression: the page loaded its invites once, when the session became
  // 'authenticated'. Another account signing in from another tab leaves the
  // status 'authenticated', so the previous account's cards (its list names and
  // inviters) stayed up, and every answer to them got a 403.
  it("regression: another account signing in never shows the previous account's invites", async () => {
    const { list, listRequests, rerender } = await renderLoaded();

    // A refetch for the previous account is still on its way when the account changes.
    refetchOn('focus');
    signedIn.userId = 'someone-else';
    rerender(<ActivityPage />);

    // Its cards are gone at once, and the skeleton stands in for the new account's list.
    expect(screen.queryByText('Birthday')).toBeNull();
    expect(screen.queryByText('Housewarming')).toBeNull();
    expect(skeleton()).not.toBeNull();
    expect(listRequests()).toBe(3);

    // The new account's list replaces the skeleton...
    await list(2, listed([graduation]));
    expect(screen.getByText('Graduation')).toBeInTheDocument();
    expect(skeleton()).toBeNull();

    // ...and the previous account's refetch, landing late, changes nothing.
    await list(1, listed(invites));
    expect(screen.getByText('Graduation')).toBeInTheDocument();
    expect(screen.queryByText('Birthday')).toBeNull();
    expect(screen.queryByText('Housewarming')).toBeNull();
  });

  it("the new account's list failing to load doesn't bring the previous account's cards back", async () => {
    const { list, rerender } = await renderLoaded();

    signedIn.userId = 'someone-else';
    rerender(<ActivityPage />);
    await list(1, loadFailed);

    expect(screen.getByRole('heading', { name: 'Couldn’t load your invitations' })).toBeVisible();
    expect(screen.queryByText('You’re all caught up')).toBeNull();
    expect(screen.queryByText('Birthday')).toBeNull();
  });

  it.each([
    { outcome: 'succeeding', reply: joined('birthday', 'w1') },
    { outcome: 'failing', reply: new TypeError('Failed to fetch') },
  ])(
    'an answer the previous account gave, $outcome after the switch, stays off the new page',
    async ({ reply }) => {
      const { list, answer, rerender } = await renderLoaded();

      fireEvent.click(cardButtons('Birthday').accept);
      signedIn.userId = 'someone-else';
      rerender(<ActivityPage />);

      // While that answer is still on its way, the new account's list loads and
      // keeps fresh: the answer isn't one of its own, so it holds nothing up.
      await list(1, listed([graduation]));
      expect(screen.getByText('Graduation')).toBeInTheDocument();
      refetchOn('focus');
      await list(2, listed([anniversary, graduation]));
      expect(screen.getByText('Anniversary')).toBeInTheDocument();

      await answer('inv-birthday', reply);
      expect(push).not.toHaveBeenCalled();
      expect(showToast).not.toHaveBeenCalled();
      expect(invitesChanged).not.toHaveBeenCalled();
      expect(screen.getByText('Graduation')).toBeInTheDocument();
      expect(screen.queryByText('Birthday')).toBeNull();
    }
  );
});

describe('Activity, pinned invites — on the page', () => {
  const ownerInvite: Invite = {
    _id: 'inv-garden',
    role: 'owner',
    wishlistId: 'w4',
    wishlistName: 'Garden',
    wishlistSlug: 'garden',
    invitedByUsername: 'chloe',
    invitedByImage: null,
    yourReservations: 1,
  };
  const inviteRow = (wishlistId: string, wishlistName: string, actorUsername: string) =>
    ({
      _id: `n-${wishlistId}`,
      type: 'wishlist_invite',
      actorUsername,
      count: 1,
      actorUsernames: [],
      wishlistName,
      wishlistSlug: null,
      wishlistId,
      itemName: null,
      inviteAnswer: null,
      actorId: null,
      actorImage: null,
      followingActor: null,
      read: false,
      createdAt: new Date().toISOString(),
    }) satisfies NotificationView;
  const pinned = () => screen.getByRole('region', { name: 'Invitations' });
  /** The feed's row whose line matches `text` (not the pinned card). */
  const feedRow = (text: RegExp) =>
    screen
      .getAllByText(text)
      .find((el) => !pinned().contains(el))!
      .closest('li')!;

  it('pins each pending invite above the feed, with Accept and Decline, and the feed rows without them', async () => {
    feed.rows = [inviteRow('w1', 'Birthday', 'alice'), inviteRow('w2', 'Housewarming', 'bob')];
    mockFetch(declined);
    render(<ActivityPage />);

    expect(await screen.findByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
    await screen.findByRole('region', { name: 'Invitations' });
    expect(within(pinned()).getAllByRole('button', { name: 'Accept' })).toHaveLength(2);
    expect(within(pinned()).getAllByRole('button', { name: 'Decline' })).toHaveLength(2);
    // The feed's rows for them answer nothing, and link nowhere: their cards do.
    const row = feedRow(/@alice invited you to/);
    expect(within(row).queryByRole('button')).toBeNull();
    expect(within(row).queryByRole('link')).toBeNull();
    expect(screen.queryByText('You’re all caught up')).toBeNull();
  });

  it.each([
    ['Decline', declined, 'You declined the invite to Birthday'],
    ['Accept', joined('birthday', 'w1'), 'You joined Birthday'],
  ] as const)(
    'once answered (%s), the card goes and its row reads as the answer',
    async (name, reply, answered) => {
      feed.rows = [inviteRow('w1', 'Birthday', 'alice'), inviteRow('w2', 'Housewarming', 'bob')];
      mockFetch(reply);
      render(<ActivityPage />);
      await screen.findByRole('region', { name: 'Invitations' });

      const card = within(within(pinned()).getByText('Birthday').closest('li')!);
      await act(async () => {
        fireEvent.click(card.getByRole('button', { name }));
      });

      await waitFor(() => expect(feedRow(/^You (joined|declined)/)).toBeInTheDocument());
      expect(feedRow(/^You (joined|declined)/).textContent).toContain(answered);
      expect(within(pinned()).queryByText('Birthday')).toBeNull();
      // The other invite is untouched, on its card and in its row.
      expect(within(pinned()).getByText('Housewarming')).toBeInTheDocument();
      expect(feedRow(/@bob invited you to/)).toBeInTheDocument();
    }
  );

  it('shows the co-owner warning on an owner invite only, before it is accepted', async () => {
    stubFetch(
      async () => declined,
      async () => listed([ownerInvite, ...invites])
    );
    render(<ActivityPage />);
    const card = within((await screen.findByText('Garden')).closest('li')!);

    const warning = /Co-owners can’t see reservations, so accepting releases/;
    expect(card.getByText(warning)).toBeVisible();
    expect(card.getByText('Co-owner')).toBeVisible();
    expect(screen.getAllByText(warning)).toHaveLength(1);
  });

  it('says it is all caught up only when there is neither an invite nor a notification', async () => {
    stubFetch(
      async () => declined,
      async () => listed([])
    );
    render(<ActivityPage />);
    expect(await screen.findByText('You’re all caught up')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Invitations' })).toBeNull();
  });

  it("another account signing in never shows the previous account's feed", async () => {
    feed.rows = [inviteRow('w1', 'Birthday', 'alice')];
    const { list, rerender } = await (async () => {
      const held = mockHeldFetch({ holdLists: true });
      const view = render(<ActivityPage />);
      await held.list(0, listed(invites));
      return { ...held, rerender: view.rerender };
    })();
    expect(feedRow(/@alice invited you to/)).toBeInTheDocument();

    feed.rows = [inviteRow('w9', 'Graduation', 'zoe')];
    signedIn.userId = 'someone-else';
    rerender(<ActivityPage />);
    expect(screen.queryByText(/@alice invited you to/)).toBeNull();

    await list(1, listed([]));
    expect(await screen.findByText(/@zoe invited you to/)).toBeInTheDocument();
    expect(screen.queryByText(/@alice invited you to/)).toBeNull();
  });

  // A feed read sent before an answer landed still lists the invite as pending:
  // landing after it, it would bring the row back with no card above it.
  it('regression: a feed read from before an answer does not undo it', async () => {
    feed.rows = [inviteRow('w1', 'Birthday', 'alice')];
    stubFetch(async () => {
      // The server records the answer on the row as it takes it.
      feed.rows = [
        { ...inviteRow('w1', 'Birthday', 'alice'), inviteAnswer: 'declined', read: true },
      ];
      return declined;
    });
    render(<ActivityPage />);
    await screen.findByRole('region', { name: 'Invitations' });

    feed.held = [];
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    const card = within(within(pinned()).getByText('Birthday').closest('li')!);
    await act(async () => {
      fireEvent.click(card.getByRole('button', { name: 'Decline' }));
    });
    await waitFor(() => expect(feedRow(/^You declined/)).toBeInTheDocument());
    // The focus read, then the one the answer's invites-changed sent.
    expect(feed.held).toHaveLength(2);

    await act(async () => feed.held![0]());
    expect(feedRow(/^You declined/)).toBeInTheDocument();
    expect(screen.queryByText(/@alice invited you to/)).toBeNull();
    await act(async () => feed.held![1]());
    expect(feedRow(/^You declined/)).toBeInTheDocument();
  });

  it('reads the feed again when an invite turns out to be gone, so its row can catch up', async () => {
    feed.rows = [inviteRow('w1', 'Birthday', 'alice')];
    mockFetch(gone);
    render(<ActivityPage />);
    await screen.findByRole('region', { name: 'Invitations' });
    const before = feed.reads;

    const card = within(within(pinned()).getByText('Birthday').closest('li')!);
    await act(async () => {
      fireEvent.click(card.getByRole('button', { name: 'Accept' }));
    });
    await waitFor(() => expect(feed.reads).toBeGreaterThan(before));
  });

  it('Try again on the invitations alone keeps the feed up', async () => {
    feed.rows = [inviteRow('w9', 'Graduation', 'zoe')];
    const lists: ((reply: Reply) => void)[] = [];
    stubFetch(
      async () => declined,
      () => new Promise<Reply>((resolve) => lists.push(resolve))
    );
    render(<ActivityPage />);
    await act(async () =>
      lists[0]({ status: 500, body: { success: false, error: 'Failed to load invites' } })
    );
    expect(
      await screen.findByRole('heading', { name: 'Couldn’t load your invitations' })
    ).toBeVisible();
    expect(screen.getByText(/@zoe invited you to/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    // The feed stays, with an invitation's shape where the cards will go.
    expect(screen.getByText(/@zoe invited you to/)).toBeInTheDocument();
    expect(document.querySelector('.skeleton')).not.toBeNull();
    expect(screen.queryByText('You’re all caught up')).toBeNull();

    await act(async () => lists[1](listed(invites)));
    expect(within(pinned()).getByText('Birthday')).toBeInTheDocument();
    expect(screen.getByText(/@zoe invited you to/)).toBeInTheDocument();
  });

  it('shows the invites with no empty state when the feed is empty', async () => {
    mockFetch(declined);
    render(<ActivityPage />);
    await screen.findByText('Birthday');
    expect(screen.queryByText('You’re all caught up')).toBeNull();
  });
});

// WIS-189: an answer had no timeout, so one that stalled kept its card disabled
// and, since every read is held off while an answer is in flight, froze the list.
describe('Activity, pinned invites — an answer that stalls', () => {
  afterEach(() => vi.useRealTimers());

  it('regression: gives up after the timeout, says so, frees the card, and reads the list again', async () => {
    const { list, listRequests } = mockHeldFetch({ holdLists: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<ActivityPage />);
    await list(0, listed(invites));
    expect(screen.getByText('Birthday')).toBeInTheDocument();

    fireEvent.click(cardButtons('Birthday').accept);
    expectDisabled('Birthday');
    // A read while it's on its way is dropped, and waits for it.
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await list(1, listed([housewarming]));
    expect(screen.getByText('Birthday')).toBeInTheDocument();
    expect(listRequests()).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ITEM_REQUEST_TIMEOUT_MS);
    });
    expect(showToast).toHaveBeenCalledWith(REQUEST_TIMEOUT_MESSAGE, 'error');
    expect(push).not.toHaveBeenCalled();
    expectEnabled('Birthday');
    // The list is read again, and that read decides: the server had taken it.
    expect(listRequests()).toBe(3);
    await list(2, listed([housewarming]));
    expect(screen.queryByText('Birthday')).toBeNull();
    expect(screen.getByText('Housewarming')).toBeInTheDocument();
  });

  it('reads the list again after a timeout even when no read was dropped meanwhile', async () => {
    const { list, listRequests } = mockHeldFetch({ holdLists: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<ActivityPage />);
    await list(0, listed(invites));

    fireEvent.click(cardButtons('Birthday').decline);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ITEM_REQUEST_TIMEOUT_MS);
    });
    expect(showToast).toHaveBeenCalledWith(REQUEST_TIMEOUT_MESSAGE, 'error');
    expect(listRequests()).toBe(2);
    await list(1, listed(invites));
    expectEnabled('Birthday');
  });
});
