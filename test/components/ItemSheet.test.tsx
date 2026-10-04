// @vitest-environment jsdom
// An item's details sheet (WIS-258), opened from the body of its card, with
// the real BaseModal and ConfirmDialog.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentProps } from 'react';
import type { ApiItem } from '@/types/api';

const ME = 'user-me';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: ME } }, status: 'authenticated' }),
}));

vi.mock('@/components/BannerImage', () => ({
  default: ({ alt }: { alt?: string }) => <img alt={alt ?? ''} data-testid="banner-image" />,
}));

import WishlistItem from '@/components/WishlistItem';
import BaseModal from '@/components/BaseModal';
import { atWidth } from './viewport';

// jsdom can't navigate: a click on a link (the cover) goes nowhere.
const stopNavigation = (e: MouseEvent) => {
  if ((e.target as Element).closest('a')) e.preventDefault();
};
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  document.addEventListener('click', stopNavigation);
});
afterAll(() => {
  document.removeEventListener('click', stopNavigation);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  cleanup();
  atWidth(1280);
});

function item(overrides: Partial<ApiItem> = {}): ApiItem {
  return {
    _id: 'item-1',
    wishlist: 'w1',
    name: 'A very long gift name that the card has to cut short after two lines',
    status: 'available',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  } as ApiItem;
}

type Props = Partial<ComponentProps<typeof WishlistItem>>;
function renderCard(it: ApiItem, props: Props = {}) {
  return render(<WishlistItem item={it} onUpdate={vi.fn()} isAuthenticated {...props} />);
}

/** The card's body: the button its name is. */
const bodyButton = (name: string | RegExp = /very long gift/) =>
  within(screen.getByRole('article')).getByRole('button', { name });

function openSheet() {
  fireEvent.click(bodyButton());
  return screen.getByRole('dialog');
}

describe('the card', () => {
  it('shows one muted line of the notes under the price', () => {
    renderCard(item({ notes: 'Black or silver, EU 39. Second hand is fine.' }), {
      isMember: true,
    });
    const notes = within(screen.getByRole('article')).getByText(/Black or silver/);
    expect(notes).toHaveClass('line-clamp-1', 'text-muted-foreground');
    // The ⓘ overlay is gone: the sheet has the notes.
    expect(screen.queryByRole('button', { name: /show notes/i })).toBeNull();
  });

  it('shows no notes line when there are none', () => {
    renderCard(item(), { isMember: true });
    expect(screen.getByRole('article').querySelector('.line-clamp-1')).toBeNull();
  });
});

describe('opening the sheet', () => {
  it('opens from the card body, as a dialog named by the full name', () => {
    renderCard(item(), { isMember: true });
    expect(bodyButton()).toHaveAttribute('aria-haspopup', 'dialog');
    const sheet = openSheet();
    expect(sheet).toHaveAccessibleName(item().name);
    expect(within(sheet).getByRole('heading', { name: item().name })).toBeInTheDocument();
  });

  it("doesn't open from the card's buttons or its cover", async () => {
    const user = userEvent.setup();
    renderCard(item({ link: 'https://shop.example/x' }), { isMember: true, onSaveToList: vi.fn() });
    const card = screen.getByRole('article');

    await user.click(within(card).getByRole('button', { name: 'Reserve this item' }));
    await user.click(within(card).getByRole('button', { name: 'More actions' }));
    await user.keyboard('{Escape}');
    const links = within(card).getAllByRole('link', { name: /product page/ });
    for (const link of links) await user.click(link);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gives focus back to the card when it closes', async () => {
    const user = userEvent.setup();
    renderCard(item(), { isMember: true });
    await user.click(bodyButton());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bodyButton()).toHaveFocus();
  });
});

