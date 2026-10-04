// @vitest-environment jsdom
// Which currency a list's prices show in (D9): someone else's list starts in
// the viewer's default currency, as Settings and the currency prompt promise,
// an owner's own list on each item's currency, a pick is remembered for that
// viewer, and Prices is only offered when it would change something.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiItem } from '@/types/api';
import { pricesChoiceKey } from '@/lib/utils/listPrices';

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

const prices = () => screen.queryByRole('combobox', { name: 'Show prices in' });
const card = (name: string) => screen.getByRole('article', { name: `Item: ${name}` });

describe("someone else's list", () => {
  it("starts on the viewer's currency, with converted prices shown as approximate over the original", async () => {
    await open();

    expect(prices()).toHaveTextContent('PLN');
    // €100 is $200 is 800 zł: approximate, with the original under it.
    await waitFor(() => expect(within(card('Tent')).getByText(/^≈/)).toBeInTheDocument());
    expect(within(card('Tent')).getByText(/^≈/)).toHaveTextContent(/800/);
    expect(within(card('Tent')).getByText('€100.00')).toBeInTheDocument();
    // Already in the viewer's currency: exact, with no "≈".
    expect(within(card('Stove')).queryByText(/≈/)).toBeNull();
  });

  it("starts on the viewer's currency whatever case the session has it in", async () => {
    viewer.defaultCurrency = 'pln';
    await open();
    expect(prices()).toHaveTextContent('PLN');
  });

  it('remembers a pick of each item’s own currency for that viewer, on the next list too', async () => {
    const user = userEvent.setup();
    const first = await open();

    await user.click(prices()!);
    await user.click(screen.getByRole('option', { name: 'Each item’s currency' }));
    expect(prices()).toHaveTextContent('Original');
    expect(within(card('Tent')).queryByText(/≈/)).toBeNull();
    expect(localStorage.getItem(pricesChoiceKey('carol', 'others'))).toBe('original');

    first.unmount();
    await open();
    expect(prices()).toHaveTextContent('Original');
    expect(within(card('Tent')).queryByText(/≈/)).toBeNull();
  });

  it('forgets the pick once the viewer goes back to their default, so they follow it if it changes', async () => {
    localStorage.setItem(pricesChoiceKey('carol', 'others'), 'GBP');
    const user = userEvent.setup();
    await open();
    expect(prices()).toHaveTextContent('GBP');

    await user.click(prices()!);
    await user.click(screen.getByRole('option', { name: /^PLN .*your default$/ }));
    expect(prices()).toHaveTextContent('PLN');
    expect(localStorage.getItem(pricesChoiceKey('carol', 'others'))).toBeNull();
  });
});

describe("the owner's own list", () => {
  it("starts on each item's own currency", async () => {
    userRole = 'owner';
    await open();
    expect(prices()).toHaveTextContent('Original');
    expect(within(card('Tent')).getByText('€100.00')).toBeInTheDocument();
    expect(within(card('Tent')).queryByText(/≈/)).toBeNull();
  });

  it("keeps a pick on their own lists apart from the one on other people's", async () => {
    userRole = 'owner';
    localStorage.setItem(pricesChoiceKey('carol', 'others'), 'GBP');
    const user = userEvent.setup();
    const first = await open();
    expect(prices()).toHaveTextContent('Original');

    await user.click(prices()!);
    await user.click(screen.getByRole('option', { name: /^PLN/ }));
    // Their own currency, kept as such: it follows a new default.
    expect(localStorage.getItem(pricesChoiceKey('carol', 'own'))).toBe('mine');

    first.unmount();
    await open();
    expect(prices()).toHaveTextContent('PLN');
  });
});

describe('when Prices is offered', () => {
  it("is hidden when every price is already in the viewer's currency", async () => {
    listItems = [item('Tent', 10000, 'pln', 1), item('Stove', 4000, 'pln', 2)];
    await open();
    expect(prices()).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Sort items by' })).toBeInTheDocument();
    expect(within(card('Tent')).queryByText(/≈/)).toBeNull();
  });

  it('is hidden even with a remembered pick, which then changes nothing', async () => {
    localStorage.setItem(pricesChoiceKey('carol', 'others'), 'GBP');
    listItems = [item('Tent', 10000, 'pln', 1)];
    await open();
    expect(prices()).toBeNull();
    expect(within(card('Tent')).queryByText(/≈/)).toBeNull();
  });

  // regression: Prices named the viewer's currency while the cards, with no
  // rates to convert by, still showed every price in its own.
  it("regression: isn't offered while the rates can't be read, and every price shows as it is", async () => {
    ratesFail = true;
    await open();
    await waitFor(() => expect(ratesReads()).toBe(1));
    expect(prices()).toBeNull();
    expect(within(card('Tent')).getByText('€100.00')).toBeInTheDocument();
    expect(within(card('Tent')).queryByText(/≈/)).toBeNull();
  });

  it("doesn't read the rates when every price is in the viewer's currency", async () => {
    listItems = [item('Tent', 10000, 'pln', 1)];
    await open();
    expect(ratesReads()).toBe(0);
  });

  it("is offered on a list all in one currency that isn't the viewer's", async () => {
    viewer.defaultCurrency = 'USD';
    listItems = [item('Tent', 10000, 'eur', 1)];
    await open();
    expect(prices()).toHaveTextContent('USD');
  });
});
