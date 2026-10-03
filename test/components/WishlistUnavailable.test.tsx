// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { router, showToast, signIn, auth, params } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() },
  showToast: vi.fn(),
  signIn: vi.fn(),
  // Mutable, so a test can open the page signed in or signed out.
  auth: { signedIn: true },
  // The list's URL: its slug, or (as the Reserved page links it) its id.
  params: { id: 'birthday' },
}));

vi.mock('next-auth/react', () => ({
  useSession: () =>
    auth.signedIn
      ? { data: { user: { id: 'visitor', username: 'visitor' } }, status: 'authenticated' }
      : { data: null, status: 'unauthenticated' },
  signIn,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => params,
}));

// The header has its own fetches and tests; this file is about the page's states.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));

vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import WishlistDetail from '@/app/wishlists/[id]/page';
import { pickLeave } from './listMenu';

/** How the fake server answers a read: a status and JSON body, or a network failure. */
type Answer = { status: number; body: unknown } | Error;

const ok = (data: unknown): Answer => ({ status: 200, body: { success: true, data } });
const refused = (status: number, error: string): Answer => ({
  status,
  body: { success: false, error },
});
const serverError: Answer = { status: 500, body: { success: false, error: 'Something broke' } };
const networkError = () => new TypeError('Failed to fetch');

const LIST = {
  _id: 'w1',
  name: 'Birthday',
  slug: 'birthday',
  description: '',
  owners: ['owner'],
  visibility: 'everyone',
  isPublic: true,
  archived: false,
  featured: false,
  currency: 'USD',
  bannerUrl: null,
  occasion: null,
  userRole: null,
  ownerUsernames: ['owner'],
};

const ITEMS = [
  {
    _id: 'i1',
    wishlist: 'w1',
    name: 'Bike',
    status: 'available',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

/**
 * What the routes answer the page's reads of the list and of its items with,
 * as they stand when each request arrives: by the page's URL, and the list
 * by its id (`byId`, the same as `list` unless a test says otherwise).
 * `hold.list`, when set, holds the next list read until it's released.
 */
let answers: {
  list: Answer | (() => Answer);
  items: Answer | (() => Answer);
  byId?: Answer | (() => Answer);
  leave?: Answer;
};
let hold: {
  list?: Promise<void>;
  /** Holds the next items read, answering it with whatever it's released with. */
  items?: Promise<Answer>;
  /** Holds the leave request until it's released. */
  leave?: Promise<void>;
};

const fetchMock = vi.fn();

function respond(answer: Answer | (() => Answer)) {
  const a = typeof answer === 'function' ? answer() : answer;
  if (a instanceof Error) throw a;
  return { ok: a.status < 400, status: a.status, json: async () => a.body };
}

/** How many reads of the items, and of the list, the page has sent by its URL. */
const itemReads = () =>
  fetchMock.mock.calls.filter(([url]) => url === `/api/wishlists/${params.id}/items`).length;
const listReads = () =>
  fetchMock.mock.calls.filter(([url]) => url === `/api/wishlists/${params.id}`).length;
/** How many reads of the list by its id the page has sent, from a page opened by its slug. */
const readsById = () => fetchMock.mock.calls.filter(([url]) => url === '/api/wishlists/w1').length;

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());

beforeEach(() => {
  fetchMock.mockReset();
  signIn.mockReset();
  auth.signedIn = true;
  params.id = 'birthday';
  answers = { list: ok(LIST), items: ok(ITEMS) };
  hold = {};
  // The list's own URL, with a query a shared link might carry.
  window.history.replaceState(null, '', '/wishlists/birthday?from=chat');
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === `/api/wishlists/${params.id}`) {
      const wait = hold.list;
      hold.list = undefined;
      await wait;
      return respond(answers.list);
    }
    if (url === `/api/wishlists/${params.id}/items`) {
      const held = hold.items;
      hold.items = undefined;
      return respond(held ? await held : answers.items);
    }
    if (url === '/api/wishlists/w1') return respond(answers.byId ?? answers.list);
    if (url === `/api/wishlists/${params.id}/members/me` && init?.method === 'DELETE') {
      const wait = hold.leave;
      hold.leave = undefined;
      await wait;
      return respond(answers.leave ?? ok({}));
    }
    if (url === '/api/currency-rates') return respond(serverError);
    return respond(refused(404, 'Not mocked'));
  });
  vi.stubGlobal('fetch', fetchMock);
  // A failed read logs a line; that's expected here.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

