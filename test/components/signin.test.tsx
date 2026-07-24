// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next-auth/react', () => ({ signIn: vi.fn() }));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { signIn } from 'next-auth/react';
import SignIn from '@/app/auth/signin/page';

const mockedSignIn = vi.mocked(signIn);

async function submitEmail() {
  await userEvent.type(screen.getByLabelText(/email address/i), 'me@example.com');
  await userEvent.click(screen.getByRole('button', { name: /send magic link/i }));
}

beforeEach(() => {
  cleanup();
  mockedSignIn.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('SignIn — submit result handling', () => {
  it('shows the "check your email" screen when the link was sent', async () => {
    mockedSignIn.mockResolvedValue({ ok: true, error: null } as never);
    render(<SignIn />);

    await submitEmail();

    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // regression: with redirect:false, signIn RESOLVES with { error } instead of
  // throwing, so a blocked send (e.g. the sign-in rate limit) must surface an
  // error — not the false "check your email" success screen.
  it('surfaces an error and does NOT claim success when the send is blocked', async () => {
    mockedSignIn.mockResolvedValue({ error: 'EmailSignin', ok: false } as never);
    render(<SignIn />);

    await submitEmail();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn't send your magic link/i);
    expect(screen.queryByText(/check your email/i)).toBeNull();
  });
});
