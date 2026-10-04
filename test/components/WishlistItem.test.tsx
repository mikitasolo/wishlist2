// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { ApiItem } from '@/types/api';

const ME = 'user-me';

// Stub next-auth session as the current user.
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: ME } }, status: 'authenticated' }),
}));

// BannerImage wraps next/image — render a plain <img> so we can assert presence
// (and fire its load error).
vi.mock('@/components/BannerImage', () => ({
  default: ({ alt, onError }: { alt?: string; onError?: () => void }) => (
    <img alt={alt ?? ''} data-testid="banner-image" onError={onError} />
  ),
}));

// Simplify ConfirmDialog to expose its message + confirm/cancel buttons.
vi.mock('@/components/ConfirmDialog', () => ({
  default: ({
    isOpen,
    title,
    message,
    confirmText,
    onConfirm,
    onCancel,
    type,
    icon,
  }: {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    onConfirm: () => void;
    onCancel: () => void;
    type?: string;
    icon?: string;
  }) =>
    isOpen ? (
      <div role="dialog" data-type={type} data-icon={icon}>
        <h2>{title}</h2>
        <p>{message}</p>
        <button onClick={onConfirm}>{confirmText}</button>
        <button onClick={onCancel}>cancel</button>
      </div>
    ) : null,
}));

import WishlistItem from '@/components/WishlistItem';
import { coverGradient } from '@/lib/utils/cover';
import { STATUS_META, type DisplayStatus } from '@/lib/utils/itemStatus';
import { atWidth } from './viewport';

function item(overrides: Partial<ApiItem>): ApiItem {
  return {
    _id: 'item-1',
    wishlist: 'w1',
    name: 'Cool Gift',
    status: 'available',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  } as ApiItem;
}

beforeEach(() => cleanup());
afterEach(() => vi.unstubAllGlobals());

