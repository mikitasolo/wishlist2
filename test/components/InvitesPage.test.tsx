// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react';

const { push, showToast } = vi.hoisted(() => ({ push: vi.fn(), showToast: vi.fn() }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// The header (and the invitation dot inside it) has its own fetches and tests;
// this file is about the page's cards.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));

vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import InvitesPage from '@/app/invites/page';

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

/** Serves the invite list, and answers each PATCH with whatever `patch` resolves to. */
function stubFetch(patch: (url: string) => Promise<Reply>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return toResponse(await patch(url));
    if (url === '/api/users/me/invites') {
      return { ok: true, status: 200, json: async () => ({ success: true, data: invites }) };
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
 * with `answer`, so several invites can be in flight at once.
 */
function mockHeldFetch() {
  const held = new Map<string, ((reply: Reply) => void)[]>();
  const fetchMock = stubFetch(
    (url) => new Promise<Reply>((resolve) => held.set(url, [...(held.get(url) ?? []), resolve]))
  );
  return {
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

const invitesChanged = vi.fn();

async function clickOnFirstCard(name: 'Accept' | 'Decline') {
  render(<InvitesPage />);
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
  window.addEventListener('invites-changed', invitesChanged);
});
afterEach(() => {
  window.removeEventListener('invites-changed', invitesChanged);
  vi.unstubAllGlobals();
});

describe('InvitesPage — an invite that no longer exists', () => {
  // regression: a 404 from PATCH /api/invites/[id] (the invite was cancelled,
  // its list deleted, or the invitee kicked or demoted while /invites was open)
  // was shown as a generic error toast and the card stayed, so every retry 404'd
  // again and the header's invitation dot stayed lit until a reload.
  it.each(['Accept', 'Decline'] as const)(
    'regression: drops the card and refreshes the dot when %s gets a 404',
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

describe('InvitesPage — failures worth retrying keep the card', () => {
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

describe('InvitesPage — answering an invite', () => {
  it('declining drops the card and refreshes the dot', async () => {
    mockFetch({ status: 200, body: { success: true, data: { status: 'declined' } } });
    await clickOnFirstCard('Decline');

    await waitFor(() => expect(screen.queryByText('Birthday')).toBeNull());
    expect(invitesChanged).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('Invitation declined', 'info');
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

    await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/birthday'));
    expect(screen.queryByText('Birthday')).toBeNull();
    expect(invitesChanged).toHaveBeenCalledTimes(1);
  });
});

describe('InvitesPage — answering several invites at once', () => {
  const declined: Reply = { status: 200, body: { success: true, data: { status: 'declined' } } };
  const failed: Reply = { status: 500, body: { success: false, error: 'Failed to update invite' } };
  const gone: Reply = { status: 404, body: { success: false, error: 'Invite not found' } };
  const joined = (wishlistSlug: string, wishlistId: string): Reply => ({
    status: 200,
    body: { success: true, data: { status: 'accepted', wishlistSlug, wishlistId } },
  });

  async function renderHeld() {
    const held = mockHeldFetch();
    render(<InvitesPage />);
    await screen.findByText('Birthday');
    return held;
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

  it('re-enables a card whose answer failed while another is still in flight', async () => {
    const { answer } = await renderHeld();

    fireEvent.click(cardButtons('Birthday').accept);
    fireEvent.click(cardButtons('Housewarming').accept);

    await answer('inv-birthday', failed);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to update invite', 'error'));
    expectEnabled('Birthday');
    expectDisabled('Housewarming');

    await answer('inv-housewarming', joined('housewarming', 'w2'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/housewarming'));
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
      await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/birthday'));
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
});
