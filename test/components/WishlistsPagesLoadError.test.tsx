// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'me', username: 'me' } }, status: 'authenticated' }),
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
vi.mock('@/components/CreateWishlistModal', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import MyWishlistsPage from '@/app/wishlists/mine/page';
import SharedWishlistsPage from '@/app/wishlists/shared/page';

const fetchMock = vi.fn();

function list(id: string, name: string) {
  return { _id: id, name, slug: id, visibility: 'everyone', owners: ['me'], archived: false };
}

const FAILURES: [string, () => Promise<unknown>][] = [
  ['a 5xx', async () => ({ ok: false, json: async () => ({ success: false, error: 'Boom' }) })],
  [
    'a network error',
    async () => {
      throw new TypeError('Failed to fetch');
    },
  ],
];

beforeEach(() => {
  showToast.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe.each([
  ['My wishlists', MyWishlistsPage, 'Couldn’t load your wishlists', 'No wishlists yet', 'owned'],
  [
    'Shared with you',
    SharedWishlistsPage,
    'Couldn’t load your shared wishlists',
    'Nothing shared yet',
    'member',
  ],
] as const)('%s — a first load that fails', (_n, Page, errorTitle, emptyTitle, key) => {
  // regression: a failed read toasted, then said the user had no lists, which
  // claims their data is empty.
  it.each(FAILURES)(
    'regression: shows a load error after %s, and Try again reads again',
    async (_l, fail) => {
      fetchMock.mockImplementationOnce(fail);
      render(<Page />);

      expect(await screen.findByRole('heading', { name: errorTitle })).toBeInTheDocument();
      expect(screen.queryByText(emptyTitle)).toBeNull();
      expect(showToast).not.toHaveBeenCalled();

      fetchMock.mockImplementationOnce(async () => ({
        ok: true,
        json: async () => ({
          success: true,
          data: { owned: [], member: [], [key]: [list('trip', 'Trip')] },
        }),
      }));
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

      expect((await screen.findAllByText('Trip')).length).toBeGreaterThan(0);
      expect(screen.queryByRole('heading', { name: errorTitle })).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  );

  it('still says there is nothing when the read succeeds and is empty', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({ success: true, data: { owned: [], member: [] } }),
    }));
    render(<Page />);
    expect(await screen.findByText(emptyTitle)).toBeInTheDocument();
  });
});
