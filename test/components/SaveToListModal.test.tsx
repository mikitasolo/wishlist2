// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import type { ApiItem } from '@/types/api';

const { showToast, push } = vi.hoisted(() => ({ showToast: vi.fn(), push: vi.fn() }));

vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
// For CreateWishlistModal, which the picker opens when there's no list to pick.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'me', defaultCurrency: 'USD' } } }),
}));
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
import { ITEM_REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MESSAGE } from '@/lib/utils/requestTimeout';

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

// The page's mutation tracker, counting the requests in flight through it.
let tracked = 0;
const trackCalls = vi.fn();
const mutations = {
  async track<T>(mutation: () => Promise<T>): Promise<T> {
    trackCalls();
    tracked += 1;
    try {
      return await mutation();
    } finally {
      tracked -= 1;
    }
  },
};

/** What `POST /api/wishlists` answers for a list created from the picker. */
const CREATED = { _id: 'w-new', name: 'Gift ideas', slug: 'gift-ideas-ab12c', currency: 'EUR' };

/**
 * Serves the viewer's lists, answers the copy's POST with `post`, and a new
 * list's (`POST /api/wishlists`) with `create`.
 */
function stubFetch({
  owned = OWNED,
  post = async (): Promise<Reply> => ({ success: true, data: { _id: 'copy-1' } }),
  create = async (): Promise<Reply> => ({ success: true, data: CREATED }),
}: { owned?: unknown[]; post?: () => Promise<Reply>; create?: () => Promise<Reply> } = {}) {
  const postedWhileTracked: number[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url === '/api/wishlists') return { json: create };
    if (init?.method === 'POST') {
      postedWhileTracked.push(tracked);
      return { json: post };
    }
    if (url === '/api/wishlists') {
      return { json: async () => ({ success: true, data: { owned, member: MEMBER } }) };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return Object.assign(fetchMock, { postedWhileTracked });
}

function open(onClose = vi.fn()) {
  render(
    <SaveToListModal item={source} userCurrency="USD" mutations={mutations} onClose={onClose} />
  );
  return { onClose };
}

const picker = () => screen.getByRole('dialog', { name: 'Save to my list' });

async function pick(name: string) {
  fireEvent.click(await within(picker()).findByRole('button', { name: new RegExp(name) }));
  return screen.getByRole('dialog', { name: `Save to ${name}` });
}

/** Whether this fetch call is the copy's POST. */
const isCopyPost = ([url, init]: [string, RequestInit?]) =>
  init?.method === 'POST' && url.endsWith('/items');

/** The JSON body of the copy's POST. */
function postedBody(fetchMock: ReturnType<typeof stubFetch>) {
  const call = fetchMock.mock.calls.find(isCopyPost);
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
  push.mockReset();
  trackCalls.mockClear();
  tracked = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

  it('says so, and offers to create one, when there is no list to save to', async () => {
    stubFetch({ owned: [OWNED[0], OWNED[3]] });
    open();

    expect(await screen.findByText(/don.t have another wishlist/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create a wishlist/i })).toBeInTheDocument();
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
            <SaveToListModal
              item={source}
              userCurrency="USD"
              mutations={mutations}
              onClose={() => setOpen(false)}
            />
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

describe('SaveToListModal — creating a list to save to', () => {
  const createDialog = () => screen.getByRole('dialog', { name: 'Create new wishlist' });

  async function startCreating() {
    fireEvent.click(await screen.findByRole('button', { name: /create a wishlist/i }));
    return createDialog();
  }

  async function createList(name: string) {
    const create = await startCreating();
    fireEvent.change(within(create).getByLabelText(/wishlist name/i), {
      target: { value: name },
    });
    fireEvent.click(within(create).getByRole('button', { name: /^create wishlist$/i }));
    return create;
  }

  // regression: with no other list, "Create a wishlist" linked to /wishlists/new,
  // which only redirected home without opening the create dialog, and the item
  // the user was saving was lost on the way.
  it('regression: creates the list in place, then saves the copy to it', async () => {
    const fetchMock = stubFetch({ owned: [OWNED[0], OWNED[3]] });
    const { onClose } = open();

    const create = await startCreating();
    // In the picker's place, not over it.
    expect(screen.queryByRole('dialog', { name: 'Save to my list' })).toBeNull();
    fireEvent.change(within(create).getByLabelText(/wishlist name/i), {
      target: { value: 'Gift ideas' },
    });
    fireEvent.click(within(create).getByRole('button', { name: /^create wishlist$/i }));

    // Straight on to the form, for the new list, without leaving the page.
    const form = await screen.findByRole('dialog', { name: 'Save to Gift ideas' });
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Create new wishlist' })).toBeNull();
    expect(within(form).getByLabelText(/item name/i)).toHaveValue('Blue Mug');
    expect(form.contains(document.activeElement)).toBe(true);

    fireEvent.click(within(form).getByRole('button', { name: /^add item$/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(postedBody(fetchMock).url).toBe('/api/wishlists/w-new/items');
    expect(showToast).toHaveBeenCalledWith('Saved to Gift ideas', 'success');
  });

  it('offers the new list in the picker on "Change list"', async () => {
    stubFetch({ owned: [OWNED[0], OWNED[3]] });
    open();

    await createList('Gift ideas');
    const form = await screen.findByRole('dialog', { name: 'Save to Gift ideas' });

    fireEvent.click(within(form).getByRole('button', { name: 'Change list' }));
    const created = within(picker()).getByRole('button', { name: /Gift ideas/ });
    expect(created).toHaveTextContent('Gift ideas0 items');
    await waitFor(() => expect(created).toHaveFocus());
    expect(screen.queryByText(/don.t have another wishlist/i)).toBeNull();
  });

  it('goes back to the picker when the create dialog is cancelled', async () => {
    const fetchMock = stubFetch({ owned: [OWNED[0], OWNED[3]] });
    const { onClose } = open();

    const create = await startCreating();
    fireEvent.click(within(create).getByRole('button', { name: /^cancel$/i }));

    expect(await screen.findByText(/don.t have another wishlist/i)).toBeInTheDocument();
    expect(picker()).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /create a wishlist/i })).toHaveFocus()
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('keeps the create dialog open, with the error, when creating the list fails', async () => {
    stubFetch({
      owned: [OWNED[0], OWNED[3]],
      create: async () => ({ success: false, error: 'Too many requests' }),
    });
    open();

    await createList('Gift ideas');

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Too many requests', 'error'));
    expect(createDialog()).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /^Save to / })).toBeNull();
  });
});

describe('SaveToListModal — changing the list', () => {
  // regression: once a list was picked, the form's only ways out closed the
  // whole flow, so picking another list meant starting again from the item.
  it('regression: "Change list" goes back to the picker, and saves to the list picked next', async () => {
    const fetchMock = stubFetch();
    const { onClose } = open();

    const form = await pick('Birthday');
    fireEvent.click(within(form).getByRole('button', { name: 'Change list' }));

    expect(screen.queryByRole('dialog', { name: 'Save to Birthday' })).toBeNull();
    expect(within(picker()).getByRole('button', { name: /Birthday/ })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // Back on the list it was picked with, rather than dropping to the page with the form.
    await waitFor(() =>
      expect(within(picker()).getByRole('button', { name: /Birthday/ })).toHaveFocus()
    );

    const home = await pick('Home');
    fireEvent.click(within(home).getByRole('button', { name: /^add item$/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(postedBody(fetchMock).url).toBe('/api/wishlists/w-home/items');
  });

  it('asks before going back over unsaved edits, and stays on the form if told to', async () => {
    stubFetch();
    open();
    const form = await pick('Birthday');
    fireEvent.change(within(form).getByLabelText(/item name/i), { target: { value: 'Edited' } });

    fireEvent.click(within(form).getByRole('button', { name: 'Change list' }));
    const confirm = screen.getByRole('alertdialog');
    expect(confirm).toHaveTextContent(/go back/i);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(within(form).getByLabelText(/item name/i)).toHaveValue('Edited');

    fireEvent.click(within(form).getByRole('button', { name: 'Change list' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard' })
    );
    expect(within(picker()).getByRole('button', { name: /Birthday/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Save to Birthday' })).toBeNull();
  });

  it("can't go back while the copy is saving", async () => {
    let answer: (reply: Reply) => void = () => {};
    stubFetch({ post: () => new Promise<Reply>((resolve) => (answer = resolve)) });
    open();
    const form = await pick('Birthday');

    fireEvent.click(within(form).getByRole('button', { name: /^add item$/i }));
    await waitFor(() =>
      expect(within(form).getByRole('button', { name: 'Change list' })).toBeDisabled()
    );
    answer({ success: false, error: 'Item not found' });
    await waitFor(() =>
      expect(within(form).getByRole('button', { name: 'Change list' })).toBeEnabled()
    );
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
    // Through the page's tracker, with a signal to drop it on a timeout, like
    // every other item request on the page.
    expect(trackCalls).toHaveBeenCalledTimes(1);
    expect(fetchMock.postedWhileTracked).toEqual([1]);
    const post = fetchMock.mock.calls.find(isCopyPost);
    expect(post?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('gives up on a stalled save after the item request timeout, keeping the form', async () => {
    let signal: AbortSignal | undefined;
    const fetchMock = stubFetch();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        signal = init.signal ?? undefined;
        return new Promise(() => {}); // a request that never answers
      }
      return { json: async () => ({ success: true, data: { owned: OWNED, member: MEMBER } }) };
    });
    const { onClose } = open();
    const form = await pick('Birthday');

    vi.useFakeTimers();
    fireEvent.click(within(form).getByRole('button', { name: /^add item$/i }));
    await vi.advanceTimersByTimeAsync(ITEM_REQUEST_TIMEOUT_MS);
    vi.useRealTimers();

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(REQUEST_TIMEOUT_MESSAGE, 'error'));
    expect(signal?.aborted).toBe(true);
    expect(tracked).toBe(0); // the tracker has let go, so the page's polls resume
    expect(onClose).not.toHaveBeenCalled();
    expect(within(form).getByRole('button', { name: /^add item$/i })).toBeEnabled();
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
