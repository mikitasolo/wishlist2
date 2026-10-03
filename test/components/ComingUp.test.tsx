// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import type { ReactNode } from 'react';

// The dashboard's Coming up (WIS-252, D4): every list, yours and shared, with
// an occasion in the next 30 days, nearest first, from the viewer's local date.

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// Share has its own tests: here, only which list it shares.
vi.mock('@/components/ShareButton', () => ({
  default: ({ url, title }: { url: string; title: string }) => (
    <button type="button" data-url={url}>
      Share {title}
    </button>
  ),
}));

import ComingUp from '@/components/ComingUp';
import type { WishlistSummary } from '@/components/WishlistCard';
import type { Occasion, OccasionKind } from '@/lib/utils/occasion';

// Today is Oct 2, 2026. Yearly occasions are stored on the placeholder year.
const yearly = (date: string, kind: OccasionKind = 'birthday'): Occasion => ({
  kind,
  date,
  recurrence: 'yearly',
});
const once = (date: string, kind: OccasionKind = 'other'): Occasion => ({
  kind,
  date,
  recurrence: null,
});

let nextId = 0;
function list(name: string, occasion: Occasion | null, fields: Record<string, unknown> = {}) {
  nextId += 1;
  return {
    _id: `w${nextId}`,
    slug: name.toLowerCase().replace(/\W+/g, '-'),
    name,
    visibility: 'everyone',
    itemCount: 4,
    owners: ['me'],
    occasion,
    ...fields,
  } as unknown as WishlistSummary;
}
const shared = (name: string, occasion: Occasion | null, fields: Record<string, unknown> = {}) =>
  list(name, occasion, {
    owners: ['dmitri-id'],
    ownerUsername: 'dmitri_v',
    userRole: 'member',
    ...fields,
  });

const own = [
  list('Camping trip', once('2026-10-03')), // tomorrow
  list('Anna’s 30th', yearly('2000-10-16')), // in 14 days
  list('Christmas', yearly('2000-12-25', 'holiday')), // in 84 days
  list('Housewarming', null),
  list('Wedding', once('2026-06-12', 'wedding')), // passed
  list('Last year', yearly('2000-10-05'), { archived: true }), // in 3 days, archived
];
const others = [
  shared('Dmitri’s birthday', yearly('2000-10-02'), { reservedByYou: 2 }), // today
  shared('Lena’s wedding', once('2026-11-01', 'wedding')), // in 30 days
  shared('Tom’s birthday', yearly('2000-11-02')), // in 31 days
];

/** Local noon on a day, so the local date is that day in any time zone. */
const localNoon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(localNoon(2026, 10, 2));
});
afterEach(() => vi.useRealTimers());

const section = () =>
  screen.getByRole('heading', { level: 2, name: 'Coming up' }).closest('section')!;
const cards = () => within(section()).getAllByRole('listitem');
const card = (name: string) => cards().find((c) => c.textContent?.includes(name))!;

describe('Coming up', () => {
  it('holds only the lists with an occasion in the next 30 days, nearest first, yours and shared', () => {
    render(<ComingUp own={own} shared={others} viewerId="me" />);
    expect(cards().map((c) => within(c).getAllByRole('link')[0].textContent)).toEqual([
      'Dmitri’s birthday',
      'Camping trip',
      'Anna’s 30th',
      'Lena’s wedding',
    ]);
  });

  it('labels today and tomorrow, then counts the days, by the day it falls on', () => {
    render(<ComingUp own={own} shared={others} viewerId="me" />);
    const today = within(card('Dmitri’s birthday')).getByText(/^Today · /);
    expect(today.tagName).toBe('TIME');
    expect(today).toHaveAttribute('dateTime', '2026-10-02');
    expect(within(card('Camping trip')).getByText(/^Tomorrow · /)).toHaveAttribute(
      'dateTime',
      '2026-10-03'
    );
    expect(within(card('Anna’s 30th')).getByText(/^In 14 days · /)).toHaveAttribute(
      'dateTime',
      '2026-10-16'
    );
    expect(within(card('Lena’s wedding')).getByText(/^In 30 days · /)).toBeInTheDocument();
    // A yearly occasion is shown by its next day: never the placeholder year.
    expect(section().innerHTML).not.toContain('2000');
  });

  it('names the owner of a shared list and offers Find a gift; your own offers Share', () => {
    render(<ComingUp own={own} shared={others} viewerId="me" />);
    const dmitri = card('Dmitri’s birthday');
    expect(dmitri).toHaveTextContent('Birthday · @dmitri_v');
    expect(within(dmitri).getByRole('link', { name: 'Dmitri’s birthday' })).toHaveAttribute(
      'href',
      '/wishlists/dmitri-s-birthday'
    );
    expect(
      within(dmitri).getByRole('link', { name: 'Find a gift on Dmitri’s birthday' })
    ).toHaveAttribute('href', '/wishlists/dmitri-s-birthday?show=available');
    expect(within(dmitri).queryByRole('button', { name: /Share/ })).toBeNull();

    const camping = card('Camping trip');
    expect(within(camping).getByRole('button', { name: 'Share Camping trip' })).toHaveAttribute(
      'data-url',
      '/wishlists/camping-trip'
    );
    expect(within(camping).queryByRole('link', { name: /Find a gift/ })).toBeNull();
  });

  // regression: an owner never learns what has been reserved on their own
  // list, so their card in Coming up says nothing about reservations, whatever
  // the list's data carries.
  it('regression: shows no reservation information on a list of your own', () => {
    const mine = list('Anna’s 30th', yearly('2000-10-16'), {
      reservedByYou: 3,
      bookedCount: 2,
      itemCount: 5,
    });
    render(<ComingUp own={[mine]} shared={[]} viewerId="me" />);
    const own = card('Anna’s 30th');
    expect(own).not.toHaveTextContent(/reserv|booked|claimed|\b[2-5]\b/i);
  });

  it('leaves archived lists out, yours and any that comes as shared', () => {
    render(
      <ComingUp
        own={own}
        shared={[shared('Hidden', yearly('2000-10-04'), { archived: true }), ...others]}
        viewerId="me"
      />
    );
    expect(section()).not.toHaveTextContent('Last year');
    expect(section()).not.toHaveTextContent('Hidden');
  });

  it('renders nothing when no list has an occasion that close', () => {
    const { container } = render(
      <ComingUp own={[own[2], own[3], own[4]]} shared={[others[2]]} viewerId="me" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on the server, and nothing in the render that hydrates it', async () => {
    const html = renderToString(<ComingUp own={own} shared={others} viewerId="me" />);
    expect(html).toBe('');

    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, <ComingUp own={own} shared={others} viewerId="me" />, {
        onRecoverableError,
      });
    });

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    // Once hydrated, the browser's date is known and the cards are there.
    expect(container).toHaveTextContent('Dmitri’s birthday');
    act(() => root!.unmount());
    container.remove();
    consoleError.mockRestore();
  });
});
