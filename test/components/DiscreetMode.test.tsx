// @vitest-environment jsdom
// Discreet mode (WIS-46): a device setting that keeps reservations off the screen.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiItem } from '@/types/api';

const ME = 'user-me';

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: ME, email: 'me@example.com', username: 'mikita' } },
    status: 'authenticated',
  }),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@/components/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'system', resolvedTheme: 'light', setTheme: vi.fn() }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/booked',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/components/GlobalSearch', () => ({ default: () => null }));
vi.mock('@/components/AppNav', () => ({ HeaderNav: () => null, TabBar: () => null }));
vi.mock('@/lib/hooks/useUnreadNotifications', () => ({ useUnreadNotifications: () => 0 }));

import WishlistItem from '@/components/WishlistItem';
import ReservedByYouChip from '@/components/ReservedByYouChip';
import AuthButton from '@/components/AuthButton';
import AppHeader from '@/components/AppHeader';
import {
  resetDiscreetModeForTests,
  setDiscreetMode,
  useDiscreetMode,
} from '@/lib/hooks/useDiscreetMode';
import { DISCREET_STORAGE_KEY } from '@/lib/utils/discreet';

const item = (fields: Partial<ApiItem>) =>
  ({
    _id: 'i1',
    wishlist: 'w1',
    name: 'Cool Gift',
    status: 'available',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    link: 'https://shop.example/gift',
    ...fields,
  }) as ApiItem;

beforeEach(() => {
  cleanup();
  localStorage.clear();
  resetDiscreetModeForTests();
});
afterEach(() => vi.restoreAllMocks());

describe('WishlistItem in discreet mode', () => {
  const states: [string, Partial<ApiItem>][] = [
    ['booked by me', { status: 'booked', bookedBy: ME }],
    ['booked by me and given', { status: 'booked', bookedBy: ME, givenByMe: true }],
    ['booked by someone else', { status: 'booked', bookedBy: 'other' }],
    ['available', {}],
  ];

  it.each(states)('draws a member’s item %s with no badge, tone or booking control', (_, f) => {
    setDiscreetMode(true);
    render(<WishlistItem item={item(f)} onUpdate={vi.fn()} isAuthenticated isMember />);
    expect(screen.queryByText(/reserv|given/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /open reserved/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reserve|release|given/i })).toBeNull();
    // The product link takes the primary's place.
    expect(screen.getByRole('link', { name: /product page/i })).toBeInTheDocument();
  });

  it.each(states)(
    'opens an item %s in its sheet with no status or booking control',
    async (_, f) => {
      setDiscreetMode(true);
      render(<WishlistItem item={item(f)} onUpdate={vi.fn()} isAuthenticated isMember />);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Cool Gift' }));
      const sheet = await screen.findByRole('dialog');
      expect(within(sheet).queryByText(/reserv|given/i)).toBeNull();
      expect(within(sheet).queryByRole('button', { name: /reserve|release|given/i })).toBeNull();
    }
  );

  it('keeps the real controls and badge while it is off', () => {
    render(
      <WishlistItem
        item={item({ status: 'booked', bookedBy: ME })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );
    expect(screen.getByText(/reserved by you/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Release this item' })).toBeInTheDocument();
  });

  it('turns back to the real state the moment it is turned off', () => {
    setDiscreetMode(true);
    render(
      <WishlistItem
        item={item({ status: 'booked', bookedBy: ME })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );
    expect(screen.queryByText(/reserved/i)).toBeNull();
    act(() => setDiscreetMode(false));
    expect(screen.getByText(/reserved by you/i)).toBeInTheDocument();
  });
});

describe('the "N reserved by you" chip', () => {
  it('is left off the screen in discreet mode', () => {
    setDiscreetMode(true);
    const { container } = render(<ReservedByYouChip count={3} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the header switch', () => {
  it('is pressed while on, flips in one tap, and is remembered', async () => {
    const user = userEvent.setup();
    render(<AppHeader actions={<AuthButton />} />);
    const toggle = screen.getByRole('button', { name: 'Discreet mode' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAttribute('title', 'Turn on discreet mode');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAttribute('title', 'Discreet mode is on. Turn it off');
    expect(localStorage.getItem(DISCREET_STORAGE_KEY)).toBe('1');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem(DISCREET_STORAGE_KEY)).toBeNull();
  });

  it('is not in the account menu', async () => {
    const user = userEvent.setup();
    render(<AuthButton />);
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(screen.queryByRole('menuitem', { name: /discreet/i })).toBeNull();
  });

  function Probe() {
    return <p>{useDiscreetMode().discreet ? 'on' : 'off'}</p>;
  }

  it('survives a reload: it is read back from storage', () => {
    localStorage.setItem(DISCREET_STORAGE_KEY, '1');
    resetDiscreetModeForTests();
    render(<Probe />);
    expect(screen.getByText('on')).toBeInTheDocument();
  });

  it('still works for the page when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    resetDiscreetModeForTests();
    render(<Probe />);
    expect(screen.getByText('off')).toBeInTheDocument();
    act(() => setDiscreetMode(true));
    expect(screen.getByText('on')).toBeInTheDocument();
  });
});
