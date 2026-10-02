// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import type { ReactNode } from 'react';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

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
// about the "Reserved by you" tile.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/GlobalSearch', () => ({ default: () => null }));
vi.mock('@/components/CreateWishlistModal', () => ({ default: () => null }));
vi.mock('@/components/FollowListModal', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import Home from '@/app/page';

const owned = [
  {
    _id: 'w1',
    slug: 'birthday',
    name: 'Birthday',
    visibility: 'everyone',
    itemCount: 2,
    owners: ['me'],
    featured: false,
    occasion: null,
  },
];

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

let countResponse: () => ReturnType<typeof json>;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  countResponse = () => json({ success: true, data: { count: 3 } });
  fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/wishlists') return json({ success: true, data: { owned, member: [] } });
    if (url === '/api/users/me/reservations/count') return countResponse();
    if (url === '/api/users/me') {
      return json({ success: true, data: { _id: 'me', followerCount: 0, followingCount: 0 } });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const reservedTile = () => screen.findByRole('link', { name: /Reserved by you/ });
const requested = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url).length;

describe('dashboard — Reserved by you', () => {
  it('shows the count from the count read, and never reads the Booked page’s list', async () => {
    render(<Home />);
    const tile = await reservedTile();

    expect(await within(tile).findByText('3')).toBeInTheDocument();
    expect(tile).toHaveAttribute('href', '/booked');
    expect(requested('/api/users/me/reservations/count')).toBe(1);
    expect(requested('/api/users/me/reservations')).toBe(0);
  });

  it('shows 0 when the count can’t be read', async () => {
    let bodyRead!: () => void;
    const read = new Promise<void>((resolve) => (bodyRead = resolve));
    countResponse = () => {
      const failed = json({ success: false, error: 'Failed to count reservations' }, 500);
      return {
        ...failed,
        json: async () => {
          bodyRead();
          return failed.json();
        },
      };
    };
    render(<Home />);
    const tile = await reservedTile();
    // Once the reply is read, let the page's handling of it run out.
    await act(async () => {
      await read;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(within(tile).getByText('0')).toBeInTheDocument();
    expect(showToast).not.toHaveBeenCalled();
  });
});
