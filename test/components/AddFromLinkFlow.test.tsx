// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';

const { showToast, push } = vi.hoisted(() => ({ showToast: vi.fn(), push: vi.fn() }));

vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'me', defaultCurrency: 'USD' } } }),
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
// ImageUpload pulls in react-easy-crop: stand in with its value.
vi.mock('@/components/ImageUpload', () => ({
  default: ({ value, busy }: { value: string | null; busy?: boolean }) => (
    <div data-testid="image-upload" data-busy={busy ? 'true' : 'false'}>
      {value}
    </div>
  ),
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
  post: () => Promise<Reply> = async () => ({ success: true, data: { _id: 'new-1' } }),
  // POST /api/upload/from-url: by default the re-hosting fails.
  rehost: () => Promise<{ success: boolean; url?: string }> = async () => ({ success: false })
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/upload/from-url') return { json: rehost };
    if (url === '/api/upload' && init?.method === 'DELETE') return { json: async () => ({}) };
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

  it('focuses the first list, not the close button, when the picker opens', async () => {
    stubFetch();
    render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);

    const first = await within(picker()).findByRole('button', { name: /Birthday/ });
    await waitFor(() => expect(first).toHaveFocus());
  });

  it('puts focus back on the list you came from after "Change list"', async () => {
    stubFetch();
    render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);
    const form = await pick('Home');
    fireEvent.click(within(form).getByRole('button', { name: 'Change list' }));
    const home = await within(picker()).findByRole('button', { name: /Home/ });
    await waitFor(() => expect(home).toHaveFocus());
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
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/items'))).toBe(false);
  });

  it('adds the item as sent by the form, then lands on the list with a toast', async () => {
    const fetchMock = stubFetch();
    render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);

    const form = await pick('Birthday');
    fireEvent.click(within(form).getByRole('button', { name: /^add to list$/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/birthday-ab12c'));
    const post = fetchMock.mock.calls.find(([url]) => String(url).includes('/items'))!;
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
    const post = fetchMock.mock.calls.find(([url]) => String(url).includes('/items'))!;
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
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/items'))).toBe(false);
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

describe('AddFromLinkFlow image re-hosting (WIS-366)', () => {
  const BLOB = 'https://blob.example.com/uploads/me/mug.webp';
  const calls = (fetchMock: ReturnType<typeof stubFetch>, method: string, path: string) =>
    fetchMock.mock.calls.filter(([url, init]) => url === path && init?.method === method);

  // Lets every pending promise chain (the mocked fetch, `res.json()`, the
  // timeout race) run to its end, and React flush what they set: no polling.
  const flush = () =>
    act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });

  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }

  it('sends the image and the product link, shows the photo uploading, then the blob', async () => {
    const d = deferred<{ success: boolean; url?: string }>();
    const fetchMock = stubFetch(OWNED, undefined, () => d.promise);
    render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);

    const form = await pick('Birthday');
    expect(within(form).getByTestId('image-upload')).toHaveAttribute('data-busy', 'true');
    const [, init] = calls(fetchMock, 'POST', '/api/upload/from-url')[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      url: 'https://cdn.example.com/mug.jpg',
      page: 'https://shop.example.com/mug',
    });

    d.resolve({ success: true, url: BLOB });
    await flush();
    expect(within(form).getByTestId('image-upload')).toHaveAttribute('data-busy', 'false');
    expect(within(form).getByTestId('image-upload')).toHaveTextContent(BLOB);

    // A save keeps it: sent as the item's image, never handed back.
    fireEvent.click(within(form).getByRole('button', { name: /^add to list$/i }));
    await flush();
    expect(push).toHaveBeenCalled();
    const post = fetchMock.mock.calls.find(([url]) => String(url).includes('/items'))!;
    expect(JSON.parse(String(post[1]?.body)).imageUrl).toBe(BLOB);
    expect(calls(fetchMock, 'DELETE', '/api/upload')).toHaveLength(0);
  });

  it('falls back to the store image when re-hosting fails', async () => {
    const d = deferred<{ success: boolean }>();
    stubFetch(OWNED, undefined, () => d.promise);
    render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);

    const form = await pick('Birthday');
    expect(within(form).getByTestId('image-upload')).toHaveAttribute('data-busy', 'true');
    d.resolve({ success: false });
    await flush();
    expect(within(form).getByTestId('image-upload')).toHaveAttribute('data-busy', 'false');
    expect(within(form).getByTestId('image-upload')).toHaveTextContent(
      'https://cdn.example.com/mug.jpg'
    );
  });

  it('falls back to the store image when the request itself fails', async () => {
    stubFetch(OWNED, undefined, async () => {
      throw new Error('network');
    });
    render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);

    const form = await pick('Birthday');
    await flush();
    expect(within(form).getByTestId('image-upload')).toHaveAttribute('data-busy', 'false');
    expect(within(form).getByTestId('image-upload')).toHaveTextContent(
      'https://cdn.example.com/mug.jpg'
    );
  });

  it('does not call the endpoint for a product without an image', async () => {
    const fetchMock = stubFetch();
    render(<AddFromLinkFlow product={{ name: 'Blue Mug' }} userCurrency="USD" />);
    await pick('Birthday');
    expect(calls(fetchMock, 'POST', '/api/upload/from-url')).toHaveLength(0);
  });

  it('keeps the blob across "Change list" and hands it back when the flow closes', async () => {
    const fetchMock = stubFetch(OWNED, undefined, async () => ({ success: true, url: BLOB }));
    const { unmount } = render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);

    let form = await pick('Birthday');
    await flush();
    expect(within(form).getByTestId('image-upload')).toHaveTextContent(BLOB);
    fireEvent.click(within(form).getByRole('button', { name: /change list/i }));
    // Unsaved changes aren't asked about: the prefill is the baseline, blob included.
    form = await pick('Home');
    expect(within(form).getByTestId('image-upload')).toHaveTextContent(BLOB);
    expect(calls(fetchMock, 'DELETE', '/api/upload')).toHaveLength(0);
    expect(calls(fetchMock, 'POST', '/api/upload/from-url')).toHaveLength(1);

    unmount();
    const [, init] = calls(fetchMock, 'DELETE', '/api/upload')[0];
    expect(JSON.parse(String(init?.body))).toEqual({ url: BLOB });
  });

  it('hands the blob back if the flow closes before the image arrives', async () => {
    const d = deferred<{ success: boolean; url?: string }>();
    const fetchMock = stubFetch(OWNED, undefined, () => d.promise);
    const { unmount } = render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);
    await within(picker()).findByRole('button', { name: /Birthday/ });

    unmount();
    d.resolve({ success: true, url: BLOB });
    await flush();
    expect(calls(fetchMock, 'DELETE', '/api/upload')).toHaveLength(1);
  });

  // regression: a save pressed while the photo was still being fetched went out
  // with no photo, and the blob that landed later was handed back.
  it('holds both save buttons until the photo has settled, then saves it', async () => {
    const d = deferred<{ success: boolean; url?: string }>();
    const fetchMock = stubFetch(OWNED, undefined, () => d.promise);
    render(<AddFromLinkFlow product={PRODUCT} userCurrency="USD" />);

    const form = await pick('Birthday');
    const add = within(form).getByRole('button', { name: /^add to list$/i });
    const draft = within(form).getByRole('button', { name: /^save as draft$/i });
    expect(add).toBeDisabled();
    expect(draft).toBeDisabled();
    // Enter in a field is held too.
    fireEvent.submit(
      within(form)
        .getByLabelText(/item name/i)
        .closest('form')!
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/items'))).toBe(false);

    d.resolve({ success: true, url: BLOB });
    await flush();
    expect(within(form).getByTestId('image-upload')).toHaveTextContent(BLOB);
    expect(add).toBeEnabled();
    fireEvent.click(add);
    await flush();
    expect(push).toHaveBeenCalled();
    const post = fetchMock.mock.calls.find(([url]) => String(url).includes('/items'))!;
    expect(JSON.parse(String(post[1]?.body)).imageUrl).toBe(BLOB);
  });
});