/** Let reads whose answers the page has taken finish landing. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

/** Fire a background poll now, as the page does when it becomes visible. */
const poll = () =>
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });

const SIGNED_IN_TITLE = 'This wishlist isn’t available to you';
const SIGNED_OUT_TITLE = 'This wishlist isn’t available';

/** Nothing sent the visitor anywhere, and nothing was toasted. */
function expectStayedHere() {
  expect(router.push).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  expect(window.location.pathname + window.location.search).toBe('/wishlists/birthday?from=chat');
  expect(showToast).not.toHaveBeenCalled();
}

/**
 * Every way the routes refuse a list to a viewer, as `getWishlistViewAccess`
 * answers them: the same rules for the list and its items.
 */
const SIGNED_IN_REFUSALS = [
  { list: 'a missing list', answer: refused(404, 'Wishlist not found') },
  { list: 'a private list', answer: refused(403, 'Unauthorized - No access to this wishlist') },
  {
    list: "a friends-only list of someone who isn't a friend",
    answer: refused(403, 'Unauthorized - No access to this wishlist'),
  },
  { list: 'an archived list', answer: refused(404, 'Wishlist not found') },
];
const SIGNED_OUT_REFUSALS = [
  { list: 'a missing list', answer: refused(404, 'Wishlist not found') },
  { list: 'a private list', answer: refused(401, 'Unauthorized - This wishlist is private') },
  {
    list: 'a friends-only list',
    answer: refused(401, 'Unauthorized - This wishlist is private'),
  },
  { list: 'an archived list', answer: refused(404, 'Wishlist not found') },
];

/** Opens the page with both reads refused as `answer`, and returns what it shows. */
async function openRefused(answer: Answer, title: string) {
  answers = { list: answer, items: answer };
  const { container } = render(<WishlistDetail />);
  await screen.findByRole('heading', { level: 1, name: title });
  await settle();
  return container.innerHTML;
}