describe('WishlistItem — booking visibility', () => {
  // Regression: owners must never see booking status ("booked" folds to available).
  it('regression: hides booking badges from the owner', () => {
    render(
      <WishlistItem
        item={item({ status: 'booked', bookedBy: 'someone-else' })}
        onUpdate={vi.fn()}
        isAuthenticated
        isOwner
      />
    );
    expect(screen.queryByText(/booked|reserved/i)).toBeNull();
  });

  it('shows "Reserved by you" to the member who booked it', () => {
    render(
      <WishlistItem
        item={item({ status: 'booked', bookedBy: ME })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );
    expect(screen.getByText(/reserved by you/i)).toBeInTheDocument();
  });

  it('links the "Reserved by you" badge to Reserved', () => {
    render(
      <WishlistItem
        item={item({ status: 'booked', bookedBy: ME })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );
    expect(screen.getByRole('link', { name: 'Reserved by you, open Reserved' })).toHaveAttribute(
      'href',
      '/booked'
    );
  });

  it('does not link the badge when someone else reserved it', () => {
    render(
      <WishlistItem
        item={item({ status: 'booked', bookedBy: 'someone-else' })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );
    expect(screen.queryByRole('link', { name: /open reserved/i })).toBeNull();
  });
});

describe('WishlistItem — status badges and borders', () => {
  const badgeOf = () => screen.getByRole('article').querySelector('[data-tone]');

  const cases: {
    name: string;
    props: Partial<ComponentProps<typeof WishlistItem>>;
    status: DisplayStatus;
  }[] = [
    {
      name: 'a draft, to its owner',
      props: { item: item({ status: 'draft' }), isOwner: true },
      status: 'draft',
    },
    {
      name: 'a proposal, to its owner',
      props: { item: item({ status: 'proposed' }), isOwner: true },
      status: 'proposed',
    },
    {
      name: 'an item the member booked',
      props: { item: item({ status: 'booked', bookedBy: ME }), isMember: true },
      status: 'bookedByMe',
    },
    {
      name: 'an item someone else booked',
      props: { item: item({ status: 'booked', bookedBy: 'someone-else' }), isMember: true },
      status: 'bookedByOthers',
    },
    {
      name: 'a completed item, to a member',
      props: { item: item({ status: 'completed' }), isMember: true },
      status: 'completed',
    },
    {
      name: 'a completed item, to its owner',
      props: { item: item({ status: 'completed' }), isOwner: true },
      status: 'completed',
    },
  ];

  for (const { name, props, status } of cases) {
    it(`takes ${name}'s badge and border from the status map`, () => {
      render(<WishlistItem item={item({})} onUpdate={vi.fn()} isAuthenticated {...props} />);
      const meta = STATUS_META[status];
      const badge = badgeOf();
      expect(badge).not.toBeNull();
      expect(badge).toHaveTextContent(meta.label);
      expect(badge).toHaveAttribute('data-tone', meta.tone);
      for (const cls of meta.classes.badge.split(' ')) expect(badge).toHaveClass(cls);
      // Its icon, so the status never rests on colour alone.
      expect(badge!.querySelector('svg')).not.toBeNull();
      const card = screen.getByRole('article');
      expect(card).toHaveAttribute('data-status', status);
      for (const cls of meta.classes.card.split(' ')) expect(card).toHaveClass(cls);
    });
  }

  it('shows no badge on an available item', () => {
    render(<WishlistItem item={item({})} onUpdate={vi.fn()} isAuthenticated isMember />);
    expect(badgeOf()).toBeNull();
    expect(screen.getByRole('article')).toHaveAttribute('data-status', 'available');
  });

  // regression: "Received" and "Reserved by you" were both emerald badges on
  // emerald-bordered cards, so a member couldn't tell them apart on one grid.
  it('regression: "Received" and "Reserved by you" look different', () => {
    const { unmount } = render(
      <WishlistItem
        item={item({ status: 'booked', bookedBy: ME })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );
    const mine = { badge: badgeOf()!.className, card: screen.getByRole('article').className };
    expect(badgeOf()).toHaveClass('bg-success-fill');
    unmount();

    render(
      <WishlistItem
        item={item({ status: 'completed' })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );
    const done = badgeOf()!;
    expect(done).toHaveTextContent('Received');
    expect(done).toHaveClass('bg-foreground', 'text-background');
    expect(done).not.toHaveClass('bg-success-fill');
    expect(done.className).not.toBe(mine.badge);
    expect(screen.getByRole('article').className).not.toBe(mine.card);
    expect(screen.getByRole('article')).not.toHaveClass('border-success/60');
  });

  // regression: owners must never see booking status, in the card's colours
  // either: a booked item is an available one to them.
  it('regression: gives the owner of a booked item no booked badge or border', () => {
    render(
      <WishlistItem
        item={item({ status: 'booked', bookedBy: 'someone-else' })}
        onUpdate={vi.fn()}
        isAuthenticated
        isOwner
      />
    );
    expect(badgeOf()).toBeNull();
    const card = screen.getByRole('article');
    expect(card).toHaveAttribute('data-status', 'available');
    expect(card.className).not.toMatch(/success|warning/);
  });

  it('fills the Book button with the success tone', () => {
    render(<WishlistItem item={item({})} onUpdate={vi.fn()} isAuthenticated isMember />);
    expect(screen.getByRole('button', { name: 'Reserve this item' })).toHaveClass(
      'bg-success-fill',
      'text-white'
    );
  });
});

/** Opens the card's "More actions" menu with a click. */
function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  return screen.getByRole('menu');
}

/** Picks `name` from the card's "More actions" menu. */
function pick(name: string) {
  openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name }));
}

describe('WishlistItem — owner status actions', () => {
  // Regression: draft items get a Publish action (safe), not a status toggle in edit.
  it('regression: a draft item shows Publish, with Edit in its menu, for the owner', () => {
    const onEdit = vi.fn();
    const draft = item({ status: 'draft' });
    render(
      <WishlistItem item={draft} onUpdate={vi.fn()} onEdit={onEdit} isAuthenticated isOwner />
    );
    expect(screen.getByRole('button', { name: 'Publish item' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit item' })).toBeNull();
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /complete/i })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledWith(draft);
  });

  it('publishing a draft calls onUpdate with status available', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <WishlistItem item={item({ status: 'draft' })} onUpdate={onUpdate} isAuthenticated isOwner />
    );
    fireEvent.click(screen.getByRole('button', { name: /publish/i }));
    expect(onUpdate).toHaveBeenCalledWith('item-1', { status: 'available' });
    await act(async () => {}); // flush async state after onUpdate resolves
  });

  // Regression: moving a live item to draft is dangerous (may be booked) → warn.
  it('regression: move-to-draft warns before applying', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <WishlistItem
        item={item({ status: 'available' })}
        onUpdate={onUpdate}
        isAuthenticated
        isOwner
      />
    );
    // Move to draft is offered on a live item…
    pick('Move to draft');
    // …and shows a warning dialog rather than applying immediately.
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('Move to draft?');
    // Confirming applies status: draft.
    fireEvent.click(screen.getByRole('button', { name: /move to draft/i }));
    expect(onUpdate).toHaveBeenCalledWith('item-1', { status: 'draft' });
    await act(async () => {}); // flush async state after onUpdate resolves
  });

  // regression: the warning said moving to draft "will cancel their
  // reservation". An owner's status change frees the item and keeps the
  // gifter's reservation, which stays on their Reserved page.
  it('regression: move-to-draft says a reservation is released here but kept by the gifter', () => {
    render(
      <WishlistItem
        item={item({ status: 'available' })}
        onUpdate={vi.fn()}
        isAuthenticated
        isOwner
      />
    );
    pick('Move to draft');

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(
      "Hide it from everyone else? If someone reserved it, it's released here, but they keep it on their Reserved page."
    );
    expect(dialog).not.toHaveTextContent(/cancel their reservation/i);
    // A warning, with the warning's own icon: nothing is deleted.
    expect(dialog).toHaveAttribute('data-type', 'warning');
    expect(dialog).not.toHaveAttribute('data-icon');
  });

  it('marking a live item completed asks first', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <WishlistItem
        item={item({ status: 'available' })}
        onUpdate={onUpdate}
        isAuthenticated
        isOwner
      />
    );
    pick('Mark as received');
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('Mark as received?');
    expect(screen.getByRole('dialog')).toHaveTextContent(
      "It stays on the list with a ✓ so people know it's taken care of, and nobody can reserve it. You can undo this."
    );
    fireEvent.click(screen.getByRole('button', { name: 'Mark as received' }));
    expect(onUpdate).toHaveBeenCalledWith('item-1', { status: 'completed' });
    await act(async () => {});
  });

  it('completed items offer Mark as available, at once, and no move-to-draft', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <WishlistItem
        item={item({ status: 'completed' })}
        onUpdate={onUpdate}
        isAuthenticated
        isOwner
      />
    );
    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Move to draft' })).toBeNull();
    // Reversible, so no confirmation.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark as not received' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onUpdate).toHaveBeenCalledWith('item-1', { status: 'available' });
    await act(async () => {});
  });
});