describe('what the sheet shows', () => {
  it('shows the full notes, the price and the original under a converted one', () => {
    renderCard(
      item({ notes: 'Black or silver\nEU 39', price: { value: 27900, currency: 'usd' } }),
      { isMember: true, priceCurrency: 'EUR', rates: { eur: 0.88366 } }
    );
    const sheet = openSheet();
    expect(within(sheet).getByText(/Black or silver/)).toHaveTextContent('Black or silver EU 39');
    expect(within(sheet).getByText('≈ €247')).toBeInTheDocument();
    expect(within(sheet).getByText('$279.00')).toBeInTheDocument();
  });

  it('shows the shop link by its domain, opening in a new tab', () => {
    renderCard(item({ link: 'https://www.amazon.de/dp/B0123?tag=x' }), { isMember: true });
    const link = within(openSheet()).getByRole('link', { name: 'Open product page on amazon.de' });
    expect(link).toHaveTextContent('amazon.de');
    expect(link).toHaveAttribute('href', 'https://www.amazon.de/dp/B0123?tag=x');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('offers no link that is not http(s)', () => {
    renderCard(item({ link: 'javascript:alert(1)' }), { isMember: true });
    expect(within(openSheet()).queryByRole('link')).toBeNull();
  });

  it("follows the live item: a poll's update shows, and it goes when the item does", () => {
    const { rerender } = renderCard(item({ notes: 'Black' }), { isMember: true });
    openSheet();
    rerender(
      <WishlistItem
        item={item({ notes: 'Silver now' })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );
    expect(within(screen.getByRole('dialog')).getByText('Silver now')).toBeInTheDocument();
    rerender(<></>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe("the sheet's actions, by role", () => {
  it('gives a member Reserve, and sends it from the sheet, which stays open', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    renderCard(item(), { isMember: true, onUpdate });
    const sheet = openSheet();
    await user.click(within(sheet).getByRole('button', { name: 'Reserve this item' }));
    expect(onUpdate).toHaveBeenCalledWith('item-1', { status: 'booked' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows a member "Reserved by you" and Release on their own booking', () => {
    renderCard(item({ status: 'booked', bookedBy: ME }), { isMember: true });
    const sheet = openSheet();
    expect(within(sheet).getByText('Reserved by you')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Release this item' })).toBeInTheDocument();
  });

  it('shows a member "Reserved" on someone else\'s booking, with nothing to do', () => {
    renderCard(item({ status: 'booked', bookedBy: 'someone-else' }), { isMember: true });
    const sheet = openSheet();
    // The status badge, as on the card, and the held primary.
    expect(within(sheet).getAllByText('Reserved')).toHaveLength(2);
    expect(
      within(sheet).getByRole('button', { name: 'This item is already reserved' })
    ).toBeDisabled();
  });

  it('gives a signed-out visitor no reserve action', () => {
    renderCard(item({ link: 'https://shop.example/x' }), { isAuthenticated: false });
    const sheet = openSheet();
    expect(within(sheet).queryByRole('button', { name: /reserve/i })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(within(sheet).getByRole('link', { name: /shop\.example/ })).toBeInTheDocument();
  });

  it("gives an owner the card's actions, and Edit closes the sheet for the edit dialog", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    renderCard(item(), { isOwner: true, onEdit, onDelete: vi.fn() });
    const sheet = openSheet();
    await user.click(within(sheet).getByRole('button', { name: 'More actions' }));
    const menu = within(sheet).getByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent)
    ).toEqual(['Mark as received', 'Move to draft', 'Mark as most wanted', 'Delete…']);
    await user.keyboard('{Escape}');

    await user.click(within(sheet).getByRole('button', { name: 'Edit item' }));
    expect(onEdit).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // regression: the page's dialog recorded the sheet's Edit as its opener,
  // which went with the sheet, so closing it dropped focus to <body>.
  it('regression: gives focus back to the card when the dialog Edit opened from the sheet closes', async () => {
    const user = userEvent.setup();
    // The page's edit dialog, opened by the card's onEdit.
    function Page() {
      const [editing, setEditing] = useState(false);
      return (
        <>
          <WishlistItem
            item={item()}
            onUpdate={vi.fn()}
            isAuthenticated
            isOwner
            onEdit={() => setEditing(true)}
          />
          <BaseModal
            isOpen={editing}
            onClose={() => setEditing(false)}
            title="Edit item"
            titleId="edit-title"
          >
            <p>form</p>
          </BaseModal>
        </>
      );
    }
    render(<Page />);
    await user.click(bodyButton());
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Edit item' }));
    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bodyButton()).toHaveFocus();
  });

  // regression: in the dialog-shaped sheet (from `sm` up) a short menu opened
  // below the footer, where the panel's overflow clipped it.
  it("regression: opens the sheet's menu above its trigger", async () => {
    const user = userEvent.setup();
    renderCard(item(), { isMember: true, onSaveToList: vi.fn() });
    const sheet = openSheet();
    await user.click(within(sheet).getByRole('button', { name: 'More actions' }));
    const popover = within(sheet).getByRole('menu').closest('.bottom-full');
    expect(popover).not.toBeNull();
  });

  it("asks the owner's Delete… over the sheet", async () => {
    const user = userEvent.setup();
    renderCard(item(), { isOwner: true, onEdit: vi.fn(), onDelete: vi.fn() });
    const sheet = openSheet();
    await user.click(within(sheet).getByRole('button', { name: 'More actions' }));
    await user.click(within(sheet).getByRole('menuitem', { name: 'Delete…' }));
    const confirm = screen.getByRole('alertdialog');
    expect(within(confirm).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    // Portalled to <body>, beside the sheet rather than under the card.
    expect(confirm.closest('[role="article"]')).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  // regression: owners are booking-blind (AGENTS.md). The sheet shows the
  // status the card does, so a reserved item is just available to them.
  it("regression: an owner's sheet for a reserved item shows no reservation", () => {
    renderCard(item({ status: 'booked', bookedBy: 'gifter-1' }), {
      isOwner: true,
      onEdit: vi.fn(),
    });
    const sheet = openSheet();
    expect(within(sheet).queryByText(/reserved/i)).toBeNull();
    expect(within(sheet).queryByRole('button', { name: /release/i })).toBeNull();
    expect(sheet).not.toHaveTextContent('gifter-1');
  });

  // regression: proposals are anonymous to the owner (AGENTS.md).
  it("regression: an owner's sheet for a proposal shows no proposer", () => {
    renderCard(item({ status: 'proposed', proposedBy: 'proposer-1' }), {
      isOwner: true,
      onReview: vi.fn(),
      onDelete: vi.fn(),
    });
    const sheet = openSheet();
    expect(sheet).not.toHaveTextContent('proposer-1');
    expect(sheet).not.toHaveTextContent(/proposed by/i);
    expect(within(sheet).getByRole('button', { name: 'Review proposed item' })).toBeInTheDocument();
  });
});
