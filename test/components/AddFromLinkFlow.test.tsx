// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

const { showToast, push } = vi.hoisted(() => ({ showToast: vi.fn(), push: vi.fn() }));

vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'me', defaultCurrency: 'USD' } } }),
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
// ImageUpload pulls in react-easy-crop: stand in with its value.
vi.mock('@/components/ImageUpload', () => ({
  default: ({ value }: { value: string | null }) => <div data-testid="image-upload">{value}</div>,
}));

import AddFromLinkFlow from '@/components/AddFromLinkFlow';
import type { ProductPrefill } from '@/lib/utils/productFragment';

const OWNED = [
  { _id: 'w-birthday', name: 'Birthday', slug: 'birthday-ab12c', currency: 'PLN', itemCount: 1 },
  { _id: 'w-home', name: 'Home', currency: 'USD', itemCount: 0 },
  { _id: 'w-old', name: 'Last year', currency: 'USD', archived: true, itemCount: 9 },
];

const PRODUCT: ProductPrefill = {
  name: 'Blue Mug',
  price: { value: 2490, currency: 'EUR' },
  imageUrl: 'https://cdn.example.com/mug.jpg',
  link: 'https://shop.example.com/mug',
};

type Reply = { success: boolean; data?: unknown; error?: string };

function stubFetch(
  owned: unknown[] = OWNED,
  post: () => Promise<Reply> = async () => ({ success: true, data: { _id: 'new-1' } })
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return { json: post };
    if (url === '/api/wishlists') {
      return { json: async () => ({ success: true, data: { owned, member: [] } }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const picker = () => screen.getByRole('dialog', { name: 'Add to a wishlist' });

async function pick(name: string) {
  fireEvent.click(await within(picker()).findByRole('button', { name: new RegExp(name) }));
  return screen.getByRole('dialog', { name: `Add to ${name}` });
}

beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => {
  cleanup();
  showToast.mockReset();
  push.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('AddFromLinkFlow', () => {
  it('offers only your own lists that are not archived', async () => {
    stubFetch();
    render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);

    await within(picker()).findByRole('button', { name: /Birthday/ });
    expect(within(picker()).getByRole('button', { name: /Home/ })).toBeInTheDocument();
    expect(within(picker()).queryByText('Last year')).toBeNull();
  });

  it('goes from the picker to the form prefilled with the product, saving nothing yet', async () => {
    const fetchMock = stubFetch();
    render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);

    const form = await pick('Birthday');
    expect(within(form).getByLabelText(/item name/i)).toHaveValue('Blue Mug');
    expect(within(form).getByLabelText(/product link/i)).toHaveValue(
      'https://shop.example.com/mug'
    );
    expect(within(form).getByLabelText(/^price$/i)).toHaveValue('24.90');
    expect(within(form).getByTestId('image-upload')).toHaveTextContent(
      'https://cdn.example.com/mug.jpg'
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('adds the item as sent by the form, then lands on the list with a toast', async () => {
    const fetchMock = stubFetch();
    render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);

    const form = await pick('Birthday');
    fireEvent.click(within(form).getByRole('button', { name: /^add to list$/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/birthday-ab12c'));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(post[0]).toBe('/api/wishlists/w-birthday/items');
    const body = JSON.parse(String(post[1]?.body));
    expect(body).toMatchObject({
      name: 'Blue Mug',
      price: { value: 2490, currency: 'EUR' },
      imageUrl: 'https://cdn.example.com/mug.jpg',
      link: 'https://shop.example.com/mug',
      status: 'available',
    });
    // A plain new item: never a copy of another.
    expect(body).not.toHaveProperty('sourceItemId');
    expect(showToast).toHaveBeenCalledWith('Added to Birthday', 'success');
    // The form closing itself after the save doesn't send the visitor Home.
    expect(push).not.toHaveBeenCalledWith('/');
  });

  it('falls back to the list id when it has no slug', async () => {
    stubFetch();
    render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);
    const form = await pick('Home');
    fireEvent.click(within(form).getByRole('button', { name: /^add to list$/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/w-home'));
  });

  it('saves a draft when asked', async () => {
    const fetchMock = stubFetch();
    render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);
    const form = await pick('Birthday');
    fireEvent.click(within(form).getByRole('button', { name: /^save as draft$/i }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(post[1]?.body)).status).toBe('draft');
    expect(showToast).toHaveBeenCalledWith('Saved as a draft in Birthday', 'success');
  });

  it('stays on the form with the input when the save fails', async () => {
    stubFetch(OWNED, async () => ({ success: false, error: 'Nope' }));
    render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);
    const form = await pick('Birthday');
    fireEvent.click(within(form).getByRole('button', { name: /^add to list$/i }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Nope', 'error'));
    expect(push).not.toHaveBeenCalled();
    expect(within(form).getByLabelText(/item name/i)).toHaveValue('Blue Mug');
  });

  it('"Change list" goes back to the picker', async () => {
    stubFetch();
    render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);
    const form = await pick('Birthday');
    fireEvent.click(within(form).getByRole('button', { name: 'Change list' }));
    expect(await within(picker()).findByRole('button', { name: /Home/ })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('opens an empty form with no product (an empty or garbage fragment), without an error', async () => {
    stubFetch();
    render(<AddFromLinkFlow product={null} userCurrency="USD" />);
    const form = await pick('Home');
    expect(within(form).getByLabelText(/item name/i)).toHaveValue('');
    expect(within(form).getByLabelText(/product link/i)).toHaveValue('');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('closing the picker or the form leaves for Home without saving', async () => {
    const fetchMock = stubFetch();
    render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);
    await within(picker()).findByRole('button', { name: /Birthday/ });
    fireEvent.click(within(picker()).getByRole('button', { name: 'Close modal' }));
    expect(push).toHaveBeenCalledWith('/');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('offers to create a wishlist when there is none', async () => {
    stubFetch([OWNED[2]]);
    render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);
    expect(await screen.findByText(/don.t have a wishlist yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create a wishlist/i })).toBeInTheDocument();
  });

  it('says so when the lists fail to load, and tries again', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);
    expect(await screen.findByText(/couldn.t load your lists/i)).toBeInTheDocument();
    stubFetch();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await within(picker()).findByRole('button', { name: /Birthday/ })).toBeInTheDocument();
  });
});