/** What a card offers: its primary action, the link button, and its menu's items. */
interface Offer {
  /** The labelled action: a button's or link's accessible name, or a static note. */
  primary:
    | { button: string; text: string; disabled?: boolean }
    | { link: string }
    // Nothing in that slot (no dead placeholder).
    | { nothing: true };
  /** The square beside it: the product page, an owner's "+ link", or none. */
  linkButton: 'link' | 'add-link' | null;
  /** The menu's items, in order; null for no menu at all. */
  menu: string[] | null;
}

const LINK = 'https://shop.example/gift';
const PRODUCT_PAGE = 'View Cool Gift product page';

/** The cover frame: square, or 4:3 on a phone for an item with no image. */
const isCover = (el: Element) => el.matches('[class*="aspect-"]');

describe('WishlistItem — the action row, by role and state', () => {
  const cases: Array<{
    name: string;
    item: Partial<ApiItem>;
    props: Partial<ComponentProps<typeof WishlistItem>>;
    offer: Offer;
  }> = [
    {
      name: 'owner, live item',
      item: { link: LINK },
      props: { isOwner: true, onEdit: vi.fn(), onSaveToList: vi.fn(), onDelete: vi.fn() },
      offer: {
        primary: { button: 'Edit item', text: 'Edit' },
        linkButton: 'link',
        menu: [
          'Mark as received',
          'Move to draft',
          'Mark as most wanted',
          'Save to my list',
          'Delete',
        ],
      },
    },
    {
      // regression guard: owners never see booking status.
      name: 'owner, item someone booked (shown as available)',
      item: { link: LINK, status: 'booked', bookedBy: 'someone-else' },
      props: { isOwner: true, onEdit: vi.fn(), onSaveToList: vi.fn(), onDelete: vi.fn() },
      offer: {
        primary: { button: 'Edit item', text: 'Edit' },
        linkButton: 'link',
        menu: [
          'Mark as received',
          'Move to draft',
          'Mark as most wanted',
          'Save to my list',
          'Delete',
        ],
      },
    },
    {
      name: 'owner, completed item',
      item: { link: LINK, status: 'completed' },
      props: { isOwner: true, onEdit: vi.fn(), onSaveToList: vi.fn(), onDelete: vi.fn() },
      offer: {
        primary: { button: 'Edit item', text: 'Edit' },
        linkButton: 'link',
        menu: ['Mark as not received', 'Mark as most wanted', 'Save to my list', 'Delete'],
      },
    },
    {
      // The page gives no "Save to my list" for a draft.
      name: 'owner, draft',
      item: { link: LINK, status: 'draft' },
      props: { isOwner: true, onEdit: vi.fn(), onDelete: vi.fn() },
      offer: {
        primary: { button: 'Publish item', text: 'Publish' },
        linkButton: 'link',
        menu: ['Edit', 'Mark as most wanted', 'Delete'],
      },
    },
    {
      // Declining is all there is to do on someone's proposal.
      name: 'owner, proposed item',
      item: { link: LINK, status: 'proposed' },
      props: { isOwner: true, onReview: vi.fn(), onDelete: vi.fn() },
      offer: {
        primary: { button: 'Review proposed item', text: 'Review' },
        linkButton: 'link',
        menu: ['Decline'],
      },
    },
    {
      name: 'owner, live item without a link',
      item: {},
      props: {
        isOwner: true,
        onEdit: vi.fn(),
        onSaveToList: vi.fn(),
        onDelete: vi.fn(),
        onAddLink: vi.fn(),
      },
      offer: {
        primary: { button: 'Edit item', text: 'Edit' },
        linkButton: 'add-link',
        menu: [
          'Mark as received',
          'Move to draft',
          'Mark as most wanted',
          'Save to my list',
          'Delete',
        ],
      },
    },
    {
      name: 'proposer, their own proposal',
      item: { link: LINK, status: 'proposed', proposedBy: ME },
      props: { isMember: true, onEdit: vi.fn(), onSaveToList: vi.fn() },
      offer: {
        primary: { button: 'Edit proposed item', text: 'Edit' },
        linkButton: 'link',
        menu: ['Save to my list'],
      },
    },
    {
      name: 'member, available item',
      item: { link: LINK },
      props: { isMember: true, onSaveToList: vi.fn() },
      offer: {
        primary: { button: 'Reserve this item', text: 'Reserve' },
        linkButton: 'link',
        menu: ['Save to my list'],
      },
    },
    {
      name: 'member, item they booked',
      item: { link: LINK, status: 'booked', bookedBy: ME },
      props: { isMember: true, onSaveToList: vi.fn() },
      offer: {
        primary: { button: 'Release this item', text: 'Release' },
        linkButton: 'link',
        menu: ['Save to my list'],
      },
    },
    {
      // regression: Unbook stayed on a gift already given, so tidying up put it
      // back up for someone else to buy. Releasing it is in the menu, behind a
      // warning (see below).
      name: 'member, item they booked and have marked as given',
      item: { link: LINK, status: 'booked', bookedBy: ME, givenByMe: true },
      props: { isMember: true, onSaveToList: vi.fn() },
      offer: {
        primary: { button: 'Given by you', text: 'Given by you', disabled: true },
        linkButton: 'link',
        menu: ['Release', 'Save to my list'],
      },
    },
    {
      name: 'member, item someone else booked',
      item: { link: LINK, status: 'booked' },
      props: { isMember: true, onSaveToList: vi.fn() },
      offer: {
        primary: { button: 'This item is already reserved', text: 'Reserved', disabled: true },
        linkButton: 'link',
        menu: ['Save to my list'],
      },
    },
    {
      // Nothing to book: the product link is the primary action.
      name: 'member, completed item',
      item: { link: LINK, status: 'completed' },
      props: { isMember: true, onSaveToList: vi.fn() },
      offer: { primary: { link: PRODUCT_PAGE }, linkButton: null, menu: ['Save to my list'] },
    },
    {
      name: 'member, available item without a link',
      item: {},
      props: { isMember: true, onSaveToList: vi.fn() },
      offer: {
        primary: { button: 'Reserve this item', text: 'Reserve' },
        linkButton: null,
        menu: ['Save to my list'],
      },
    },
    {
      name: 'signed-in visitor (not a member)',
      item: { link: LINK },
      props: { onSaveToList: vi.fn() },
      offer: { primary: { link: PRODUCT_PAGE }, linkButton: null, menu: ['Save to my list'] },
    },
    {
      name: 'signed-in visitor, item without a link',
      item: {},
      props: { onSaveToList: vi.fn() },
      // Saving takes the primary's place, so the menu has nothing left.
      offer: {
        primary: { button: 'Save to my list', text: 'Save' },
        linkButton: null,
        menu: null,
      },
    },
    {
      name: 'signed-out visitor',
      item: { link: LINK },
      props: { isAuthenticated: false, onSaveToList: vi.fn() },
      offer: { primary: { link: PRODUCT_PAGE }, linkButton: null, menu: null },
    },
    {
      name: 'signed-out visitor, item without a link',
      item: {},
      props: { isAuthenticated: false },
      offer: { primary: { nothing: true }, linkButton: null, menu: null },
    },
  ];

  // From `sm` up, the row is as it was before the phone grid (WIS-245).
  it.each(cases)('$name, from sm up', ({ item: overrides, props, offer }) => {
    atWidth(1280);
    render(<WishlistItem item={item(overrides)} onUpdate={vi.fn()} isAuthenticated {...props} />);
    const card = screen.getByRole('article');
    // The cover links to the product page too, so the row's links are the others.
    const rowLinks = within(card)
      .queryAllByRole('link', { name: PRODUCT_PAGE })
      .filter((a) => !isCover(a));

    if ('button' in offer.primary) {
      const button = within(card).getByRole('button', { name: offer.primary.button });
      expect(button).toHaveTextContent(offer.primary.text);
      if (offer.primary.disabled) expect(button).toBeDisabled();
      else expect(button).toBeEnabled();
    } else if ('link' in offer.primary) {
      expect(rowLinks).toHaveLength(1);
      expect(rowLinks[0]).toHaveTextContent('View item');
      expect(rowLinks[0]).toHaveAttribute('href', LINK);
    } else {
      expect(within(card).queryByText('No link provided')).toBeNull();
    }

    if (offer.linkButton === 'link') {
      expect(rowLinks).toHaveLength(1);
      expect(rowLinks[0]).toHaveAttribute('href', LINK);
      expect(rowLinks[0]).toHaveAttribute('target', '_blank');
      expect(rowLinks[0]).toHaveAttribute('title', 'View product page');
      expect(rowLinks[0]).not.toHaveTextContent('View item');
    } else if (offer.linkButton === 'add-link') {
      expect(rowLinks).toHaveLength(0);
      expect(within(card).getByRole('button', { name: 'Add product link' })).toBeEnabled();
    } else if (!('link' in offer.primary)) {
      expect(rowLinks).toHaveLength(0);
    }

    const trigger = within(card).queryByRole('button', { name: 'More actions' });
    if (offer.menu === null) {
      expect(trigger).toBeNull();
    } else {
      fireEvent.click(trigger!);
      const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
      expect(items.map((el) => el.textContent)).toEqual(offer.menu);
    }

    // Owners never see booking status, whatever the item's.
    if (props.isOwner) expect(within(card).queryByText(/book|reserv/i)).toBeNull();
  });

  // Below `sm` (WIS-245): [primary] [⋯]. The link square folds into the menu
  // as its first item, the "no link" marker goes, and the rest is unchanged.
  it.each(cases)('$name, below sm', ({ item: overrides, props, offer }) => {
    atWidth(390);
    render(<WishlistItem item={item(overrides)} onUpdate={vi.fn()} isAuthenticated {...props} />);
    const card = screen.getByRole('article');
    const rowLinks = within(card)
      .queryAllByRole('link', { name: PRODUCT_PAGE })
      .filter((a) => !isCover(a));

    if ('button' in offer.primary) {
      const button = within(card).getByRole('button', { name: offer.primary.button });
      expect(button).toHaveTextContent(offer.primary.text);
      if (offer.primary.disabled) expect(button).toBeDisabled();
      else expect(button).toBeEnabled();
      // No square beside it: not hidden, not rendered.
      expect(rowLinks).toHaveLength(0);
    } else if ('link' in offer.primary) {
      expect(rowLinks).toHaveLength(1);
      expect(rowLinks[0]).toHaveTextContent('View item');
    } else {
      expect(within(card).queryByText('No link provided')).toBeNull();
    }
    expect(within(card).queryByRole('button', { name: 'Add product link' })).toBeNull();
    expect(card.querySelector('[title="View product page"]')).toBeNull();

    const menu =
      offer.linkButton === 'link' ? ['Open product page', ...(offer.menu ?? [])] : offer.menu;
    const trigger = within(card).queryByRole('button', { name: 'More actions' });
    if (menu === null) {
      expect(trigger).toBeNull();
    } else {
      fireEvent.click(trigger!);
      const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
      expect(items.map((el) => el.textContent)).toEqual(menu);
    }
    if (offer.linkButton === 'link') {
      const open = within(screen.getByRole('menu')).getByRole('menuitem', {
        name: 'Open product page',
      });
      expect(open).toHaveAttribute('href', LINK);
      expect(open).toHaveAttribute('target', '_blank');
      expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    }

    if (props.isOwner) expect(within(card).queryByText(/book|reserv/i)).toBeNull();
  });

  // WIS-316: the cover opens the item's sheet like the body does; it is no
  // longer a link to the product page, which stays in the row, the menu and
  // the sheet.
  it.each([390, 1280])('opens the sheet from the cover, not the shop link, at %ipx', (width) => {
    atWidth(width);
    render(
      <WishlistItem item={item({ link: LINK })} onUpdate={vi.fn()} isAuthenticated isMember />
    );
    const card = screen.getByRole('article');
    const cover = card.querySelector('[class*="aspect-"]') as HTMLElement;
    expect(cover.tagName).not.toBe('A');
    expect(within(card).queryAllByRole('link', { name: PRODUCT_PAGE }).filter(isCover)).toEqual([]);
    // One accessible way in: the cover's button is hidden from assistive tech.
    expect(within(card).getAllByRole('button', { name: 'Cool Gift' })).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(cover.querySelector('button') as HTMLElement);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // The product link is still offered: the square from sm up, the menu below.
    if (width >= 640) {
      expect(within(card).getAllByRole('link', { name: PRODUCT_PAGE })).toHaveLength(1);
    } else {
      fireEvent.click(within(card).getByRole('button', { name: 'More actions' }));
      expect(screen.getByRole('menuitem', { name: 'Open product page' })).toHaveAttribute(
        'href',
        LINK
      );
    }
  });

  // Before the width is known (the server render, and the render hydrating
  // it), both layouts are in the HTML, and CSS shows the right one: so the
  // first paint is right at any width, and hydration can't disagree with it.
  it('renders both layouts for CSS to choose between until the width is known', () => {
    render(
      <WishlistItem
        item={item({ link: LINK, status: 'proposed' })}
        onUpdate={vi.fn()}
        isAuthenticated
        isOwner
        onReview={vi.fn()}
      />
    );
    const card = screen.getByRole('article');
    const square = within(card)
      .getAllByRole('link', { name: PRODUCT_PAGE })
      .find((a) => !isCover(a));
    expect(square).toHaveClass('max-sm:hidden');
    // A menu that will hold only the folded link is there below sm only.
    const trigger = within(card).getByRole('button', { name: 'More actions' });
    expect(trigger.parentElement).toHaveClass('sm:hidden');
    // And it's never an empty one that does nothing.
    expect(trigger).not.toHaveAttribute('aria-disabled');
    fireEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Open product page' })).toHaveAttribute(
      'href',
      LINK
    );
  });

  it('follows the width when it crosses sm', () => {
    const mq = atWidth(390);
    render(
      <WishlistItem item={item({ link: LINK })} onUpdate={vi.fn()} isAuthenticated isMember />
    );
    const card = screen.getByRole('article');
    const squares = () =>
      within(card)
        .queryAllByRole('link', { name: PRODUCT_PAGE })
        .filter((a) => !isCover(a));
    expect(squares()).toHaveLength(0);

    act(() => mq.resize(1280));
    expect(squares()).toHaveLength(1);
    // The menu is back to the desktop's: no product page in it.
    expect(within(card).queryByRole('button', { name: 'More actions' })).toBeNull();
  });
});

