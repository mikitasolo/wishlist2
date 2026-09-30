// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

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
    _id: 'inv-gone',
    role: 'member',
    wishlistId: 'w1',
    wishlistName: 'Birthday',
    wishlistSlug: 'birthday',
    invitedByUsername: 'alice',
    invitedByImage: null,
  },
  {
    _id: 'inv-live',
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

/** Serves the invite list, and answers every PATCH with `reply`. */
function mockFetch(reply: Reply) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      if (reply instanceof Error) throw reply;
      const json =
        'html' in reply
          ? async () => {
              throw new SyntaxError('Unexpected token <');
            }
          : async () => reply.body;
      return { ok: reply.status < 400, status: reply.status, json };
    }
    if (url === '/api/users/me/invites') {
      return { ok: true, status: 200, json: async () => ({ success: true, data: invites }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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
