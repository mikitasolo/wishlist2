// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
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

// The header and the dialogs have their own tests; this file is about Home's
// links to the pages behind its sections (WIS-251).
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/GlobalSearch', () => ({ default: () => null }));
vi.mock('@/components/CurrencyPrompt', () => ({ default: () => null }));
vi.mock('@/components/CreateWishlistModal', () => ({ default: () => null }));
vi.mock('@/components/FollowListModal', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import Home from '@/app/page';

function lists(n: number, prefix: string, owner: string) {
  return Array.from({ length: n }, (_, i) => ({
    _id: `${prefix}${i}`,
    slug: `${prefix}-${i}`,
    name: `${prefix} ${i}`,
    visibility: 'everyone',
    itemCount: 1,
    owners: [owner],
    featured: false,
    occasion: null,
  }));
}

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function serve(ownedCount: number, sharedCount: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/wishlists') {
        return json({
          success: true,
          data: {
            owned: lists(ownedCount, 'own', 'me'),
            member: lists(sharedCount, 'shared', 'friend'),
          },
        });
      }
      if (url === '/api/users/me/reservations/count') {
        return json({ success: true, data: { count: 0 } });
      }
      if (url === '/api/users/me') {
        return json({ success: true, data: { _id: 'me', followerCount: 0, followingCount: 0 } });
      }
      throw new Error(`unexpected fetch ${url}`);
    })
  );
}

/** The lists a section links to, once each (a phone's row and a card link alike). */
function linkedLists(prefix: string) {
  return new Set(
    [...document.querySelectorAll<HTMLAnchorElement>(`a[href^="/wishlists/${prefix}-"]`)].map((a) =>
      a.getAttribute('href')
    )
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('Home — links to the pages behind its sections', () => {
  it('links All items beside the Your wishlists heading', async () => {
    serve(2, 0);
    render(<Home />);
    const heading = await screen.findByRole('heading', { name: 'Your wishlists' });
    const allItems = screen.getByRole('link', { name: 'All items' });
    expect(allItems).toHaveAttribute('href', '/items');
    expect(heading.parentElement).toContainElement(allItems);
  });

  it('shows every list, and no See all, when a section fits', async () => {
    serve(8, 8);
    render(<Home />);
    await screen.findByRole('heading', { name: 'Shared with you' });
    expect(linkedLists('own').size).toBe(8);
    expect(linkedLists('shared').size).toBe(8);
    expect(screen.queryByRole('link', { name: /^See all/ })).toBeNull();
  });

  it('shows the first 8 and "See all (n)" to the section’s page when it overflows', async () => {
    serve(11, 9);
    render(<Home />);
    await screen.findByRole('heading', { name: 'Shared with you' });

    expect(linkedLists('own').size).toBe(8);
    expect(linkedLists('shared').size).toBe(8);
    expect(screen.getByRole('link', { name: 'See all (11)' })).toHaveAttribute(
      'href',
      '/wishlists/mine'
    );
    expect(screen.getByRole('link', { name: 'See all (9)' })).toHaveAttribute(
      'href',
      '/wishlists/shared'
    );
  });
});