describe('WishlistItem — a gift the member has marked as given', () => {
  const given = item({ link: LINK, status: 'booked', bookedBy: ME, givenByMe: true });

  // regression: after "Mark as given" on the Reserved page, the card still
  // offered Unbook, and pressing it to tidy up put a gift already given back up
  // for someone else on the list to buy.
  it('regression: shows "Given by you" in place of Unbook', () => {
    render(<WishlistItem item={given} onUpdate={vi.fn()} isAuthenticated isMember />);

    expect(screen.getByRole('button', { name: 'Given by you' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Release this item' })).toBeNull();
  });

  // The narrow card (WIS-245) has no room for "Given by you" beside ⋯.
  it('says just "Given" below sm, named "Given by you" all the same', () => {
    render(<WishlistItem item={given} onUpdate={vi.fn()} isAuthenticated isMember />);
    const button = screen.getByRole('button', { name: 'Given by you' });
    expect(within(button).getByText('Given')).toHaveClass('sm:hidden');
    expect(within(button).getByText('Given by you')).toHaveClass('max-sm:hidden');
  });

  it('warns before Release in the menu unbooks it', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(<WishlistItem item={given} onUpdate={onUpdate} isAuthenticated isMember />);

    pick('Release');
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Release this gift?');
    expect(dialog).toHaveTextContent('someone else on the list could reserve it and buy it again');
    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Release' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('item-1', { status: 'available' });
    await act(async () => {});
  });

  it('releases nothing when the warning is cancelled', () => {
    const onUpdate = vi.fn();
    render(<WishlistItem item={given} onUpdate={onUpdate} isAuthenticated isMember />);

    pick('Release');
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('holds Release while the unbook runs', async () => {
    let settle!: () => void;
    const onUpdate = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    render(<WishlistItem item={given} onUpdate={onUpdate} isAuthenticated isMember />);

    pick('Release');
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);

    openMenu();
    const releaseItem = screen.getByRole('menuitem', { name: 'Release' });
    expect(releaseItem).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(releaseItem);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    await act(async () => settle());
  });

  it('releases nothing if the item stopped being theirs while the warning was open', () => {
    const onUpdate = vi.fn();
    const view = render(<WishlistItem item={given} onUpdate={onUpdate} isAuthenticated isMember />);

    pick('Release');
    // A poll lands meanwhile: they've released it from another tab.
    view.rerender(
      <WishlistItem
        item={{ ...given, status: 'available', bookedBy: undefined, givenByMe: false }}
        onUpdate={onUpdate}
        isAuthenticated
        isMember
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Release' }));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('shows Unbook as before on a booking not marked as given', () => {
    render(
      <WishlistItem
        item={item({ status: 'booked', bookedBy: ME, givenByMe: false })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );
    expect(screen.getByRole('button', { name: 'Release this item' })).toBeEnabled();
    expect(screen.queryByText('Given by you')).toBeNull();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  // The flag never reaches an owner (the API leaves it out), and the card
  // wouldn't show it to one anyway: owners never see booking status.
  it('regression guard: an owner never sees it', () => {
    render(
      <WishlistItem item={given} onUpdate={vi.fn()} onEdit={vi.fn()} isAuthenticated isOwner />
    );
    expect(screen.queryByText(/given/i)).toBeNull();
    expect(screen.queryByText(/book|reserv/i)).toBeNull();
    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Release' })).toBeNull();
  });
});

describe('WishlistItem — while an update runs', () => {
  it('holds Book, keeping it focusable, and takes no second booking; Save to my list stays', async () => {
    let settle!: () => void;
    const onUpdate = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    const onSaveToList = vi.fn();
    const shown = item({ link: LINK });
    render(
      <WishlistItem
        item={shown}
        onUpdate={onUpdate}
        onSaveToList={onSaveToList}
        isAuthenticated
        isMember
      />
    );
    const book = screen.getByRole('button', { name: 'Reserve this item' });
    fireEvent.click(book);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    // aria-disabled, not disabled: focus on it doesn't drop to <body>.
    expect(book).toHaveAttribute('aria-disabled', 'true');
    expect(book).not.toBeDisabled();
    fireEvent.click(book);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    // Copying the item has nothing to do with its status, as before.
    pick('Save to my list');
    expect(onSaveToList).toHaveBeenCalledWith(shown);

    await act(async () => settle());
    expect(book).not.toHaveAttribute('aria-disabled');
  });

  it("holds an owner's status changes in the menu, not Edit or Save to my list", async () => {
    let settle!: () => void;
    const onUpdate = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    const onEdit = vi.fn();
    render(
      <WishlistItem
        item={item({ status: 'completed' })}
        onUpdate={onUpdate}
        onEdit={onEdit}
        onSaveToList={vi.fn()}
        isAuthenticated
        isOwner
      />
    );
    pick('Mark as not received');
    expect(onUpdate).toHaveBeenCalledTimes(1);

    openMenu();
    const markAvailable = screen.getByRole('menuitem', { name: 'Mark as not received' });
    expect(markAvailable).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: 'Save to my list' })).not.toHaveAttribute(
      'aria-disabled'
    );
    fireEvent.click(markAvailable);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    const edit = screen.getByRole('button', { name: 'Edit item' });
    expect(edit).not.toHaveAttribute('aria-disabled');
    fireEvent.click(edit);
    expect(onEdit).toHaveBeenCalledTimes(1);

    await act(async () => settle());
  });

  it("holds an owner's Publish", async () => {
    let settle!: () => void;
    const onUpdate = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));
    render(
      <WishlistItem
        item={item({ status: 'draft' })}
        onUpdate={onUpdate}
        onEdit={vi.fn()}
        isAuthenticated
        isOwner
      />
    );
    const publish = screen.getByRole('button', { name: 'Publish item' });
    fireEvent.click(publish);
    expect(publish).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(publish);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    await act(async () => settle());
    expect(publish).not.toHaveAttribute('aria-disabled');
  });
});

describe('WishlistItem — cover image', () => {
  const IMAGE = 'https://x/y.jpg';

  // jsdom normalises the inline style, so compare against what it makes of the
  // gradient rather than the raw string.
  function placeholderOf(seed: string) {
    const probe = document.createElement('div');
    probe.style.background = coverGradient(seed);
    return probe.style.background;
  }

  it('shows the placeholder when the item has no image', () => {
    render(<WishlistItem item={item({})} onUpdate={vi.fn()} isAuthenticated isMember />);
    expect(screen.queryByTestId('banner-image')).toBeNull();
    const cover = screen.getByRole('article').querySelector('[class*="aspect-"]') as HTMLElement;
    expect(cover.style.background).toBe(placeholderOf('item-1'));
  });

  // The phone grid (WIS-245): a gradient alone said nothing, at full height.
  it('gives an item with no image a short 4:3 placeholder with its initial below sm', () => {
    render(
      <WishlistItem
        item={item({ name: 'wingspan board game' })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );
    const cover = screen.getByRole('article').querySelector('[class*="aspect-"]') as HTMLElement;
    // 4:3 below sm, square from sm up, as before.
    expect(cover).toHaveClass('aspect-[4/3]', 'sm:aspect-square');
    expect(cover).not.toHaveClass('aspect-square');
    // The initial is decoration: the card's name already says it.
    const initial = within(cover).getByText('W');
    expect(initial.closest('[aria-hidden]')).not.toBeNull();
    expect(initial).toHaveClass('sm:hidden');
  });

  it('keeps an item with an image square, with no initial', () => {
    render(
      <WishlistItem item={item({ imageUrl: IMAGE })} onUpdate={vi.fn()} isAuthenticated isMember />
    );
    const cover = screen.getByTestId('banner-image').parentElement as HTMLElement;
    expect(cover).toHaveClass('aspect-square');
    expect(within(cover).queryByText('C')).toBeNull();
  });

  it('shows the initial once an image fails to load, keeping the frame square', () => {
    render(
      <WishlistItem item={item({ imageUrl: IMAGE })} onUpdate={vi.fn()} isAuthenticated isMember />
    );
    const cover = screen.getByTestId('banner-image').parentElement as HTMLElement;
    fireEvent.error(screen.getByTestId('banner-image'));
    expect(cover).toHaveClass('aspect-square');
    expect(within(cover).getByText('C')).toBeInTheDocument();
  });

  // regression: the card painted the gradient only when there was no image URL,
  // so a freed blob or a dead external image left a blank tile.
  it('regression: falls back to the placeholder when the image fails to load', () => {
    render(
      <WishlistItem item={item({ imageUrl: IMAGE })} onUpdate={vi.fn()} isAuthenticated isMember />
    );
    const img = screen.getByTestId('banner-image');
    const cover = img.parentElement as HTMLElement;
    expect(cover.style.background).toBe('');

    fireEvent.error(img);

    expect(screen.queryByTestId('banner-image')).toBeNull();
    expect(cover.style.background).toBe(placeholderOf('item-1'));
  });

  // regression: same blank tile on the product-link variant of the cover.
  it('regression: falls back to the placeholder on a linked item', () => {
    render(
      <WishlistItem
        item={item({ imageUrl: IMAGE, link: 'https://shop.example/gift' })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );

    fireEvent.error(screen.getByTestId('banner-image'));

    const link = screen.getByRole('article').querySelector('.aspect-square') as HTMLElement;
    expect(screen.queryByTestId('banner-image')).toBeNull();
    expect(link.style.background).toBe(placeholderOf('item-1'));
  });

  it('shows the new image when an edit replaces a broken one', () => {
    const { rerender } = render(
      <WishlistItem item={item({ imageUrl: IMAGE })} onUpdate={vi.fn()} isAuthenticated isMember />
    );
    fireEvent.error(screen.getByTestId('banner-image'));

    rerender(
      <WishlistItem
        item={item({ imageUrl: `${IMAGE}?v=2` })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );

    expect(screen.getByTestId('banner-image')).toBeInTheDocument();
  });
});

describe('WishlistItem — price conversion', () => {
  // Regression: the currency selector converts displayed prices via rates.
  it('regression: converts the displayed price to the picked currency', () => {
    const rates = { pln: 4 }; // 1 USD = 4 PLN
    const priced = item({ price: { value: 400, currency: 'pln' } }); // 4 PLN

    const { rerender } = render(
      <WishlistItem
        item={priced}
        onUpdate={vi.fn()}
        isAuthenticated
        priceCurrency="original"
        rates={rates}
      />
    );
    expect(screen.getByText('PLN 4.00')).toBeInTheDocument();

    rerender(
      <WishlistItem
        item={priced}
        onUpdate={vi.fn()}
        isAuthenticated
        priceCurrency="usd"
        rates={rates}
      />
    );
    expect(screen.getByText('≈ $1.00')).toBeInTheDocument();
  });

  // regression: a converted price looked exact ("EUR 246.54" from USD 279),
  // with no sign it was converted and no trace of the original.
  it('regression: marks a converted price with ≈ and shows the original under it', () => {
    const rates = { eur: 0.88366 }; // 1 USD = 0.88366 EUR
    render(
      <WishlistItem
        item={item({ price: { value: 27900, currency: 'usd' } })}
        onUpdate={vi.fn()}
        isAuthenticated
        priceCurrency="EUR"
        rates={rates}
      />
    );
    const converted = screen.getByText('≈ €247');
    const original = screen.getByText('$279.00');
    // The original sits on its own, muted, line under the converted price.
    expect(converted).not.toBe(original);
    expect(original).toHaveClass('text-muted-foreground');
  });

  it('shows a price already in the picked currency, or with no rate yet, exactly', () => {
    const priced = item({ price: { value: 34900, currency: 'eur' } });
    const { rerender } = render(
      <WishlistItem
        item={priced}
        onUpdate={vi.fn()}
        isAuthenticated
        priceCurrency="EUR"
        rates={{ eur: 0.9 }}
      />
    );
    expect(screen.getByText('€349.00')).toBeInTheDocument();
    expect(screen.queryByText(/≈/)).toBeNull();

    rerender(
      <WishlistItem
        item={priced}
        onUpdate={vi.fn()}
        isAuthenticated
        priceCurrency="PLN"
        rates={null}
      />
    );
    expect(screen.getByText('€349.00')).toBeInTheDocument();
    expect(screen.queryByText(/≈/)).toBeNull();
  });
});

describe('WishlistItem — price format', () => {
  afterEach(() => vi.restoreAllMocks());

  it('formats the price in the viewer’s locale', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
    render(
      <WishlistItem
        item={item({ price: { value: 1234550, currency: 'eur' } })}
        onUpdate={vi.fn()}
        isAuthenticated
      />
    );
    expect(screen.getByText('12.345,50 €')).toBeInTheDocument();
  });
});

describe('WishlistItem — most wanted badge', () => {
  it('shows the badge to owners, members and visitors alike', () => {
    const wanted = item({ mostWanted: true });
    for (const props of [{ isOwner: true }, { isMember: true }, {}]) {
      const { unmount } = render(
        <WishlistItem item={wanted} onUpdate={vi.fn()} isAuthenticated {...props} />
      );
      expect(screen.getByText('Most wanted')).toBeInTheDocument();
      unmount();
    }
  });

  // The narrow card (WIS-245): the star alone, still named for a screen reader,
  // under the status badge, so the two fit inside the cover's corner.
  it('is just its star below sm, named all the same, under the status', () => {
    render(
      <WishlistItem
        item={item({ mostWanted: true, status: 'booked', bookedBy: ME })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );
    expect(screen.getByText('Most wanted')).toHaveClass('max-sm:sr-only');
    const status = screen.getByRole('article').querySelector('[data-tone]');
    expect(status).toHaveTextContent('Reserved by you');
    // Your own reservation's badge is a link, and the link is what's ordered.
    expect(status?.closest('a') ?? status).toHaveClass('max-sm:order-first');
  });

  it('shows no badge on an item that is not most wanted, or has no flag', () => {
    for (const plain of [item({ mostWanted: false }), item({})]) {
      const { unmount } = render(<WishlistItem item={plain} onUpdate={vi.fn()} isAuthenticated />);
      expect(screen.queryByText('Most wanted')).toBeNull();
      unmount();
    }
  });
});

describe('WishlistItem — "Save to my list"', () => {
  const saveItem = () => screen.queryByRole('menuitem', { name: 'Save to my list' });
  const moreActions = () => screen.queryByRole('button', { name: 'More actions' });

  it('is offered to signed-in owners, members and visitors, and hands over the item', () => {
    const shown = item({ status: 'booked', bookedBy: 'someone-else', link: LINK });
    for (const props of [{ isOwner: true }, { isMember: true }, {}]) {
      const onSaveToList = vi.fn();
      const { unmount } = render(
        <WishlistItem
          item={shown}
          onUpdate={vi.fn()}
          onSaveToList={onSaveToList}
          isAuthenticated
          {...props}
        />
      );
      fireEvent.click(moreActions()!);
      fireEvent.click(saveItem()!);
      expect(onSaveToList).toHaveBeenCalledWith(shown);
      unmount();
    }
  });

  it('is not offered when signed out', () => {
    render(
      <WishlistItem
        item={item({})}
        onUpdate={vi.fn()}
        onSaveToList={vi.fn()}
        isAuthenticated={false}
      />
    );
    expect(moreActions()).toBeNull();
    expect(screen.queryByText('Save to my list')).toBeNull();
  });

  it('is not offered when the page gives no handler', () => {
    render(<WishlistItem item={item({})} onUpdate={vi.fn()} isAuthenticated isMember />);
    expect(moreActions()).toBeNull();
    expect(screen.queryByText('Save to my list')).toBeNull();
  });
});

describe("WishlistItem — the owner's menu: Most wanted, Delete and Decline", () => {
  const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

  it('toggles Most wanted with a content edit of mostWanted alone', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(
      <WishlistItem item={item({})} onUpdate={onUpdate} isAuthenticated isOwner />
    );
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark as most wanted' }));
    expect(onUpdate).toHaveBeenCalledWith('item-1', { mostWanted: true });
    await act(async () => {});
    unmount();

    onUpdate.mockClear();
    render(
      <WishlistItem item={item({ mostWanted: true })} onUpdate={onUpdate} isAuthenticated isOwner />
    );
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Not most wanted' }));
    expect(onUpdate).toHaveBeenCalledWith('item-1', { mostWanted: false });
    await act(async () => {});
  });

  it('is not offered to members', () => {
    render(
      <WishlistItem
        item={item({})}
        onUpdate={vi.fn()}
        onSaveToList={vi.fn()}
        isAuthenticated
        isMember
      />
    );
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /most wanted/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /delete|decline/i })).toBeNull();
  });

  it('asks before deleting, and Cancel sends nothing', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <WishlistItem
        item={item({})}
        onUpdate={vi.fn()}
        onDelete={onDelete}
        isAuthenticated
        isOwner
      />
    );
    openMenu();
    const del = screen.getByRole('menuitem', { name: 'Delete' });
    expect(del).toHaveClass('text-danger');
    fireEvent.click(del);
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete item');
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ _id: 'item-1' }));
    await act(async () => {});
  });

  it('keeps the item when the delete fails', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('nope'));
    render(
      <WishlistItem
        item={item({})}
        onUpdate={vi.fn()}
        onDelete={onDelete}
        isAuthenticated
        isOwner
      />
    );
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it("declines a proposal with the review dialog's words, after asking", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <WishlistItem
        item={item({ status: 'proposed' })}
        onUpdate={vi.fn()}
        onReview={vi.fn()}
        onDelete={onDelete}
        isAuthenticated
        isOwner
      />
    );
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Decline' }));
    expect(onDelete).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Decline this proposal?');
    expect(dialog).toHaveTextContent("It's removed from the list.");
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    await act(async () => {});
  });

  it('+ link opens Edit for the item', () => {
    const onAddLink = vi.fn();
    const shown = item({});
    render(
      <WishlistItem
        item={shown}
        onUpdate={vi.fn()}
        onEdit={vi.fn()}
        onAddLink={onAddLink}
        isAuthenticated
        isOwner
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add product link' }));
    expect(onAddLink).toHaveBeenCalledWith(shown);
  });

  it('a signed-in non-member saves a linkless item as the primary action', () => {
    const onSaveToList = vi.fn();
    const shown = item({});
    render(
      <WishlistItem item={shown} onUpdate={vi.fn()} onSaveToList={onSaveToList} isAuthenticated />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save to my list' }));
    expect(onSaveToList).toHaveBeenCalledWith(shown);
  });
});
