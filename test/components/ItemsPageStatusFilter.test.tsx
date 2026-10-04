// @vitest-environment jsdom
// The items page's status chips (the owner's, as on a list's page) start on All
// every visit, live in the URL and never in storage. Its sort is remembered.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

const { router, showToast } = vi.hoisted(() => ({
  router: { push: vi.fn() },
  showToast: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'carol', username: 'carol' } },
    status: 'authenticated',
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import MyItemsPage from '@/app/items/page';

const item = (name: string, status: string, day: number) => ({
  _id: name,
  name,
  imageUrl: null,
  price: null,
  priceInUsdCents: null,
  link: null,
  mostWanted: false,
  status,
  wishlistId: 'w1',
  wishlistSlug: 'birthday',
  wishlistName: 'Birthday',
  createdAt: `2026-01-0${day}T00:00:00.000Z`,
});

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/items');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url !== '/api/users/me/items') throw new Error(`unexpected fetch ${url}`);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: [
            item('Lamp', 'available', 1),
            item('Sketch', 'draft', 2),
            item('Idea', 'proposed', 3),
            item('Vase', 'completed', 4),
          ],
        }),
      };
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The item cards' names, in order. */
const shown = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
const chip = (label: string) => screen.getByRole('radio', { name: new RegExp(`^${label} \\d+$`) });

async function visit(waitFor = 'Lamp') {
  const view = render(<MyItemsPage />);
  await screen.findByRole('heading', { name: waitFor });
  return view;
}

// Under All the actionable items come first (proposals, drafts, live, received),
// each group in the sort (newest first by default).
const ALL = ['Idea', 'Sketch', 'Lamp', 'Vase'];

describe('/items status chips', () => {
  it('counts the owner chips, with nothing about a reservation', async () => {
    await visit();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'All 4',
      'Drafts 1',
      'Proposals 1',
      'Live 1',
      'Received 1',
    ]);
    expect(screen.queryByText(/reserved/i)).toBeNull();
  });

  it('orders All actionable-first and dims what is received', async () => {
    await visit();
    expect(shown()).toEqual(ALL);
    expect(screen.getByRole('article', { name: 'Item: Vase' })).toHaveAttribute('data-dimmed');
    expect(screen.getByRole('article', { name: 'Item: Lamp' })).not.toHaveAttribute('data-dimmed');
  });

  it('filters by chip, and keeps it in the URL but not in storage', async () => {
    const user = userEvent.setup();
    await visit();
    await user.click(chip('Drafts'));
    expect(shown()).toEqual(['Sketch']);
    expect(window.location.search).toBe('?show=drafts');
    expect(localStorage.length).toBe(0);
    await user.click(chip('All'));
    expect(shown()).toEqual(ALL);
    expect(window.location.search).toBe('');
  });

  it('opens on the chip the URL names, and on All for one it does not have', async () => {
    window.history.replaceState(null, '', '/items?show=received');
    const first = await visit('Vase');
    expect(shown()).toEqual(['Vase']);
    first.unmount();
    window.history.replaceState(null, '', '/items?show=reserved-by-you');
    await visit();
    expect(shown()).toEqual(ALL);
  });

  it('regression: ignores and deletes a status filter an earlier version saved', async () => {
    localStorage.setItem('items-status-filters', JSON.stringify(['draft']));
    await visit();
    expect(shown()).toEqual(ALL);
    expect(localStorage.getItem('items-status-filters')).toBeNull();
  });

  it('searches by name within the chip, and says so when nothing matches', async () => {
    const user = userEvent.setup();
    await visit();
    await user.type(screen.getByLabelText('Search items by name'), 'sk');
    expect(shown()).toEqual(['Sketch']);
    await user.click(chip('Live'));
    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('links a card to its item on its list, and names the list', async () => {
    await visit();
    const article = screen.getByRole('article', { name: 'Item: Lamp' });
    expect(within(article).getByRole('link', { name: 'Lamp' })).toHaveAttribute(
      'href',
      '/wishlists/birthday?item=Lamp'
    );
    expect(within(article).getByRole('link', { name: 'Birthday' })).toHaveAttribute(
      'href',
      '/wishlists/birthday'
    );
  });

  it('remembers the sort', async () => {
    const user = userEvent.setup();
    const first = await visit();
    await user.click(screen.getByRole('combobox', { name: 'Sort items by' }));
    await user.click(screen.getByRole('option', { name: 'Name (A-Z)' }));
    expect(shown()).toEqual(['Idea', 'Sketch', 'Lamp', 'Vase']);

    first.unmount();
    await visit();

    expect(shown()).toEqual(['Idea', 'Sketch', 'Lamp', 'Vase']);
  });
});
