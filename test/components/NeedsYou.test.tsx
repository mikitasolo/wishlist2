// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

// The dashboard's Needs you (WIS-252, D4): what's waiting on you, in up to
// three rows, and nothing at all when nothing is.

const { push, showToast, user } = vi.hoisted(() => ({
  push: vi.fn(),
  showToast: vi.fn(),
  // The signed-in user as the session has them: their currency, and whether
  // they've answered the currency prompt.
  user: { id: 'me', username: 'me', defaultCurrency: 'USD', currencyChosen: true },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user }, status: 'authenticated', update: vi.fn() }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import NeedsYou from '@/components/NeedsYou';
import type { WishlistSummary } from '@/components/WishlistCard';
import type { PendingInvite } from '@/components/InviteCard';

type Response = { ok: boolean; status: number; json: () => Promise<unknown> };
const json = (body: unknown, status = 200): Response => ({
  ok: status < 400,
  status,
  json: async () => body,
});

function invite(id: string, fields: Partial<PendingInvite> = {}): PendingInvite {
  return {
    _id: id,
    role: 'member',
    wishlistId: `w-${id}`,
    wishlistName: `List ${id}`,
    wishlistSlug: `list-${id}`,
    invitedByUsername: 'alice',
    invitedByImage: null,
    ...fields,
  };
}

function list(id: string, name: string, fields: Record<string, unknown> = {}): WishlistSummary {
  return {
    _id: id,
    slug: name.toLowerCase().replace(/\W+/g, '-'),
    name,
    owners: ['me'],
    visibility: 'everyone',
    itemCount: 3,
    proposalCount: 0,
    ...fields,
  } as unknown as WishlistSummary;
}

/** The invites the server still holds as pending: an answer takes one off. */
let pending: PendingInvite[];
let answers: {
  invites: () => Response | Promise<Response>;
  summary: () => Response | Promise<Response>;
  answer: () => Response;
  profile: () => Response | Promise<Response>;
};
let fetchMock: ReturnType<typeof vi.fn>;
const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

beforeEach(() => {
  push.mockReset();
  showToast.mockReset();
  Object.assign(user, { defaultCurrency: 'USD', currencyChosen: true });
  pending = [];
  answers = {
    invites: () => json({ success: true, data: pending }),
    summary: () => json({ success: true, data: { changed: 0 } }),
    answer: () => json({ success: true, data: { wishlistId: 'w-1', wishlistSlug: 'list-1' } }),
    profile: () => json({ success: true, data: { username: 'me', birthday: null } }),
  };
  localStorage.clear();
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/users/me/invites') return answers.invites();
    if (url === '/api/users/me/reservations/summary') return answers.summary();
    if (url === '/api/users/me') return answers.profile();
    if (url.startsWith('/api/invites/') && init?.method === 'PATCH') {
      pending = pending.filter((i) => url !== `/api/invites/${i._id}`);
      return answers.answer();
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  // The browser is in Warsaw, so the currency prompt offers PLN to whoever
  // hasn't answered it yet.
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat
  ) {
    return { ...realResolvedOptions.call(this), timeZone: 'Europe/Warsaw' };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Let the reads land. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const block = () => screen.queryByRole('heading', { level: 2, name: 'Needs you' });
const rows = () => within(block()!.closest('section')!).getAllByRole('listitem');

describe('Needs you', () => {
  it('renders nothing at all when nothing needs you', async () => {
    const { container } = render(<NeedsYou ownLists={[list('w1', 'Birthday')]} />);
    await settle();
    expect(block()).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing, and never says there is nothing, when its reads fail', async () => {
    answers.invites = () => json({ success: false, error: 'Nope' }, 500);
    answers.summary = () => {
      throw new TypeError('Failed to fetch');
    };
    const { container } = render(<NeedsYou ownLists={null} />);
    await settle();
    expect(container).toBeEmptyDOMElement();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('shows a pending invite with Accept and Decline in place, and See all in Activity', async () => {
    answers.invites = () => json({ success: true, data: [invite('1')] });
    render(<NeedsYou ownLists={[]} />);
    await waitFor(() => expect(block()).not.toBeNull());

    expect(rows()).toHaveLength(1);
    const [row] = rows();
    expect(row).toHaveTextContent('List 1');
    expect(row).toHaveTextContent('from @alice');
    expect(within(row).getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Decline' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all in Activity' })).toHaveAttribute(
      'href',
      '/notifications'
    );
  });

  it('keeps the co-owner consent warning on an owner invite, and answers it in place', async () => {
    pending = [invite('1', { role: 'owner', yourReservations: 2 })];
    render(<NeedsYou ownLists={[]} />);
    await waitFor(() => expect(block()).not.toBeNull());

    const [row] = rows();
    expect(row).toHaveTextContent('Co-owner');
    expect(row).toHaveTextContent(
      'You’ve reserved 2 gifts here. Co-owners can’t see reservations, so accepting releases them.'
    );

    await userEvent.setup().click(within(row).getByRole('button', { name: 'Accept' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/invites/1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ action: 'accept' }) })
    );
    // Accepted: the row goes, and so does the block with nothing else in it.
    await waitFor(() => expect(block()).toBeNull());
    expect(push).toHaveBeenCalledWith('/wishlists/list-1');
  });

  it('declines in place, and the row goes', async () => {
    pending = [invite('1'), invite('2')];
    render(<NeedsYou ownLists={[]} />);
    await waitFor(() => expect(rows()).toHaveLength(2));

    await userEvent.setup().click(within(rows()[0]).getByRole('button', { name: 'Decline' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/invites/1',
      expect.objectContaining({ body: JSON.stringify({ action: 'decline' }) })
    );
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toHaveTextContent('List 2');
    expect(push).not.toHaveBeenCalled();
  });

  it('counts the proposals to review on each of your lists, to its Proposals, never naming anyone', async () => {
    render(
      <NeedsYou
        ownLists={[
          list('w1', 'Anna’s 30th Birthday', { proposalCount: 2 }),
          list('w2', 'Books', { proposalCount: 0 }),
          list('w3', 'Garden', { proposalCount: 1 }),
          // Archived: an owner's to deal with, not a to-do.
          list('w4', 'Old flat', { proposalCount: 4, archived: true }),
        ]}
      />
    );
    await waitFor(() => expect(block()).not.toBeNull());

    const [anna, garden] = rows();
    expect(rows()).toHaveLength(2);
    expect(anna).toHaveTextContent('2 proposals to review');
    expect(anna).toHaveTextContent('On Anna’s 30th Birthday');
    expect(
      within(anna).getByRole('link', { name: 'Review proposals on Anna’s 30th Birthday' })
    ).toHaveAttribute('href', '/wishlists/anna-s-30th-birthday?show=proposals');
    expect(garden).toHaveTextContent('1 proposal to review');
    // A count only: nobody's name, not even a "Someone".
    expect(block()!.closest('section')).not.toHaveTextContent(/@|Someone|proposed by/i);
  });

  it('shows your changed reservations, to Reserved, only once their count is read', async () => {
    let release!: (response: Response) => void;
    answers.summary = () => new Promise((resolve) => (release = resolve));
    render(<NeedsYou ownLists={[]} />);
    await settle();
    // Not a 0 while it's read: nothing.
    expect(block()).toBeNull();

    await act(async () => release(json({ success: true, data: { changed: 3 } })));
    await waitFor(() => expect(block()).not.toBeNull());
    const [row] = rows();
    expect(row).toHaveTextContent('3 reservations changed');
    expect(row).toHaveTextContent('They need your confirmation.');
    expect(within(row).getByRole('link', { name: 'Review changed reservations' })).toHaveAttribute(
      'href',
      '/booked'
    );
  });

  it('says "1 reservation changed" for one', async () => {
    answers.summary = () => json({ success: true, data: { changed: 1 } });
    render(<NeedsYou ownLists={[]} />);
    await waitFor(() => expect(block()).not.toBeNull());
    expect(rows()[0]).toHaveTextContent('1 reservation changed');
    expect(rows()[0]).toHaveTextContent('It needs your confirmation.');
  });

  it('shows the currency prompt as a row, whenever it would show', async () => {
    user.currencyChosen = false;
    render(<NeedsYou ownLists={[]} />);
    await waitFor(() => expect(block()).not.toBeNull());
    const prompt = screen.getByRole('region', { name: 'Show prices in PLN?' });
    expect(rows()[0]).toContainElement(prompt);
    expect(within(prompt).getByRole('button', { name: 'Use PLN' })).toBeInTheDocument();
  });

  it('never offers a currency to someone who has moved off USD', async () => {
    Object.assign(user, { currencyChosen: false, defaultCurrency: 'EUR' });
    const { container } = render(<NeedsYou ownLists={[]} />);
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows at most three rows, one of each kind before any second', async () => {
    user.currencyChosen = false;
    answers.invites = () => json({ success: true, data: [invite('1'), invite('2'), invite('3')] });
    answers.summary = () => json({ success: true, data: { changed: 2 } });
    render(
      <NeedsYou
        ownLists={[
          list('w1', 'Birthday', { proposalCount: 1 }),
          list('w2', 'Garden', { proposalCount: 5 }),
        ]}
      />
    );
    await waitFor(() => expect(screen.queryByText('2 reservations changed')).not.toBeNull());
    await waitFor(() => expect(rows()).toHaveLength(3));
    // Three invitations don't hide the rest: the first invitation, the changed
    // reservations and the currency prompt, which nothing else on the way in
    // shows. The proposals and the other invitations are in Activity.
    const [first, second, third] = rows();
    expect(first).toHaveTextContent('List 1');
    expect(second).toHaveTextContent('2 reservations changed');
    expect(third).toContainElement(screen.getByRole('region', { name: 'Show prices in PLN?' }));
    expect(screen.queryByText('List 2')).toBeNull();
    expect(screen.queryByText('On Birthday')).toBeNull();
    expect(screen.getByRole('link', { name: 'See all in Activity' })).toBeInTheDocument();
  });

  it('fills the rows that are left with more of the same, in order', async () => {
    answers.invites = () => json({ success: true, data: [invite('1'), invite('2'), invite('3')] });
    render(<NeedsYou ownLists={[list('w1', 'Birthday', { proposalCount: 1 })]} />);
    await waitFor(() => expect(screen.queryByText('List 3')).toBeNull());
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows().map((r) => r.textContent)).toEqual([
      expect.stringContaining('List 1'),
      expect.stringContaining('List 2'),
      expect.stringContaining('1 proposal to review'),
    ]);
  });

  it('reads the changed reservations again when the window comes back into focus', async () => {
    render(<NeedsYou ownLists={[]} />);
    await settle();
    expect(block()).toBeNull();

    answers.summary = () => json({ success: true, data: { changed: 1 } });
    await act(async () => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(screen.queryByText('1 reservation changed')).not.toBeNull());

    // A later read that fails keeps it.
    answers.summary = () => json({ success: false, error: 'Nope' }, 500);
    await act(async () => window.dispatchEvent(new Event('focus')));
    await settle();
    expect(screen.getByText('1 reservation changed')).toBeInTheDocument();
  });
});

describe('the birthday nudge (WIS-344)', () => {
  const withBirthday = (birthday: string | null) => () =>
    json({ success: true, data: { username: 'me', birthday } });
  /** Today in the browser: a local date, whatever the test machine's zone. */
  const today = (year: number, month: number, day: number) =>
    vi.useFakeTimers({ now: new Date(year, month - 1, day, 12), toFake: ['Date'] });

  beforeEach(() => {
    answers.profile = withBirthday('2000-10-27');
    today(2026, 10, 6);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const nudge = () => screen.queryByText('Your birthday is in 3 weeks');

  it('shows three weeks before your birthday with no Birthday list, and New list opens on one', async () => {
    const onNew = vi.fn();
    render(<NeedsYou ownLists={[list('w1', 'Books')]} onNewBirthdayList={onNew} />);
    await waitFor(() => expect(nudge()).not.toBeNull());
    const [row] = rows();
    expect(row).toHaveTextContent('Make a list so friends know what to get you.');
    await userEvent.setup().click(within(row).getByRole('button', { name: 'New list' }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('counts down to the day itself', async () => {
    today(2026, 10, 27);
    render(<NeedsYou ownLists={[]} onNewBirthdayList={vi.fn()} />);
    await waitFor(() => expect(screen.queryByText('Your birthday is today')).not.toBeNull());
  });

  it('hides while any of your lists is a Birthday list coming, however many there are', async () => {
    const lists = [
      list('w1', 'Books', { occasion: { kind: 'wedding', date: '2026-10-27', recurrence: null } }),
      list('w2', 'Party', { occasion: { kind: 'birthday', date: '2026-10-31', recurrence: null } }),
    ];
    const { container } = render(<NeedsYou ownLists={lists} onNewBirthdayList={vi.fn()} />);
    await settle();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows when your only Birthday list is last year’s', async () => {
    const lists = [
      list('w1', 'Old', { occasion: { kind: 'birthday', date: '2025-10-27', recurrence: null } }),
    ];
    render(<NeedsYou ownLists={lists} onNewBirthdayList={vi.fn()} />);
    await waitFor(() => expect(nudge()).not.toBeNull());
  });

  it('waits for your lists, and shows nothing outside the window or without a birthday', async () => {
    const first = render(<NeedsYou ownLists={null} onNewBirthdayList={vi.fn()} />);
    await settle();
    expect(first.container).toBeEmptyDOMElement();
    first.unmount();

    today(2026, 10, 5); // 22 days to go
    const second = render(<NeedsYou ownLists={[]} onNewBirthdayList={vi.fn()} />);
    await settle();
    expect(second.container).toBeEmptyDOMElement();
    second.unmount();

    today(2026, 10, 6);
    answers.profile = withBirthday(null);
    const third = render(<NeedsYou ownLists={[]} onNewBirthdayList={vi.fn()} />);
    await settle();
    expect(third.container).toBeEmptyDOMElement();
  });

  it('dismisses for this birthday, and comes back for next year’s', async () => {
    const first = render(<NeedsYou ownLists={[]} onNewBirthdayList={vi.fn()} />);
    await waitFor(() => expect(nudge()).not.toBeNull());
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Dismiss until next birthday' }));
    expect(block()).toBeNull();
    first.unmount();

    // Still dismissed on the next visit.
    const again = render(<NeedsYou ownLists={[]} onNewBirthdayList={vi.fn()} />);
    await settle();
    expect(again.container).toBeEmptyDOMElement();
    again.unmount();

    today(2027, 10, 6);
    render(<NeedsYou ownLists={[]} onNewBirthdayList={vi.fn()} />);
    await waitFor(() => expect(nudge()).not.toBeNull());
  });
});
