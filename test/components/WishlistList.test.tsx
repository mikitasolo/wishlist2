// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import WishlistList, { ArchivedLists } from '@/components/WishlistList';
import type { WishlistSummary } from '@/components/WishlistCard';
import { coverGradient } from '@/lib/utils/cover';
import type { Occasion } from '@/lib/utils/occasion';
import { atWidth } from './viewport';

const BANNER = 'https://teststore42.public.blob.vercel-storage.com/uploads/u1/banner.jpg';
// As stored: a yearly occasion's year is the placeholder, which must never show.
const BIRTHDAY: Occasion = { kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' };

let nextId = 0;
function list(name: string, fields: Record<string, unknown> = {}): WishlistSummary {
  nextId += 1;
  return {
    _id: `w${nextId}`,
    slug: name.toLowerCase().replace(/\W+/g, '-'),
    name,
    visibility: 'everyone',
    owners: ['me-id'],
    ownerUsername: 'me',
    ownerUsernames: ['me'],
    itemCount: 9,
    ...fields,
  } as unknown as WishlistSummary;
}

// jsdom normalises the inline style, so compare against what it makes of the gradient.
function placeholderOf(seed: string) {
  const probe = document.createElement('div');
  probe.style.background = coverGradient(seed);
  return probe.style.background;
}

/** The phone's rows: each a link in the section's list. */
const rows = () => within(screen.getByRole('list')).getAllByRole('link');

beforeEach(() => {
  // Local noon on Oct 2, 2026, so the local date is that day in any time zone.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 2, 12));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('WishlistList — rows on a phone, cards from sm', () => {
  it('shows a phone one compact row per list, linking to it, and no cards', () => {
    atWidth(390);
    const lists = [list('Birthday'), list('Books')];
    render(<WishlistList wishlists={lists} />);

    expect(rows().map((r) => r.getAttribute('href'))).toEqual([
      '/wishlists/birthday',
      '/wishlists/books',
    ]);
    // Cards title their list with a heading; rows don't.
    expect(screen.queryByRole('heading')).toBeNull();
    expect(document.querySelector('[data-wishlist-cards]')).toBeNull();
  });

  it('shows cards from sm up, and no rows', () => {
    atWidth(1280);
    render(<WishlistList wishlists={[list('Birthday'), list('Books')]} />);

    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Birthday',
      'Books',
    ]);
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('renders both until the width is known (the server render), for CSS to pick', () => {
    render(<WishlistList wishlists={[list('Birthday')]} />);

    const rowList = document.querySelector('[data-wishlist-rows]')!;
    const cards = document.querySelector('[data-wishlist-cards]')!;
    expect(rowList).toHaveClass('sm:hidden');
    expect(cards).toHaveClass('max-sm:hidden');
  });

  it('switches when the width crosses sm (a rotation)', () => {
    const viewport = atWidth(390);
    render(<WishlistList wishlists={[list('Birthday')]} />);
    expect(screen.getByRole('list')).toBeInTheDocument();

    act(() => viewport.resize(800));
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Birthday' })).toBeInTheDocument();
  });
});

describe('WishlistRow — content', () => {
  beforeEach(() => atWidth(390));

  it('shows the cover thumbnail, the name, the occasion and the count of your own list', () => {
    render(
      <WishlistList
        wishlists={[
          list('Birthday', {
            bannerUrl: BANNER,
            occasion: BIRTHDAY,
            itemCount: 9,
            draftCount: 2,
          }),
        ]}
        viewerUsername="me"
      />
    );
    const [row] = rows();

    const img = row.querySelector('img')!;
    expect(img).not.toBeNull();
    expect(img.getAttribute('sizes')).toBe('56px');
    expect(img.parentElement).toHaveClass('h-14', 'w-14');
    expect(within(row).getByText('Birthday')).toBeInTheDocument();
    const occasion = within(row).getByText('Birthday · in 12 days');
    expect(occasion.tagName).toBe('TIME');
    expect(occasion).toHaveAttribute('dateTime', '2026-10-14');
    // Published items, with the drafts beside them on a list you own; nobody is
    // named on a list that's yours alone.
    expect(within(row).getByText('9 items · 2 drafts')).toBeInTheDocument();
    expect(row).not.toHaveTextContent('@');
    // Not the placeholder year, anywhere on the row.
    expect(row.innerHTML).not.toContain('2000');
  });

  it('shows the placeholder gradient for a list without a banner, and nothing for no occasion', () => {
    const books = list('Books', { bannerUrl: null, occasion: null });
    render(<WishlistList wishlists={[books]} />);
    const [row] = rows();

    expect(row.querySelector('img')).toBeNull();
    expect((row.firstElementChild as HTMLElement).style.background).toBe(
      placeholderOf(books._id.toString())
    );
    expect(row.querySelector('time')).toBeNull();
  });

  it('names the owner and counts only published items on a list shared with you', () => {
    render(
      <WishlistList
        shared
        wishlists={[
          list('Dan’s wedding', {
            owners: ['dan-id', 'fiona-id'],
            ownerUsername: 'dan',
            ownerUsernames: ['dan', 'fiona'],
            itemCount: 21,
            userRole: 'member',
          }),
          list('Someone’s list', {
            owners: ['x-id'],
            ownerUsername: null,
            ownerUsernames: [],
            itemCount: 1,
          }),
        ]}
      />
    );
    const [dan, someone] = rows();

    expect(within(dan).getByText('@dan +1 · 21 items')).toBeInTheDocument();
    // An owner with no username is named without their email.
    expect(within(someone).getByText('Someone · 1 item')).toBeInTheDocument();
  });

  it('names the co-owners of a list of yours, not you', () => {
    render(
      <WishlistList
        viewerUsername="me"
        wishlists={[
          list('Books', {
            owners: ['me-id', 'ben-id'],
            ownerUsernames: ['me', 'ben'],
            itemCount: 12,
          }),
        ]}
      />
    );
    expect(within(rows()[0]).getByText('with @ben · 12 items')).toBeInTheDocument();
  });

  it('shows how many you have reserved on a shared list, and nothing at none', () => {
    render(
      <WishlistList
        shared
        wishlists={[
          list('Ben’s list', { owners: ['b'], ownerUsername: 'ben', reservedByYou: 2 }),
          list('Carla’s list', { owners: ['c'], ownerUsername: 'carla', reservedByYou: 0 }),
        ]}
      />
    );
    const [ben, carla] = rows();
    expect(within(ben).getByText('2 reserved by you')).toBeInTheDocument();
    expect(carla).not.toHaveTextContent('reserved by you');
    // No Member badge on a row either.
    expect(ben).not.toHaveTextContent(/member/i);
  });

  it('never shows a reservation count on a row of your own list', () => {
    // A list you own is never sent one; were it there, the row still wouldn't show it.
    render(<WishlistList wishlists={[list('Birthday', { reservedByYou: 3 })]} />);
    expect(rows()[0]).not.toHaveTextContent('reserved');
  });
});

describe('ArchivedLists — the disclosure', () => {
  const archived = [list('Last year', { archived: true }), list('Old notes', { archived: true })];

  it('starts collapsed, as "Archived (n)" in a heading', () => {
    atWidth(390);
    render(<ArchivedLists wishlists={archived} />);

    const button = screen.getByRole('button', { name: 'Archived (2)' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('heading', { level: 2, name: 'Archived (2)' })).toContainElement(
      button
    );
    expect(screen.queryByRole('link')).toBeNull();
    // It names the region it opens.
    expect(document.getElementById(button.getAttribute('aria-controls')!)).not.toBeNull();
  });

  it('opens to show the archived lists, as rows on a phone, and closes again', async () => {
    atWidth(390);
    const user = userEvent.setup();
    render(<ArchivedLists wishlists={archived} />);
    const button = screen.getByRole('button', { name: 'Archived (2)' });

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const region = document.getElementById(button.getAttribute('aria-controls')!)!;
    expect(
      within(region)
        .getAllByRole('link')
        .map((a) => a.textContent)
    ).toEqual([expect.stringContaining('Last year'), expect.stringContaining('Old notes')]);
    // Greyed, as an archived card is.
    expect(within(region).getAllByRole('link')[0]).toHaveClass('opacity-70');

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('opens to cards from sm up', async () => {
    atWidth(1280);
    const user = userEvent.setup();
    render(<ArchivedLists wishlists={archived} />);

    await user.click(screen.getByRole('button', { name: 'Archived (2)' }));
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Last year',
      'Old notes',
    ]);
  });

  it('renders nothing without an archived list', () => {
    const { container } = render(<ArchivedLists wishlists={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
