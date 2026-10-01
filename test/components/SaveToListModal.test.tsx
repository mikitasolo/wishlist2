// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import type { ApiItem } from '@/types/api';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
// ImageUpload pulls in react-easy-crop: stand in with its value and a remove button.
vi.mock('@/components/ImageUpload', () => ({
  default: ({ value, onChange }: { value: string | null; onChange: (v: null) => void }) => (
    <div data-testid="image-upload">
      {value}
      <button type="button" onClick={() => onChange(null)}>
        Remove image
      </button>
    </div>
  ),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import SaveToListModal from '@/components/SaveToListModal';

const IMAGE = 'https://store.public.blob.vercel-storage.com/uploads/alice/image-abc.jpg';

const source: ApiItem = {
  _id: 'item-1',
  wishlist: 'w-source',
  name: 'Blue Mug',
  imageUrl: IMAGE,
  price: { value: 2500, currency: 'eur' },
  link: 'https://shop.example.com/mug',
  notes: 'Size M, the dark blue one',
  mostWanted: true,
  status: 'available',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// What GET /api/wishlists answers: the lists the viewer owns (co-owned ones
// included, archived ones too), and the ones they're only a member of.
const OWNED = [
  { _id: 'w-source', name: 'Where the item is', currency: 'USD', itemCount: 3 },
  { _id: 'w-birthday', name: 'Birthday', currency: 'PLN', itemCount: 1 },
  { _id: 'w-home', name: 'Home', currency: 'USD', itemCount: 0 },
  { _id: 'w-old', name: 'Last year', currency: 'USD', archived: true, itemCount: 9 },
];
const MEMBER = [{ _id: 'w-friend', name: "Friend's list", currency: 'USD', isMember: true }];

type Reply = { success: boolean; data?: unknown; error?: string; notice?: string };

/** Serves the viewer's lists, and answers the copy's POST with `post`. */
function stubFetch({
  owned = OWNED,
  post = async (): Promise<Reply> => ({ success: true, data: { _id: 'copy-1' } }),
}: { owned?: unknown[]; post?: () => Promise<Reply> } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return { json: post };
    if (url === '/api/wishlists') {
      return { json: async () => ({ success: true, data: { owned, member: MEMBER } }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function open(onClose = vi.fn()) {
  render(<SaveToListModal item={source} userCurrency="USD" onClose={onClose} />);
  return { onClose };
}

const picker = () => screen.getByRole('dialog', { name: 'Save to my list' });

async function pick(name: string) {
  fireEvent.click(await within(picker()).findByRole('button', { name: new RegExp(name) }));
  return screen.getByRole('dialog', { name: `Save to ${name}` });
}

/** The JSON body of the copy's POST. */
function postedBody(fetchMock: ReturnType<typeof stubFetch>) {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
  if (!call) throw new Error('no POST');
  return { url: call[0], body: JSON.parse(String(call[1]?.body)) };
}

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => {
  cleanup();
  showToast.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('SaveToListModal — the list picker', () => {
  it("offers only the viewer's own lists that aren't archived, without the item's own", async () => {
    stubFetch();
    open();

    const dialog = picker();
    await within(dialog).findByRole('button', { name: /Birthday/ });
    const offered = within(dialog)
      .getAllByRole('button')
      .map((b) => b.textContent)
      .filter((t) => t !== '');
    expect(offered).toEqual(['Birthday1 item', 'Home0 items']);
    expect(within(dialog).queryByText('Last year')).toBeNull();
    expect(within(dialog).queryByText("Friend's list")).toBeNull();
    expect(within(dialog).queryByText('Where the item is')).toBeNull();
  });

  it('says so, and links to creating one, when there is no list to save to', async () => {
    stubFetch({ owned: [OWNED[0], OWNED[3]] });
    open();

    expect(await screen.findByText(/don.t have another wishlist/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create a wishlist/i })).toHaveAttribute(
      'href',
      '/wishlists/new'
    );
  });

  it('says so when the lists fail to load, and loads them again on "Try again"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    open();

    expect(await screen.findByText(/couldn.t load your lists/i)).toBeInTheDocument();

    const fetchMock = stubFetch();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await within(picker()).findByRole('button', { name: /Birthday/ })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/wishlists', { cache: 'no-store' });
  });

  it('puts focus back on what opened it, once the form it hands over to closes', async () => {
    stubFetch();
    function Page() {
      const [isOpen, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Save to my list</button>
          {isOpen && (
            <SaveToListModal item={source} userCurrency="USD" onClose={() => setOpen(false)} />
          )}
        </>
      );
    }
    render(<Page />);
    const opener = screen.getByRole('button', { name: 'Save to my list' });
    opener.focus();
    fireEvent.click(opener);

    const form = await pick('Birthday');
    expect(form.contains(document.activeElement)).toBe(true);
    fireEvent.click(within(form).getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('closes without saving anything', async () => {
    const fetchMock = stubFetch();
    const { onClose } = open();
    await within(picker()).findByRole('button', { name: /Birthday/ });

    fireEvent.click(within(picker()).getByRole('button', { name: 'Close modal' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
});

describe('SaveToListModal — the prefilled form', () => {
  it('starts on the name, price and currency, link and image, but not the notes or flag', async () => {
    stubFetch();
    open();
    const form = await pick('Birthday');

    expect(within(form).getByLabelText(/item name/i)).toHaveValue('Blue Mug');
    expect(within(form).getByLabelText(/^price$/i)).toHaveValue(25);
    // The item's own currency, not the target list's (PLN).
    expect(within(form).getByRole('button', { name: 'EUR' })).toBeInTheDocument();
    expect(within(form).getByLabelText(/product link/i)).toHaveValue(source.link);
    expect(within(form).getByTestId('image-upload')).toHaveTextContent(IMAGE);
    expect(within(form).getByLabelText(/notes/i)).toHaveValue('');
    expect(within(form).getByRole('switch', { name: 'Most wanted' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });

  it('posts the copy, with its sourceItemId, to the picked list, then says so and closes', async () => {
    const fetchMock = stubFetch();
    const { onClose } = open();
    const form = await pick('Birthday');

    fireEvent.change(within(form).getByLabelText(/item name/i), {
      target: { value: 'Blue Mug, large' },
    });
    fireEvent.click(within(form).getByRole('button', { name: /^add item$/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const { url, body } = postedBody(fetchMock);
    expect(url).toBe('/api/wishlists/w-birthday/items');
    expect(body).toEqual({
      name: 'Blue Mug, large',
      imageUrl: IMAGE,
      price: { value: 2500, currency: 'eur' },
      link: source.link,
      mostWanted: false,
      status: 'available',
      sourceItemId: 'item-1',
    });
    expect(showToast).toHaveBeenCalledWith('Saved to Birthday', 'success');
  });

  it('leaves out a field the user cleared, rather than sending null', async () => {
    const fetchMock = stubFetch();
    const { onClose } = open();
    const form = await pick('Home');

    fireEvent.click(within(form).getByRole('button', { name: 'Remove image' }));
    fireEvent.change(within(form).getByLabelText(/product link/i), { target: { value: '' } });
    fireEvent.click(within(form).getByRole('button', { name: /^add item$/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const { body } = postedBody(fetchMock);
    expect(body).not.toHaveProperty('imageUrl');
    expect(body).not.toHaveProperty('link');
    expect(body).not.toHaveProperty('notes');
  });

  it("passes on the server's note when the image couldn't be copied", async () => {
    const notice = 'Saved without the image: your upload space is full.';
    stubFetch({ post: async () => ({ success: true, data: { _id: 'copy-1' }, notice }) });
    const { onClose } = open();
    const form = await pick('Birthday');

    fireEvent.click(within(form).getByRole('button', { name: /^add item$/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith('Saved to Birthday', 'success');
    expect(showToast).toHaveBeenCalledWith(notice, 'info');
  });

  it('keeps the form and its input open, with the error, when saving fails', async () => {
    stubFetch({ post: async () => ({ success: false, error: 'Item not found' }) });
    const { onClose } = open();
    const form = await pick('Birthday');

    fireEvent.change(within(form).getByLabelText(/item name/i), { target: { value: 'Edited' } });
    fireEvent.click(within(form).getByRole('button', { name: /^add item$/i }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Item not found', 'error'));
    expect(onClose).not.toHaveBeenCalled();
    expect(within(form).getByLabelText(/item name/i)).toHaveValue('Edited');
    expect(within(form).getByRole('button', { name: /^add item$/i })).toBeEnabled();
    expect(showToast).not.toHaveBeenCalledWith(expect.stringMatching(/^Saved/), 'success');
  });
});
