// @vitest-environment jsdom
// The budget filter (WIS-326): "Under X" in the viewer's currency, for gifters
// only, never saved, and it never moves a chip's count.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiItem } from '@/types/api';

const { router, showToast, params, viewer } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  showToast: vi.fn(),
  params: { id: 'camping' },
  // Carol, signed in; a test changes her default currency.
  viewer: { defaultCurrency: 'pln' as string | undefined },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'carol', username: 'carol', defaultCurrency: viewer.defaultCurrency } },
    status: 'authenticated',
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => params,
}));

vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import WishlistDetail from '@/app/wishlists/[id]/page';

let userRole: 'owner' | 'member';
let listItems: ApiItem[];

const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

function item(name: string, value: number, currency: string, day: number): ApiItem {
  return {
    _id: name,
    wishlist: 'w1',
    name,
    status: 'available',
    price: { value, currency },
    createdAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
    updatedAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`,
  } as ApiItem;
}

// Units per USD.
const RATES = { usd: 1, eur: 0.5, pln: 4, gbp: 0.25 };
// Whether /api/currency-rates answers.
let ratesFail: boolean;
const fetchMock = vi.fn();
const ratesReads = () =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/currency-rates').length;

beforeEach(() => {
  localStorage.clear();
  viewer.defaultCurrency = 'PLN';
  userRole = 'member';
  // Item currencies are stored lowercase.
  listItems = [item('Tent', 10000, 'eur', 1), item('Stove', 4000, 'pln', 2)];
  ratesFail = false;
  fetchMock.mockReset();
  vi.stubGlobal(
    'fetch',
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/currency-rates') {
        return ratesFail
          ? reply({ success: false, error: 'Failed' }, 500)
          : reply({ success: true, data: { rates: RATES } });
      }
      if (url === '/api/wishlists/camping/items') return reply({ success: true, data: listItems });
      if (url === '/api/wishlists/camping') {
        return reply({
          success: true,
          data: {
            _id: 'w1',
            name: 'Camping',
            slug: 'camping',
            description: '',
            owners: userRole === 'owner' ? ['carol'] : ['alice'],
            ownerUsernames: userRole === 'owner' ? ['carol'] : ['alice'],
            userRole,
            visibility: 'everyone',
            archived: false,
            featured: false,
            currency: 'EUR',
            bannerUrl: null,
            occasion: null,
          },
        });
      }
      return reply({ success: true, data: [] });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open() {
  const view = render(<WishlistDetail />);
  await screen.findByRole('heading', { level: 1, name: 'Camping' });
  await waitFor(() => expect(screen.queryAllByRole('article').length).toBeGreaterThan(0));
  return view;
}

const budget = () => screen.queryByRole('textbox', { name: /Show items under this price/ });
const shown = () => screen.queryAllByRole('article').map((a) => a.getAttribute('aria-label'));

describe('budget filter', () => {
  beforeEach(() => {
    listItems = [
      item('Tent', 10000, 'eur', 1), // 800 PLN
      item('Stove', 4000, 'pln', 2),
      item('Lamp', 2000, 'usd', 3), // 80 PLN
      { ...item('Gift card', 0, 'pln', 4), price: undefined } as ApiItem,
    ];
  });

  it('keeps items within the limit in the viewer’s currency, and items with no price', async () => {
    await open();
    await userEvent.type(budget()!, '100');
    await waitFor(() =>
      expect([...shown()].sort()).toEqual(['Item: Gift card', 'Item: Lamp', 'Item: Stove'])
    );
  });

  it('keeps an item whose price can’t be converted (no rate) rather than guessing', async () => {
    listItems = [item('Odd', 99999900, 'xyz', 1), item('Stove', 4000, 'pln', 2)];
    await open();
    await userEvent.type(budget()!, '10');
    await waitFor(() => expect(shown()).toEqual(['Item: Odd']));
  });

  it('says so when nothing is under the limit, and Show all clears it', async () => {
    listItems = listItems.slice(0, 3);
    await open();
    await userEvent.type(budget()!, '1');
    expect(await screen.findByText('No items are under that price.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }));
    await waitFor(() => expect(shown()).toHaveLength(3));
    expect(budget()).toHaveValue('');
  });

  it('does not change a chip’s count', async () => {
    await open();
    const before = screen.getAllByRole('radio').map((r) => r.textContent);
    await userEvent.type(budget()!, '100');
    await waitFor(() => expect(shown()).toHaveLength(3));
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(before);
  });

  it('follows the currency picked in Prices, keeping the typed amount', async () => {
    const user = userEvent.setup();
    await open();
    await user.type(budget()!, '15');
    expect(budget()).toHaveAccessibleName(/in PLN/);
    await waitFor(() => expect(shown()).toEqual(['Item: Gift card']));

    await user.click(screen.getByRole('combobox', { name: 'Show prices in' }));
    await user.click(screen.getByRole('option', { name: /^USD/ }));
    // The same "15", now dollars: the Stove (10 USD) is within it.
    expect(budget()).toHaveValue('15');
    expect(budget()).toHaveAccessibleName(/in USD/);
    await waitFor(() => expect([...shown()].sort()).toEqual(['Item: Gift card', 'Item: Stove']));
  });

  it('falls back to the account’s default currency when Prices is on each item’s own', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('combobox', { name: 'Show prices in' }));
    await user.click(screen.getByRole('option', { name: 'Each item’s currency' }));
    await user.type(budget()!, '15');
    expect(budget()).toHaveAccessibleName(/in PLN/);
    await waitFor(() => expect(shown()).toEqual(['Item: Gift card']));
  });

  it('is not saved: a fresh visit starts without it', async () => {
    const view = await open();
    await userEvent.type(budget()!, '50');
    view.unmount();
    await open();
    expect(budget()).toHaveValue('');
    expect(shown()).toHaveLength(4);
    expect(Object.keys(localStorage).filter((k) => /budget/i.test(k))).toEqual([]);
  });

  it('is not offered to an owner', async () => {
    userRole = 'owner';
    await open();
    expect(budget()).toBeNull();
  });

  it('is not offered when no item has a price', async () => {
    listItems = [{ ...item('Gift card', 0, 'pln', 4), price: undefined } as ApiItem];
    await open();
    expect(budget()).toBeNull();
  });
});
