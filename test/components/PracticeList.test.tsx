// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/tour',
}));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }),
}));
vi.mock('@/lib/hooks/useKnownSession', () => ({
  useKnownSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }),
}));
// The page's chrome reads the session and the network; the practice list itself must not.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));

import PracticeList from '@/components/PracticeList';
import { practiceItems } from '@/lib/utils/practiceList';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The card for this item, by its name (its anchor, `item-<id>`). */
const card = (name: string) =>
  screen.getByRole('button', { name }).closest<HTMLElement>('[id^="item-"]')!;

describe('PracticeList (WIS-436)', () => {
  it('a friend’s list: Reserve works, in memory only', async () => {
    render(<PracticeList view="friend" />);
    const reserve = within(card('Ceramic pour-over set')).getByRole('button', {
      name: 'Reserve this item',
    });
    expect(reserve).toHaveAttribute('data-tour', 'reserve');
    await userEvent.click(reserve);
    expect(
      await within(card('Ceramic pour-over set')).findByRole('button', { name: /release/i })
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('points the group gift step at an available item’s menu', () => {
    const { container } = render(<PracticeList view="friend" />);
    const menu = container.querySelector('[data-tour="group-gift"]');
    expect(menu).not.toBeNull();
    expect(within(card('Hiking day pack')).getByRole('button', { name: 'More actions' })).toBe(
      within(menu as HTMLElement).getByRole('button', { name: 'More actions' })
    );
  });

  it('your own practice list never shows a reservation', () => {
    expect(practiceItems('owner').every((i) => i.status !== 'booked' && !i.bookedBy)).toBe(true);
    render(<PracticeList view="owner" />);
    expect(screen.queryByText(/reserved/i)).toBeNull();
  });

  it('your own: Add item adds a card, and Share shows who can see it, sending nothing', async () => {
    render(<PracticeList view="owner" />);
    await userEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add item' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Board game');
    await userEvent.type(within(dialog).getByLabelText('Price'), '30');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add item' }));
    expect(await screen.findByRole('button', { name: 'Board game' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Share' }));
    const share = await screen.findByRole('dialog', { name: 'Share your list' });
    await userEvent.click(within(share).getByRole('radio', { name: /Invite only/ }));
    expect(share).toHaveTextContent('Only owners and people you invite can open it.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
