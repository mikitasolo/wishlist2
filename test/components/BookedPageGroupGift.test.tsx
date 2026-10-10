// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { push, showToast } = vi.hoisted(() => ({ push: vi.fn(), showToast: vi.fn() }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'me', defaultCurrency: 'USD' } },
    status: 'authenticated',
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import BookedPage from '@/app/booked/page';
import { setDiscreetMode } from '@/lib/hooks/useDiscreetMode';

// WIS-363: a group gift on the Reserved page. A contributor's card shows their
// share, the gift's progress and everyone in it; only the organizer's offers
// Mark as given (for the whole gift), and Leave group gift stands in for
// Release, which a group gift's item refuses.

const base = {
  itemImage: null,
  itemPrice: { value: 10000, currency: 'USD' },
  wishlistName: 'Birthday',
  wishlistId: 'w1',
  wishlistSlug: 'birthday',
  wishlistOccasion: null,
  listOpen: true,
  listArchived: false,
  itemStatus: 'booked',
  stillReserved: true,
};

const gift = (organizer: boolean) => ({
  contributing: true as const,
  organizer,
  status: 'open' as const,
  target: { value: 10000, currency: 'USD' },
  pledgedTotal: 5000,
  percentFunded: 50,
  contributors: [
    { name: 'Anna Organizer', pledged: 3000, organizer: !organizer, you: organizer },
    { name: 'Ben Helper', pledged: 2000, organizer: false, you: !organizer },
  ],
});

// I'm Ben here: in the gift, not its organizer.
const joined = {
  ...base,
  _id: 'res-camera',
  itemId: 'item-camera',
  itemName: 'Camera',
  pledge: { value: 2000, currency: 'USD' },
  groupGift: gift(false),
};

// I'm the organizer of this one.
const organized = {
  ...base,
  _id: 'res-bike',
  itemId: 'item-bike',
  itemName: 'Bike',
  pledge: { value: 3000, currency: 'USD' },
  groupGift: gift(true),
};

const ok = (data: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => ({ success: true, data }) }) as Response;

let reservations: unknown[];
let fetchMock: ReturnType<typeof vi.fn>;

function mockFetch(actionReply: () => Response = () => ok({})) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url === '/api/users/me/reservations') return ok(reservations);
    if (method === 'GET' && url === '/api/users/me/gifts') return ok([]);
    if (method === 'GET' && url === '/api/currency-rates') return ok({ rates: { USD: 1 } });
    if (method !== 'GET') return actionReply();
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}

const card = (name: string) => screen.getByRole('article', { name });

beforeEach(() => {
  showToast.mockReset();
  reservations = [joined, organized];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BookedPage — a group gift you’re in', () => {
  it('shows your share, the progress and everyone in it', async () => {
    mockFetch();
    render(<BookedPage />);
    const camera = within(await screen.findByRole('article', { name: 'Camera' }));
    expect(camera.getByText('Your share')).toBeInTheDocument();
    expect(camera.getByText('Group gift · 50% funded')).toBeInTheDocument();
    expect(camera.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(camera.getByText('$50.00 of $100.00 pledged')).toBeInTheDocument();
    const people = within(camera.getByRole('list', { name: '2 contributors' }));
    expect(people.getByText('Anna Organizer')).toBeInTheDocument();
    expect(people.getByText('Organizer')).toBeInTheDocument();
    expect(people.getByText('You')).toBeInTheDocument();
    expect(people.queryByText('Ben Helper')).toBeNull();
    // "To give" totals your shares, not the items' whole prices.
    expect(screen.getByTestId('reserved-summary')).toHaveTextContent('2 to give ($50.00)');
  });

  it('a contributor who isn’t the organizer has no Mark as given, and Leave in place of Release', async () => {
    mockFetch();
    render(<BookedPage />);
    await screen.findByText('Camera');
    expect(within(card('Camera')).queryByRole('button', { name: 'Mark as given' })).toBeNull();
    expect(within(card('Camera')).getByText('The organizer marks it as given')).toBeInTheDocument();
    expect(within(card('Bike')).queryByText('The organizer marks it as given')).toBeNull();
    fireEvent.click(within(card('Camera')).getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Release' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Leave group gift' }));
    expect(screen.getByText('Your share comes off the total.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await waitFor(() => expect(screen.queryByText('Camera')).toBeNull());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/items/item-camera/group-gift/me',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(showToast).toHaveBeenCalledWith('You left the group gift', 'success');
  });

  it('the organizer’s Mark as given gives the whole gift, with an idempotency key', async () => {
    // As the server does: the reservation goes with the gift.
    mockFetch(() => {
      reservations = [joined];
      return ok({});
    });
    render(<BookedPage />);
    await screen.findByText('Bike');
    fireEvent.click(within(card('Bike')).getByRole('button', { name: 'Mark as given' }));
    expect(screen.getByText('Mark the group gift as given?')).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Mark as given' })
    );
    await waitFor(() => expect(screen.queryByText('Bike')).toBeNull());
    const [, init] = fetchMock.mock.calls.find(
      ([url]) => url === '/api/items/item-bike/group-gift/given'
    )!;
    expect(init.method).toBe('POST');
    expect(init.headers['Idempotency-Key']).toEqual(expect.any(String));
    // Never the solo route, which would log the whole price.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/reservations/'))).toBe(
      false
    );
    expect(showToast).toHaveBeenCalledWith('Marked as given', 'success');
  });

  it('an organizer leaving is told who takes over', async () => {
    mockFetch();
    render(<BookedPage />);
    await screen.findByText('Bike');
    fireEvent.click(within(card('Bike')).getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Leave group gift' }));
    expect(screen.getByText('Ben Helper becomes the organizer.')).toBeInTheDocument();
  });

  it('a refused action keeps the card and reads the page again', async () => {
    mockFetch(
      () =>
        ({
          ok: false,
          status: 409,
          json: async () => ({ success: false, error: 'This group gift has ended' }),
        }) as Response
    );
    render(<BookedPage />);
    await screen.findByText('Bike');
    const reads = () =>
      fetchMock.mock.calls.filter(([url]) => url === '/api/users/me/reservations').length;
    const before = reads();
    fireEvent.click(within(card('Bike')).getByRole('button', { name: 'Mark as given' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Mark as given' })
    );
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('This group gift has ended', 'info')
    );
    expect(reads()).toBeGreaterThan(before);
    expect(screen.getByText('Bike')).toBeInTheDocument();
  });

  it('a changed card of a gift you were in shows your share, which "I gave it" logs', async () => {
    reservations = [
      {
        ...joined,
        groupGift: null,
        stillReserved: false,
        itemStatus: 'completed',
      },
    ];
    mockFetch();
    render(<BookedPage />);
    const row = within(await screen.findByRole('article', { name: 'Camera' }));
    expect(row.getByText(/Your share/)).toBeInTheDocument();
    expect(row.getByText('$20.00')).toBeInTheDocument();
    expect(row.queryByText('$100.00')).toBeNull();
  });
});

describe('BookedPage — a group gift in discreet mode', () => {
  afterEach(() => act(() => setDiscreetMode(false)));

  it('covers the gift, its people and amounts until Show', async () => {
    setDiscreetMode(true);
    mockFetch();
    render(<BookedPage />);
    await act(async () => {});
    expect(screen.getByText('No spoiler mode is on')).toBeInTheDocument();
    for (const hidden of ['Camera', 'Anna Organizer', 'Group gift · 50% funded', 'Your share']) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
    await userEvent.setup().click(screen.getByRole('button', { name: 'Show' }));
    expect(await screen.findAllByText('Group gift · 50% funded')).toHaveLength(2);
  });
});
