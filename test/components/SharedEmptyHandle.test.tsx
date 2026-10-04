// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const { session } = vi.hoisted(() => ({
  session: { user: { id: 'me', username: 'maria_nowak' } as Record<string, unknown> },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: session.user }, status: 'authenticated' }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import SharedWishlistsPage from '@/app/wishlists/shared/page';

beforeEach(() => {
  session.user = { id: 'me', username: 'maria_nowak' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { owned: [], member: [] } }),
    }))
  );
});

describe('Shared with you, empty', () => {
  it('tells you friends invite you by your own username, with Copy', async () => {
    render(<SharedWishlistsPage />);
    expect(await screen.findByText('Nothing shared yet')).toBeInTheDocument();
    expect(screen.getByText(/Friends invite you by your username/)).toBeInTheDocument();
    expect(screen.getByText('@maria_nowak')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy your profile link' })).toBeInTheDocument();
  });

  it('names no handle for an account without a username', async () => {
    session.user = { id: 'me' };
    render(<SharedWishlistsPage />);
    expect(await screen.findByText('Nothing shared yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy your profile link' })).toBeNull();
  });
});