describe('a list the viewer can’t open', () => {
  // regression: every refusal, and any failure, sent the visitor home
  // (router.push('/')) with "Failed to load items" and "Failed to load
  // wishlist" toasted, losing the URL. The page's own "Wishlist not found"
  // view was unreachable.
  describe('regression: signed in, says so in place, the same way for every refusal', () => {
    it.each(SIGNED_IN_REFUSALS)('for $list', async ({ answer }) => {
      await openRefused(answer, SIGNED_IN_TITLE);

      expect(
        screen.getByText(
          'It may have been deleted, or it’s only visible to people it’s shared with.'
        )
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Back to your wishlists' })).toHaveAttribute(
        'href',
        '/'
      );
      // Nothing of the list, and no way to sign in: they already are.
      expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
      expect(screen.queryByText('Bike')).toBeNull();
      expectStayedHere();
    });

    // The invariant: the page never confirms that a hidden list exists, so a
    // private, friends-only or archived list must look exactly like a missing
    // one, whichever status and wording the route refused it with.
    it('renders exactly the same page for each of them', async () => {
      const pages = new Set<string>();
      for (const { answer } of SIGNED_IN_REFUSALS) {
        pages.add(await openRefused(answer, SIGNED_IN_TITLE));
        cleanup();
      }
      expect(pages.size).toBe(1);
    });
  });

  describe('regression: signed out, offers to sign in and come back here', () => {
    beforeEach(() => {
      auth.signedIn = false;
    });

    it.each(SIGNED_OUT_REFUSALS)('for $list', async ({ answer }) => {
      await openRefused(answer, SIGNED_OUT_TITLE);

      expect(
        screen.getByText('If someone shared it with you, sign in to see it.')
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
      expectStayedHere();

      await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
      // Back to this very URL once signed in.
      expect(signIn).toHaveBeenCalledTimes(1);
      expect(signIn).toHaveBeenCalledWith(undefined, {
        redirectTo: 'http://localhost:3000/wishlists/birthday?from=chat',
      });
    });

    it('renders exactly the same page for each of them', async () => {
      const pages = new Set<string>();
      for (const { answer } of SIGNED_OUT_REFUSALS) {
        pages.add(await openRefused(answer, SIGNED_OUT_TITLE));
        cleanup();
      }
      expect(pages.size).toBe(1);
    });
  });

  it('says so when the list goes between its own read and the items read', async () => {
    answers = {
      list: ok(LIST),
      items: refused(404, 'Wishlist not found'),
      byId: refused(404, 'Wishlist not found'),
    };
    render(<WishlistDetail />);

    await screen.findByRole('heading', { level: 1, name: SIGNED_IN_TITLE });
    await settle();
    expectStayedHere();
  });
});

describe('a list that couldn’t be loaded', () => {
  // regression: a 5xx or a network error sent the visitor home too, with the
  // same toasts, rather than offering to try again.
  it.each([
    ['a 5xx', () => serverError],
    ['a network error', networkError],
  ])('regression: offers Try again after %s, which reads the list afresh', async (_label, fail) => {
    answers = { list: fail, items: fail };
    render(<WishlistDetail />);

    await screen.findByRole('heading', { level: 1, name: 'Couldn’t load this wishlist' });
    await settle();
    // Not the not-available state: nothing says the list is missing or hidden.
    expect(screen.queryByRole('heading', { name: SIGNED_IN_TITLE })).toBeNull();
    // The items read failed too, but the page says that once, not in a toast.
    expectStayedHere();

    answers = { list: ok(LIST), items: ok(ITEMS) };
    const reads = listReads();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

    await screen.findByRole('heading', { level: 1, name: 'Birthday' });
    expect(await screen.findByText('Bike')).toBeInTheDocument();
    expect(listReads()).toBe(reads + 1);
    expectStayedHere();
  });

  // regression: a failed first items read showed the stat tiles at 0 and the
  // toolbar, with "Failed to load items" below them (no way to retry but a
  // reload) and in a toast.
  it.each([
    ['a 5xx', () => serverError],
    ['a network error', networkError],
  ])(
    'regression: a failed first items read says so in their place after %s, with Try again',
    async (_label, fail) => {
      let release!: () => void;
      hold.list = new Promise<void>((resolve) => (release = resolve));
      answers = { list: ok(LIST), items: fail };
      render(<WishlistDetail />);

      // The items read fails while the list read is still on its way: the
      // list, once it lands, says so in the items' place.
      await waitFor(() => expect(itemReads()).toBe(1));
      await act(async () => release());
      await screen.findByRole('heading', { level: 1, name: 'Birthday' });
      expect(
        await screen.findByRole('heading', { name: 'Couldn’t load this list’s items' })
      ).toBeInTheDocument();
      // No counts or controls that would say the list is empty, and no toast.
      expect(screen.queryByTitle('Show all')).toBeNull();
      expect(screen.queryByPlaceholderText('Search items by name…')).toBeNull();
      expect(screen.queryByText('No items found')).toBeNull();
      await settle();
      expectStayedHere();

      answers.items = ok(ITEMS);
      const reads = itemReads();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByText('Bike')).toBeInTheDocument();
      expect(itemReads()).toBe(reads + 1);
      expect(screen.queryByRole('heading', { name: 'Couldn’t load this list’s items' })).toBeNull();
      // The counts and controls are back with the items.
      expect(screen.getByTitle('Show all')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Search items by name…')).toBeInTheDocument();
      expectStayedHere();
    }
  );

  it('fills the items in when a poll lands after the first read failed', async () => {
    answers = { list: ok(LIST), items: serverError };
    render(<WishlistDetail />);
    await screen.findByRole('heading', { name: 'Couldn’t load this list’s items' });

    answers.items = ok(ITEMS);
    await poll();

    expect(await screen.findByText('Bike')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Couldn’t load this list’s items' })).toBeNull();
    expectStayedHere();
  });
});

describe('a list that stops being available while it’s open', () => {
  async function openList() {
    render(<WishlistDetail />);
    await screen.findByRole('heading', { level: 1, name: 'Birthday' });
    await screen.findByText('Bike');
    await settle();
  }

  // regression: the 5 s poll kept the last list on screen, with no sign that
  // anything had changed, once it started being refused (the viewer removed,
  // or the list deleted, archived or made private).
  it.each([
    ['404', refused(404, 'Wishlist not found')],
    ['403', refused(403, 'Unauthorized - No access to this wishlist')],
    ['401', refused(401, 'Unauthorized - This wishlist is private')],
  ])(
    'regression: a poll answered %s switches to the not-available state and stops polling',
    async (_status, answer) => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      await openList();

      // The list is gone or hidden now, by any URL.
      answers.items = answer;
      answers.list = answer;
      await poll();
      await screen.findByRole('heading', { level: 1, name: SIGNED_IN_TITLE });
      expect(screen.queryByText('Bike')).toBeNull();
      expectStayedHere();
      // Opened by its slug, it was asked about once more by its id first.
      expect(readsById()).toBe(1);

      // No more reads: not on the 5 s tick, not on coming back to the tab.
      const reads = itemReads();
      await act(async () => {
        vi.advanceTimersByTime(30_000);
      });
      await poll();
      await settle();
      expect(itemReads()).toBe(reads);
      expect(screen.getByRole('heading', { level: 1, name: SIGNED_IN_TITLE })).toBeInTheDocument();
    }
  );

  it.each([
    ['a 500', () => serverError],
    ['a network error', networkError],
  ])('a poll that fails with %s keeps the list, and polling goes on', async (_label, fail) => {
    await openList();

    answers.items = fail;
    const reads = itemReads();
    await poll();
    await waitFor(() => expect(itemReads()).toBe(reads + 1));
    await settle();

    expect(screen.getByRole('heading', { level: 1, name: 'Birthday' })).toBeInTheDocument();
    expect(screen.getByText('Bike')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: SIGNED_IN_TITLE })).toBeNull();
    expect(showToast).not.toHaveBeenCalled();

    // The next poll is still sent, and once one lands the list is current again.
    answers.items = ok([{ ...ITEMS[0], name: 'Red bike' }]);
    await poll();
    expect(await screen.findByText('Red bike')).toBeInTheDocument();
  });

  it('keeps the not-available state signed out too, offering sign-in', async () => {
    auth.signedIn = false;
    await openList();

    answers.items = refused(401, 'Unauthorized - This wishlist is private');
    answers.list = answers.items;
    await poll();
    const panel = (await screen.findByRole('heading', { level: 1, name: SIGNED_OUT_TITLE }))
      .parentElement!;
    expect(within(panel).getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expectStayedHere();
  });

  // A co-owner gave the list a new slug: the old URL's reads are refused, but
  // the list is still there, and still open to this viewer.
  it('follows the list to its new URL when only the old slug is refused', async () => {
    await openList();

    answers.items = refused(404, 'Wishlist not found');
    answers.list = answers.items;
    answers.byId = ok({ ...LIST, slug: 'annas-30th' });
    await poll();

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/wishlists/annas-30th'));
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Bike')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: SIGNED_IN_TITLE })).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('keeps the list when the read by its id fails, and goes on polling', async () => {
    await openList();

    answers.items = refused(404, 'Wishlist not found');
    answers.byId = serverError;
    await poll();
    await waitFor(() => expect(readsById()).toBe(1));
    await settle();

    expect(screen.getByText('Bike')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: SIGNED_IN_TITLE })).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();

    // The list's back (it was a blip): the next poll fills it in.
    answers.items = ok([{ ...ITEMS[0], name: 'Red bike' }]);
    await poll();
    expect(await screen.findByText('Red bike')).toBeInTheDocument();
  });

  it('takes a refusal at its word on a page opened by the list’s id', async () => {
    params.id = 'w1';
    window.history.replaceState(null, '', '/wishlists/w1');
    await openList();
    const reads = listReads();

    answers.items = refused(403, 'Unauthorized - No access to this wishlist');
    await poll();
    await screen.findByRole('heading', { level: 1, name: SIGNED_IN_TITLE });
    // An id never changes, so there's nothing to ask again.
    expect(listReads()).toBe(reads);
  });

  /** A member leaves through the header's Leave list…, its request held until `release`. */
  async function leave() {
    let release!: () => void;
    hold.leave = new Promise<void>((resolve) => (release = resolve));
    const user = userEvent.setup();
    await pickLeave(user);
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Leave' })
    );
    return { release: () => act(async () => release()) };
  }

  /** A poll, answered with the list's refusal now that the member is gone. */
  async function refusedPoll() {
    answers.items = refused(403, 'Unauthorized - No access to this wishlist');
    answers.list = answers.items;
    const reads = itemReads();
    await poll();
    await waitFor(() => expect(itemReads()).toBe(reads + 1));
    await settle();
  }

  it('leaving the list doesn’t flash “not available” before the page moves on', async () => {
    answers.list = ok({ ...LIST, userRole: 'member' });
    await openList();
    const { release } = await leave();

    // The leave has landed, but its answer hasn't: a poll is refused meanwhile.
    await refusedPoll();
    expect(screen.queryByRole('heading', { name: SIGNED_IN_TITLE })).toBeNull();

    await release();
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/'));
    // And after it, until the page has moved on.
    await refusedPoll();
    expect(screen.queryByRole('heading', { name: SIGNED_IN_TITLE })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Birthday' })).toBeInTheDocument();
  });

  it('a leave that fails lets a later refusal through', async () => {
    answers.list = ok({ ...LIST, userRole: 'member' });
    answers.leave = { status: 500, body: { success: false, error: 'Failed to leave wishlist' } };
    await openList();
    const { release } = await leave();
    await release();
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Failed to leave wishlist', 'error')
    );
    expect(router.push).not.toHaveBeenCalled();

    // Still a member, but an owner has since made the list unavailable to them.
    await refusedPoll();
    expect(
      await screen.findByRole('heading', { level: 1, name: SIGNED_IN_TITLE })
    ).toBeInTheDocument();
  });

  // The list read too goes by the URL, and is sent again when the session
  // changes: refused by a stale slug, it's checked by id like a poll.
  it('follows the list to its new URL when a re-read of the list is refused by the old slug', async () => {
    const view = render(<WishlistDetail />);
    await screen.findByText('Bike');
    await settle();

    answers.list = refused(404, 'Wishlist not found');
    answers.byId = ok({ ...LIST, slug: 'annas-30th' });
    auth.signedIn = false;
    view.rerender(<WishlistDetail />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/wishlists/annas-30th'));
    expect(screen.queryByRole('heading', { name: SIGNED_OUT_TITLE })).toBeNull();
  });

  // An items read that was on its way when the page went unavailable, and
  // lands refused after a newer read of the list let the viewer back in, is
  // older news than that read: it can't take the list away again.
  it('keeps the list when a refusal sent before the list loaded again lands after it', async () => {
    const view = render(<WishlistDetail />);
    await screen.findByText('Bike');
    await settle();

    // A poll goes out and is held.
    let answerPoll!: (answer: Answer) => void;
    hold.items = new Promise<Answer>((resolve) => (answerPoll = resolve));
    await poll();

    // Signed out elsewhere: the private list is refused to them.
    auth.signedIn = false;
    answers.list = refused(401, 'Unauthorized - This wishlist is private');
    view.rerender(<WishlistDetail />);
    await screen.findByRole('heading', { level: 1, name: SIGNED_OUT_TITLE });

    // Signed back in: the list is read again, and is theirs to see.
    auth.signedIn = true;
    answers.list = ok(LIST);
    view.rerender(<WishlistDetail />);
    await screen.findByRole('heading', { level: 1, name: 'Birthday' });

    // The poll from before lands now, refused as it was when it was answered.
    await act(async () => answerPoll(refused(401, 'Unauthorized - This wishlist is private')));
    await settle();
    expect(screen.getByRole('heading', { level: 1, name: 'Birthday' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: SIGNED_IN_TITLE })).toBeNull();
  });
});

