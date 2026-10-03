// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'me', username: 'me' } }, status: 'authenticated' }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
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

const LIST_NAMES: Record<string, string> = { birthday: 'Birthday', flat: 'Flat', old: 'Old flat' };

function item(id: string, status: string, wishlistId: string, wishlistArchived = false) {
  return {
    _id: id,
    name: id,
    imageUrl: null,
    price: null,
    priceInUsdCents: null,
    link: null,
    mostWanted: false,
    status,
    wishlistId,
    wishlistSlug: wishlistId,
    wishlistName: LIST_NAMES[wishlistId],
    wishlistArchived,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

// The API folds booked into available for an owner, so there's none here.
const ACTIVE = [
  item('Bike', 'available', 'birthday'),
  item('Reserve', 'completed', 'birthday'),
  item('Lamp', 'draft', 'birthday'),
  item('Kite', 'proposed', 'birthday'),
];
const ARCHIVED = [item('Boxes', 'available', 'old', true), item('Tape', 'draft', 'old', true)];

const BASE = '/api/users/me/items';
const WITH_ARCHIVED = `${BASE}?includeArchived=true`;

let replies: Record<string, () => Promise<unknown>>;
let fetchMock: ReturnType<typeof vi.fn>;

function reply(data: unknown[], archivedItems = ARCHIVED.length) {
  return async () => ({ ok: true, json: async () => ({ success: true, data, archivedItems }) });
}

beforeEach(() => {
  localStorage.clear();
  replies = { [BASE]: reply(ACTIVE), [WITH_ARCHIVED]: reply([...ACTIVE, ...ARCHIVED]) };
  fetchMock = vi.fn((url: string) => {
    const r = replies[url];
    if (!r) throw new Error(`unexpected fetch ${url}`);
    return r();
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const requested = () => fetchMock.mock.calls.map(([url]) => url);
const subtitle = () => screen.getByText(/across the wishlists you own/i);
const shown = (name: string) => screen.queryByText(name, { selector: 'p' });
const allTile = () => screen.getByRole('button', { name: /^All \d+$/ });

async function openListFilter() {
  fireEvent.click(await screen.findByRole('button', { name: 'All lists' }));
  return screen.getByRole('checkbox', { name: 'Include archived' });
}

describe('/items — counts and archived lists', () => {
  // regression: the page read archived lists' items too, so its counts
  // disagreed with the dashboard's.
  it('regression: leaves archived lists out by default, counting as the dashboard does', async () => {
    render(<MyItemsPage />);

    expect(await screen.findByText('Bike', { selector: 'p' })).toBeInTheDocument();
    expect(requested()).toEqual([BASE]);
    expect(shown('Boxes')).toBeNull();
    expect(subtitle()).toHaveTextContent(
      'Across the wishlists you own: 2 items · 1 draft · 1 to review'
    );
    // "All" takes in the drafts and proposals, so it isn't called a total.
    expect(allTile()).toHaveTextContent('All4');
    expect(screen.queryByText('Total')).toBeNull();
  });

  it('brings the archived lists in through the List filter, and takes them out again', async () => {
    render(<MyItemsPage />);
    const toggle = await openListFilter();
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    expect(await screen.findByText('Boxes', { selector: 'p' })).toBeInTheDocument();
    expect(requested()).toEqual([BASE, WITH_ARCHIVED]);
    expect(subtitle()).toHaveTextContent(
      'Across the wishlists you own, archived ones too: 3 items · 2 drafts · 1 to review'
    );
    // The archived list is selected in the filter, and says it's archived.
    expect(screen.getByRole('checkbox', { name: 'Old flat (archived)' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Birthday' })).toBeChecked();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived' }));
    await waitFor(() => expect(shown('Boxes')).toBeNull());
    expect(requested()).toEqual([BASE, WITH_ARCHIVED, BASE]);
    expect(screen.queryByRole('checkbox', { name: 'Old flat (archived)' })).toBeNull();
    expect(shown('Bike')).toBeInTheDocument();
  });

  it('keeps the lists you had picked when the archived ones come in', async () => {
    replies[BASE] = reply([...ACTIVE, item('Rug', 'available', 'flat')]);
    replies[WITH_ARCHIVED] = reply([...ACTIVE, item('Rug', 'available', 'flat'), ...ARCHIVED]);
    localStorage.setItem('items-wishlist-filters', JSON.stringify(['flat']));
    render(<MyItemsPage />);

    expect(await screen.findByText('Rug', { selector: 'p' })).toBeInTheDocument();
    expect(shown('Bike')).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'Flat' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived' }));
    expect(await screen.findByText('Boxes', { selector: 'p' })).toBeInTheDocument();
    expect(shown('Rug')).toBeInTheDocument();
    expect(shown('Bike')).toBeNull();
  });

  it('drops a read that a later toggle has replaced', async () => {
    let answerArchived!: () => void;
    const archivedRead = new Promise<void>((resolve) => (answerArchived = resolve));
    replies[WITH_ARCHIVED] = async () => {
      await archivedRead;
      return reply([...ACTIVE, ...ARCHIVED])();
    };
    render(<MyItemsPage />);
    const toggle = await openListFilter();

    fireEvent.click(toggle); // asks for the archived lists…
    expect(toggle).toBeChecked();
    fireEvent.click(toggle); // …and stops before they arrive
    await waitFor(() => expect(requested()).toEqual([BASE, WITH_ARCHIVED, BASE]));
    await act(async () => {
      answerArchived();
      await archivedRead;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(shown('Boxes')).toBeNull();
    expect(toggle).not.toBeChecked();
  });

  it('leaves the box and the counts as they were when the read fails', async () => {
    replies[WITH_ARCHIVED] = async () => {
      throw new TypeError('Failed to fetch');
    };
    render(<MyItemsPage />);
    const toggle = await openListFilter();

    fireEvent.click(toggle);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Failed to load items', 'error'));
    expect(toggle).not.toBeChecked();
    expect(subtitle()).toHaveTextContent(
      'Across the wishlists you own: 2 items · 1 draft · 1 to review'
    );
    expect(shown('Boxes')).toBeNull();
  });

  it('goes back to every list when the archived lists were the only ones picked', async () => {
    render(<MyItemsPage />);
    fireEvent.click(await openListFilter());
    expect(await screen.findByText('Boxes', { selector: 'p' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Birthday' }));
    expect(shown('Bike')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived' }));

    expect(await screen.findByText('Bike', { selector: 'p' })).toBeInTheDocument();
    expect(shown('Boxes')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Birthday' })).toBeChecked();
  });

  it('offers the archived lists from the empty page when only they have items', async () => {
    replies[BASE] = reply([]);
    replies[WITH_ARCHIVED] = reply(ARCHIVED);
    render(<MyItemsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Include archived lists' }));
    expect(await screen.findByText('Boxes', { selector: 'p' })).toBeInTheDocument();
    expect(requested()).toEqual([BASE, WITH_ARCHIVED]);
  });

  it("doesn't offer them on the empty page when they hold nothing", async () => {
    replies[BASE] = reply([], 0);
    render(<MyItemsPage />);

    expect(await screen.findByText('No items yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Include archived lists' })).toBeNull();
  });
});

describe('/items — a first load that fails', () => {
  // regression: a failed read toasted, then said "No items yet", which claims
  // the lists are empty.
  it.each([
    [
      'a 5xx',
      async () => ({ ok: false, json: async () => ({ success: false, error: 'Something broke' }) }),
    ],
    [
      'a network error',
      async () => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ])('regression: says so in place after %s, and Try again reads them afresh', async (_l, fail) => {
    replies[BASE] = fail;
    render(<MyItemsPage />);

    expect(
      await screen.findByRole('heading', { name: 'Couldn’t load your items' })
    ).toBeInTheDocument();
    expect(screen.queryByText('No items yet')).toBeNull();
    expect(screen.queryByRole('button', { name: /^All \d+$/ })).toBeNull();
    expect(showToast).not.toHaveBeenCalled();

    replies[BASE] = reply(ACTIVE);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Bike', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Couldn’t load your items' })).toBeNull();
    expect(requested()).toEqual([BASE, BASE]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('restores the saved list filter from the read that succeeds, not the failed one', async () => {
    localStorage.setItem('items-wishlist-filters', JSON.stringify(['flat']));
    replies[BASE] = async () => {
      throw new TypeError('Failed to fetch');
    };
    render(<MyItemsPage />);
    await screen.findByRole('heading', { name: 'Couldn’t load your items' });

    replies[BASE] = reply([...ACTIVE, item('Rug', 'available', 'flat')]);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Rug', { selector: 'p' })).toBeInTheDocument();
    expect(shown('Bike')).toBeNull();
    expect(JSON.parse(localStorage.getItem('items-wishlist-filters') ?? '[]')).toEqual(['flat']);
  });
});
