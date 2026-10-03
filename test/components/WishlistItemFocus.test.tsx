// @vitest-environment jsdom
// Keyboard focus through an item card's "More actions" menu and the dialogs it
// opens, with the real ConfirmDialog (WishlistItem.test.tsx stubs it).
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { ApiItem } from '@/types/api';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'user-me' } }, status: 'authenticated' }),
}));

import WishlistItem from '@/components/WishlistItem';

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
// And a desktop-width viewport (jsdom has no matchMedia), whose card menu
// doesn't hold the product link: a phone's starts with it (WIS-245).
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => cleanup());

function item(overrides: Partial<ApiItem>): ApiItem {
  return {
    _id: 'item-1',
    wishlist: 'w1',
    name: 'Cool Gift',
    status: 'available',
    link: 'https://shop.example/gift',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  } as ApiItem;
}

/** An update that stays in flight until `settle`, then applies itself, as the page's does. */
function OwnerCard({ initial }: { initial: ApiItem }) {
  const [current, setCurrent] = useState(initial);
  return (
    <WishlistItem
      item={current}
      onUpdate={(_id, updates) =>
        new Promise<void>((resolve) => {
          pending.settle = () => {
            setCurrent((prev) => ({ ...prev, ...updates }));
            resolve();
          };
        })
      }
      onEdit={vi.fn()}
      isAuthenticated
      isOwner
    />
  );
}
const pending: { settle: () => void } = { settle: () => {} };

const more = () => screen.getByRole('button', { name: 'More actions' });

async function openMenuFromKeyboard() {
  const user = userEvent.setup();
  act(() => more().focus());
  await user.keyboard('{ArrowDown}');
  return user;
}

describe('WishlistItem — focus through the actions menu', () => {
  it('goes back to "More actions" when a confirmation opened from the menu is cancelled', async () => {
    render(<OwnerCard initial={item({})} />);
    const user = await openMenuFromKeyboard();
    expect(screen.getByRole('menuitem', { name: 'Mark as received' })).toHaveFocus();

    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('alertdialog', { name: 'Mark as received?' });
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(more()).toHaveFocus());
  });

  it('goes back to "More actions" when the confirmation is confirmed, and stays there through the update', async () => {
    render(<OwnerCard initial={item({})} />);
    const user = await openMenuFromKeyboard();
    await user.keyboard('{ArrowDown}{Enter}');
    screen.getByRole('alertdialog', { name: 'Move to draft?' });

    await user.click(screen.getByRole('button', { name: 'Move to draft' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(more()).toHaveFocus());

    // While the update runs, the menu holds its status changes.
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Mark as received' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await user.keyboard('{Escape}');

    await act(async () => pending.settle());
    expect(more()).toHaveFocus();
    // A draft now: Publish is the primary action, and Edit is in the menu.
    expect(screen.getByRole('button', { name: 'Publish item' })).toBeInTheDocument();
  });

  // regression guard: an action with no dialog (and the update it starts)
  // mustn't drop focus to <body>, as a disabled button would.
  it('keeps focus on "More actions" through an action that opens no dialog', async () => {
    render(<OwnerCard initial={item({ status: 'completed' })} />);
    const user = await openMenuFromKeyboard();
    expect(screen.getByRole('menuitem', { name: 'Mark as not received' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(more()).toHaveFocus();
    await act(async () => pending.settle());
    expect(more()).toHaveFocus();

    // Live again: the menu offers completing it.
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Mark as received' })).toHaveFocus();
  });
});
