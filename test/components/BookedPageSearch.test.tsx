// @vitest-environment jsdom
// The Reserved page's search (WIS-424): item, person and list over the rows
// already loaded, kept in ?q=, never over what No spoiler mode covers.
import { describe, it, expect, vi, beforeEach, afterEach, onTestFinished } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'me', defaultCurrency: 'USD' } },
    status: 'authenticated',
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import BookedPage from '@/app/booked/page';
import { setDiscreetMode } from '@/lib/hooks/useDiscreetMode';

const base = {
  itemImage: null,
  itemPrice: null,
  wishlistId: 'w1',
  wishlistSlug: 'birthday',
  listOpen: true,
  listArchived: false,
  itemStatus: 'booked',
  stillReserved: true,
};
const reservations = [
  {
    ...base,
    _id: 'r1',
    itemId: 'i1',
    itemName: 'Lego set',
    wishlistName: 'Birthday',
    wishlistOwnerUsername: 'alice',
  },
  {
    ...base,
    _id: 'r2',
    itemId: 'i2',
    itemName: 'Kettle',
    wishlistName: 'Housewarming',
    wishlistOwnerUsername: 'bob',
  },
  {
    ...base,
    _id: 'r3',
    itemId: 'i3',
    itemName: 'Scarf',
    wishlistName: 'Winter',
    wishlistOwnerUsername: 'carol',
    itemStatus: 'deleted',
    stillReserved: false,
  },
];
const gifts = [
  {
    _id: 'g1',
    itemName: 'Cookbook',
    itemImage: null,
    itemPrice: null,
    recipientUsername: 'dave',
    wishlistName: 'Dinner',
    wishlistId: 'w9',
    giftedAt: '2026-01-01T00:00:00.000Z',
  },
];

beforeEach(() => {
  window.history.replaceState(null, '', '/booked');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const data =
        url === '/api/users/me/reservations'
          ? reservations
          : url === '/api/users/me/gifts'
            ? gifts
            : null;
      if (!data) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ success: true, data }) };
    })
  );
});
afterEach(() => {
  cleanup();
  act(() => setDiscreetMode(false));
  vi.unstubAllGlobals();
});

const box = () => screen.findByLabelText(/Search reservations/);

describe('BookedPage search', () => {
  it('narrows To give, changed rows and history by item, person and list, and keeps ?q=', async () => {
    const user = userEvent.setup();
    render(<BookedPage />);
    const field = await box();
    expect(await screen.findByText('Cookbook')).toBeInTheDocument();

    await user.type(field, 'alice');
    expect(screen.getByText('Lego set')).toBeInTheDocument();
    expect(screen.queryByText('Kettle')).toBeNull();
    expect(screen.queryByText('Scarf')).toBeNull();
    expect(screen.queryByText('Cookbook')).toBeNull();
    expect(window.location.search).toBe('?q=alice');

    await user.clear(field);
    await user.type(field, 'winter');
    expect(screen.getByText('Scarf')).toBeInTheDocument();
    expect(screen.queryByText('Lego set')).toBeNull();

    await user.clear(field);
    await user.type(field, '@dave');
    expect(screen.getByText('Cookbook')).toBeInTheDocument();
    expect(screen.queryByText('Scarf')).toBeNull();
  });

  it('says no matches, and Show all brings everything back and drops ?q=', async () => {
    const user = userEvent.setup();
    render(<BookedPage />);
    await user.type(await box(), 'zzz');
    expect(screen.getByText('No matches')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getByText('Lego set')).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  // regression: a ?q= link to an account with nothing reserved said "No matches" with no field to clear.
  it('shows the real empty state for a ?q= link when nothing is reserved or given', async () => {
    const [savedReservations, savedGifts] = [[...reservations], [...gifts]];
    onTestFinished(() => {
      reservations.splice(0, 0, ...savedReservations);
      gifts.splice(0, 0, ...savedGifts);
    });
    reservations.splice(0);
    gifts.splice(0);
    window.history.replaceState(null, '', '/booked?q=kettle');
    render(<BookedPage />);
    expect(await screen.findByText('Nothing reserved yet')).toBeInTheDocument();
    expect(screen.queryByText('No matches')).toBeNull();
  });

  it('opens at a ?q= link already filtered', async () => {
    window.history.replaceState(null, '', '/booked?q=kettle');
    render(<BookedPage />);
    expect(await screen.findByText('Kettle')).toBeInTheDocument();
    expect(screen.queryByText('Lego set')).toBeNull();
  });

  it('does not search, or show, what No spoiler mode covers until Show', async () => {
    setDiscreetMode(true);
    window.history.replaceState(null, '', '/booked?q=kettle');
    render(<BookedPage />);
    await act(async () => {});
    expect(screen.queryByLabelText(/Search reservations/)).toBeNull();
    expect(screen.queryByText('Kettle')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show' }));
    expect(await screen.findByText('Kettle')).toBeInTheDocument();
  });
});
