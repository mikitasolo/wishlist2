// @vitest-environment jsdom
// The top of a wishlist's page: its full name, a meta line (owners, the
// occasion's date and countdown, visibility), and one row of actions for the
// viewer's role, with Pin to my dashboard and Leave list… in its ⋯ menu.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import WishlistHeader from '@/components/WishlistHeader';
import { formatOccasionDay, type Occasion } from '@/lib/utils/occasion';

// As stored: a yearly occasion's year is the placeholder, which must never show.
const BIRTHDAY: Occasion = { kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' };
const PLACEHOLDER_YEAR = '2000';

/** Local noon on a day, so the local date is that day in any time zone. */
const localNoon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

const noop = () => {};
const base = {
  name: 'Birthday',
  ownerUsernames: ['alice', 'chloe_r'],
  viewerUsername: 'alice',
  role: 'owner' as const,
  visibility: 'everyone' as const,
  onAddItem: noop,
  onPropose: noop,
  onTogglePin: noop,
  onLeave: noop,
};

/** The meta line under the name. */
const metaLine = () => screen.getByRole('heading', { level: 1 }).nextElementSibling as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(localNoon(2026, 10, 2));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('WishlistHeader: the name', () => {
  // regression: the <h1> was `truncate` on one row with two or three pills, so
  // a phone showed "Fa…", "My fir…" or "Camping tr…".
  it('regression: wraps the name to up to three lines rather than truncating it to one', () => {
    const name = 'Family Christmas at grandma’s house: gifts for everyone in the family';
    render(<WishlistHeader {...base} name={name} />);
    const title = screen.getByRole('heading', { level: 1, name });
    expect(title).not.toHaveClass('truncate');
    expect(title).not.toHaveClass('whitespace-nowrap');
    expect(title).toHaveClass('line-clamp-3', 'break-words');
  });
});

describe('WishlistHeader: the meta line', () => {
  it('credits every owner by their handle, the viewer as "you"', () => {
    render(<WishlistHeader {...base} ownerUsernames={['alice', 'chloe_r', 'dan']} />);
    expect(metaLine()).toHaveTextContent(/^by you & @chloe_r \+1/);
    expect(within(metaLine()).getByRole('link', { name: '@chloe_r' })).toHaveAttribute(
      'href',
      '/users/chloe_r'
    );
  });

  it('names a non-owner viewer’s own handle like anyone else’s', () => {
    render(<WishlistHeader {...base} role="member" ownerUsernames={['alice']} />);
    expect(within(metaLine()).getByRole('link', { name: '@alice' })).toBeInTheDocument();
    expect(metaLine()).not.toHaveTextContent('you');
  });

  it('shows the day the occasion next falls on and the countdown, from the local date', () => {
    render(<WishlistHeader {...base} occasion={BIRTHDAY} />);
    const day = formatOccasionDay('2026-10-14');
    expect(metaLine()).toHaveTextContent(`Birthday · ${day} · in 12 days`);
    const time = within(metaLine()).getByText(day);
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', '2026-10-14');
  });

  it("never shows a yearly occasion's placeholder year, in its text or attributes", () => {
    for (const [m, d] of [
      [10, 2],
      [10, 14],
      [10, 15],
      [12, 31],
    ]) {
      vi.setSystemTime(localNoon(2026, m, d));
      const { container, unmount } = render(<WishlistHeader {...base} occasion={BIRTHDAY} />);
      expect(container.innerHTML).not.toContain(PLACEHOLDER_YEAR);
      unmount();
    }
    // Past this year's, it's next year's: the year shown is that real one.
    vi.setSystemTime(localNoon(2026, 10, 15));
    render(<WishlistHeader {...base} occasion={BIRTHDAY} />);
    expect(metaLine()).toHaveTextContent(formatOccasionDay('2027-10-14', { withYear: true }));
    expect(metaLine()).toHaveTextContent('in 364 days');
  });

  it('shows a one-off that has passed by its day, with its year, and no countdown', () => {
    const wedding: Occasion = { kind: 'wedding', date: '2026-06-12', recurrence: null };
    render(<WishlistHeader {...base} occasion={wedding} />);
    expect(metaLine()).toHaveTextContent(
      `Wedding · ${formatOccasionDay('2026-06-12', { withYear: true })}`
    );
    expect(metaLine()).not.toHaveTextContent(/today|tomorrow|days/);
  });

  // The server's date can differ from the browser's: nothing worked out from
  // "today" may render until the browser's date is known.
  it('renders only the kind while today is unknown, and hydrates without a mismatch', async () => {
    vi.setSystemTime(localNoon(2026, 10, 1));
    const header = <WishlistHeader {...base} occasion={BIRTHDAY} />;
    const html = renderToString(header);
    expect(html).toContain('Birthday');
    expect(html).not.toMatch(/today|tomorrow|days|<time/);
    expect(html).not.toContain(PLACEHOLDER_YEAR);

    vi.setSystemTime(localNoon(2026, 10, 2));
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, header, { onRecoverableError });
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(container).toHaveTextContent('in 12 days');

    act(() => root?.unmount());
    container.remove();
    consoleError.mockRestore();
  });

  it.each([
    ['everyone', 'Public'],
    ['friends', 'Friends'],
    ['private', 'Invite only'],
  ] as const)('labels %s visibility "%s"', (visibility, label) => {
    render(<WishlistHeader {...base} visibility={visibility} />);
    expect(metaLine()).toHaveTextContent(label);
  });

  it('shows Archived instead of the visibility on an archived list', () => {
    render(<WishlistHeader {...base} archived />);
    expect(metaLine()).toHaveTextContent('Archived');
    expect(metaLine()).not.toHaveTextContent('Public');
  });
});

describe('WishlistHeader: no Manage', () => {
  // The list's tabs (Items · People · Settings) replaced Manage and its Done.
  it('offers an owner no Manage or Done: the tabs under the header are the way there', () => {
    render(<WishlistHeader {...base} />);
    expect(screen.queryByRole('button', { name: /Manage|Back to items/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add item' })).toBeInTheDocument();
  });
});