describe('the order the first reads land in', () => {
  // The list read can be sent before an items read is refused and land after:
  // it may predate what hid the list, so it can't bring it back.
  it('keeps the not-available state when a list read sent before a refusal lands after it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let release!: () => void;
    hold.list = new Promise<void>((resolve) => (release = resolve));
    answers = { list: ok(LIST), items: refused(404, 'Wishlist not found') };
    render(<WishlistDetail />);

    await screen.findByRole('heading', { level: 1, name: SIGNED_IN_TITLE });
    await act(async () => release());
    await settle();

    expect(screen.getByRole('heading', { level: 1, name: SIGNED_IN_TITLE })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Birthday' })).toBeNull();
    // And nothing started polling again.
    const reads = itemReads();
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(itemReads()).toBe(reads);
  });

  it('polls nothing while the list couldn’t be loaded, until Try again', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    answers.list = serverError;
    render(<WishlistDetail />);
    await screen.findByRole('heading', { level: 1, name: 'Couldn’t load this wishlist' });
    await settle();

    const reads = itemReads();
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    await poll();
    await settle();
    expect(itemReads()).toBe(reads);

    answers.list = ok(LIST);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { level: 1, name: 'Birthday' });
    await waitFor(() => expect(itemReads()).toBe(reads + 1));
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(itemReads()).toBe(reads + 2);
  });
});
