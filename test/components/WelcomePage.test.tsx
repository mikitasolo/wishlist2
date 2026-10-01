// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const { replace, showToast, update, auth, params } = vi.hoisted(() => ({
  replace: vi.fn(),
  showToast: vi.fn(),
  update: vi.fn(),
  // Mutable per test: the session, and the welcome page's query string.
  auth: {
    status: 'authenticated' as 'authenticated' | 'unauthenticated' | 'loading',
    username: 'user_4f9k2x7q' as string | undefined,
  },
  params: { search: '' },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data:
      auth.status === 'authenticated'
        ? { user: { id: 'me', email: 'jane.doe@example.com', username: auth.username } }
        : null,
    status: auth.status,
    update,
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(params.search),
}));
// The header has its own fetches and tests; this file is about the page.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import WelcomePage from '@/app/welcome/page';

type Reply = { status: number; body: unknown } | Error;
let patchReply: Reply;
let available: boolean;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url.startsWith('/api/users/check-username')) {
    return { ok: true, json: async () => ({ success: true, available, reason: 'ok' }) };
  }
  if (url === '/api/users/me' && init?.method === 'PATCH') {
    if (patchReply instanceof Error) throw patchReply;
    const { status, body } = patchReply;
    return { ok: status < 400, status, json: async () => body };
  }
  throw new Error(`unexpected fetch ${url}`);
});

const patches = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PATCH')
    .map(([, init]) => JSON.parse(String(init!.body)));
const keep = () => screen.getByRole('button', { name: 'Keep @user_4f9k2x7q' });
const save = () => screen.getByRole('button', { name: /save username|saving/i });

/** Type a new name and wait until the field shows it's free. */
async function chooseAvailable(name: string) {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: name } });
  expect(await screen.findByText('Available')).toBeInTheDocument();
}

beforeEach(() => {
  cleanup();
  replace.mockReset();
  showToast.mockReset();
  update.mockReset().mockResolvedValue(null);
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
  auth.status = 'authenticated';
  auth.username = 'user_4f9k2x7q';
  params.search = 'callbackUrl=%2Finvites';
  available = true;
  patchReply = {
    status: 200,
    body: { success: true, data: { username: 'jane_d' } },
  };
});

describe('Welcome page', () => {
  it('offers to replace the generated username, starting from it', () => {
    render(<WelcomePage />);

    expect(screen.getByRole('heading', { name: 'Welcome to Wishlist' })).toBeInTheDocument();
    expect(screen.getByText('@user_4f9k2x7q')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveValue('user_4f9k2x7q');
    // Nothing to save until it's changed to something free.
    expect(save()).toBeDisabled();
    expect(keep()).toBeEnabled();
  });

  it('keeps the generated username and continues to where the sign-in was headed', () => {
    render(<WelcomePage />);
    fireEvent.click(keep());

    expect(replace).toHaveBeenCalledWith('/invites');
    expect(patches()).toEqual([]);
  });

  // Auth.js passes the callback URL along absolute (resolved against the site).
  it('continues to an absolute same-origin callback URL as a path', () => {
    params.search = `callbackUrl=${encodeURIComponent(
      `${window.location.origin}/wishlists/abc?tab=items`
    )}`;
    render(<WelcomePage />);
    fireEvent.click(keep());

    expect(replace).toHaveBeenCalledWith('/wishlists/abc?tab=items');
  });

  it('never follows a callback URL off the site', () => {
    for (const offsite of ['https://evil.example/phish', '//evil.example', 'javascript:alert(1)']) {
      cleanup();
      replace.mockReset();
      params.search = `callbackUrl=${encodeURIComponent(offsite)}`;
      render(<WelcomePage />);
      fireEvent.click(keep());

      expect(replace, offsite).toHaveBeenCalledWith('/');
    }
  });

  it('goes home without a callback URL', () => {
    params.search = '';
    render(<WelcomePage />);
    fireEvent.click(keep());

    expect(replace).toHaveBeenCalledWith('/');
  });

  it('saves a chosen username through the profile API, then continues', async () => {
    render(<WelcomePage />);
    await chooseAvailable('jane_d');

    fireEvent.click(save());

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/invites'));
    expect(patches()).toEqual([{ username: 'jane_d' }]);
    // The session (and so the header) picks the new name up.
    expect(update).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('Username saved', 'success');
  });

  it('can’t save a name that is taken', async () => {
    available = false;
    render(<WelcomePage />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'janedoe' } });

    expect(await screen.findByText('Taken')).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it('stays on the page with the reason when the save is refused', async () => {
    patchReply = {
      status: 409,
      body: { success: false, error: 'That username is already taken.' },
    };
    render(<WelcomePage />);
    await chooseAvailable('jane_d');

    fireEvent.click(save());

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('That username is already taken.', 'error')
    );
    expect(replace).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    // Free to try another name, or keep the generated one.
    expect(keep()).toBeEnabled();
    expect(screen.getByLabelText('Username')).toBeEnabled();
  });

  it('stays on the page when the save fails to reach the server', async () => {
    patchReply = new TypeError('Failed to fetch');
    render(<WelcomePage />);
    await chooseAvailable('jane_d');

    fireEvent.click(save());

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("Couldn't save your username", 'error')
    );
    expect(replace).not.toHaveBeenCalled();
    expect(keep()).toBeEnabled();
  });

  it('offers to skip when the account has no username to keep', () => {
    auth.username = undefined;
    render(<WelcomePage />);

    expect(screen.getByLabelText('Username')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    expect(replace).toHaveBeenCalledWith('/invites');
  });

  it('sends a signed-out visitor home', () => {
    auth.status = 'unauthenticated';
    render(<WelcomePage />);

    expect(replace).toHaveBeenCalledWith('/');
    expect(screen.queryByLabelText('Username')).toBeNull();
  });
});
