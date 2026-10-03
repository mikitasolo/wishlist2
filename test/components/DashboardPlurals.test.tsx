// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'me', username: 'me' } },
    status: 'authenticated',
  }),
  signIn: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The header and the dialogs have their own fetches and tests; this file is
// about the counts the dashboard writes out.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/GlobalSearch', () => ({ default: () => null }));
vi.mock('@/components/CurrencyPrompt', () => ({ default: () => null }));
vi.mock('@/components/CreateWishlistModal', () => ({ default: () => null }));
vi.mock('@/components/FollowListModal', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import Home from '@/app/page';

const list = {
  _id: 'w1',
  slug: 'birthday',
  name: 'Birthday',
  visibility: 'everyone',
  itemCount: 1,
  owners: ['me'],
  featured: false,
  occasion: null,
};

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function serve({ itemCount, followers }: { itemCount: number; followers: number }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/wishlists') {
        return json({ success: true, data: { owned: [{ ...list, itemCount }], member: [] } });
      }
      if (url === '/api/users/me/reservations/count') {
        return json({ success: true, data: { count: 0 } });
      }
      if (url === '/api/users/me') {
        return json({
          success: true,
          data: { _id: 'me', followerCount: followers, followingCount: followers },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    })
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('dashboard — counts and their nouns', () => {
  beforeEach(() => serve({ itemCount: 1, followers: 1 }));

  // regression: the Featured card read "Public · 1 items", and the header
  // "1 followers": each wrote a plural noun after its count, whatever the count.
  it('regression: says "1 item" and "1 follower", not "1 items" and "1 followers"', async () => {
    render(<Home />);

    expect(await screen.findByText('Public · 1 item')).toBeInTheDocument();
    expect(screen.getByText('1 list · 1 item in your lists')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '1 follower' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 following' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/\b1 (items|followers|lists)\b/);
  });

  it('uses the plural for any other count', async () => {
    serve({ itemCount: 3, followers: 0 });
    render(<Home />);

    expect(await screen.findByText('Public · 3 items')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '0 followers' })).toBeInTheDocument();
  });
});
