// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'me', email: 'me@example.com', username: 'mikita' } },
    status: 'authenticated',
  }),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/components/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import AuthButton from '@/components/AuthButton';

function mockInvites(count: number) {
  const data = Array.from({ length: count }, (_, i) => ({ _id: `inv-${i}` }));
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ success: true, data }),
  }) as unknown as typeof fetch;
}

beforeEach(() => cleanup());
afterEach(() => vi.restoreAllMocks());

describe('AuthButton — pending-invitation dot', () => {
  // Regression: the header must surface pending invitations with a dot.
  it('regression: marks the menu button when invitations are pending', async () => {
    mockInvites(2);
    render(<AuthButton />);
    // aria-label gains "— new invitations" when the dot is shown.
    expect(await screen.findByRole('button', { name: /new invitations/i })).toBeInTheDocument();
  });

  it('shows no indicator when there are no invitations', async () => {
    mockInvites(0);
    render(<AuthButton />);
    // Give the mount fetch a tick to resolve.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: /new invitations/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^account menu$/i })).toBeInTheDocument();
  });

  // Regression: acting on invites elsewhere fires `invites-changed` so the dot
  // updates without a reload/navigation.
  it('regression: refreshes the dot on the invites-changed event', async () => {
    mockInvites(0);
    render(<AuthButton />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: /new invitations/i })).toBeNull();

    mockInvites(1);
    await act(async () => {
      window.dispatchEvent(new Event('invites-changed'));
    });
    expect(await screen.findByRole('button', { name: /new invitations/i })).toBeInTheDocument();
  });
});
