// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  }: {
    isOpen: boolean;
    title: string;
    message: string;
    confirmText: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    isOpen ? (
      <div role="dialog">
        <h2>{title}</h2>
        <p>{message}</p>
        <button onClick={onConfirm}>{confirmText}</button>
        <button onClick={onCancel}>cancel</button>
      </div>
    ) : null,
}));

import WishlistItem from '@/components/WishlistItem';
import { coverGradient } from '@/lib/utils/cover';

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
    expect(screen.queryByText(/booked/i)).toBeNull();
  });

  it('shows "Booked by you" to the member who booked it', () => {
    render(
      <WishlistItem
        item={item({ status: 'booked', bookedBy: ME })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );
    expect(screen.getByText(/booked by you/i)).toBeInTheDocument();
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
    expect(screen.getByRole('dialog')).toHaveTextContent(/cancel their reservation/i);
    // Confirming applies status: draft.
    fireEvent.click(screen.getByRole('button', { name: /move to draft/i }));
    expect(onUpdate).toHaveBeenCalledWith('item-1', { status: 'draft' });
    await act(async () => {}); // flush async state after onUpdate resolves
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
    pick('Mark as completed');
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveTextContent('Mark as completed?');
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
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
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark as available' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onUpdate).toHaveBeenCalledWith('item-1', { status: 'available' });
    await act(async () => {});
  });
});

/** What a card offers: its primary action, the link button, and its menu's items. */
interface Offer {
  /** The labelled action: a button's or link's accessible name, or a static note. */
  primary:
    { button: string; text: string; disabled?: boolean } | { link: string } | { note: string };
  /** The square link button: the product page, the "no link" marker, or none. */
  linkButton: 'link' | 'none-provided' | null;
  /** The menu's items, in order; null for no menu at all. */
  menu: string[] | null;
}

const LINK = 'https://shop.example/gift';
const PRODUCT_PAGE = 'View Cool Gift product page';

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
      props: { isOwner: true, onEdit: vi.fn(), onSaveToList: vi.fn() },
      offer: {
        primary: { button: 'Edit item', text: 'Edit' },
        linkButton: 'link',
        menu: ['Mark as completed', 'Move to draft', 'Save to my list'],
      },
    },
    {
      // regression guard: owners never see booking status.
      name: 'owner, item someone booked (shown as available)',
      item: { link: LINK, status: 'booked', bookedBy: 'someone-else' },
      props: { isOwner: true, onEdit: vi.fn(), onSaveToList: vi.fn() },
      offer: {
        primary: { button: 'Edit item', text: 'Edit' },
        linkButton: 'link',
        menu: ['Mark as completed', 'Move to draft', 'Save to my list'],
      },
    },
    {
      name: 'owner, completed item',
      item: { link: LINK, status: 'completed' },
      props: { isOwner: true, onEdit: vi.fn(), onSaveToList: vi.fn() },
      offer: {
        primary: { button: 'Edit item', text: 'Edit' },
        linkButton: 'link',
        menu: ['Mark as available', 'Save to my list'],
      },
    },
    {
      // The page gives no "Save to my list" for a draft.
      name: 'owner, draft',
      item: { link: LINK, status: 'draft' },
      props: { isOwner: true, onEdit: vi.fn() },
      offer: {
        primary: { button: 'Publish item', text: 'Publish' },
        linkButton: 'link',
        menu: ['Edit'],
      },
    },
    {
      // Nothing else to do on someone's proposal: no menu at all.
      name: 'owner, proposed item',
      item: { link: LINK, status: 'proposed' },
      props: { isOwner: true, onReview: vi.fn() },
      offer: {
        primary: { button: 'Review proposed item', text: 'Review' },
        linkButton: 'link',
        menu: null,
      },
    },
    {
      name: 'owner, live item without a link',
      item: {},
      props: { isOwner: true, onEdit: vi.fn(), onSaveToList: vi.fn() },
      offer: {
        primary: { button: 'Edit item', text: 'Edit' },
        linkButton: 'none-provided',
        menu: ['Mark as completed', 'Move to draft', 'Save to my list'],
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
        primary: { button: 'Book this item', text: 'Book' },
        linkButton: 'link',
        menu: ['Save to my list'],
      },
    },
    {
      name: 'member, item they booked',
      item: { link: LINK, status: 'booked', bookedBy: ME },
      props: { isMember: true, onSaveToList: vi.fn() },
      offer: {
        primary: { button: 'Unbook this item', text: 'Unbook' },
        linkButton: 'link',
        menu: ['Save to my list'],
      },
    },
    {
      name: 'member, item someone else booked',
      item: { link: LINK, status: 'booked' },
      props: { isMember: true, onSaveToList: vi.fn() },
      offer: {
        primary: { button: 'This item is already booked', text: 'Booked', disabled: true },
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
        primary: { button: 'Book this item', text: 'Book' },
        linkButton: 'none-provided',
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
      offer: { primary: { note: 'No link provided' }, linkButton: null, menu: ['Save to my list'] },
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
      offer: { primary: { note: 'No link provided' }, linkButton: null, menu: null },
    },
  ];

  it.each(cases)('$name', ({ item: overrides, props, offer }) => {
    render(<WishlistItem item={item(overrides)} onUpdate={vi.fn()} isAuthenticated {...props} />);
    const card = screen.getByRole('article');
    // The cover links to the product page too, so the row's links are the others.
    const rowLinks = within(card)
      .queryAllByRole('link', { name: PRODUCT_PAGE })
      .filter((a) => !a.classList.contains('aspect-square'));

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
      expect(within(card).getByText(offer.primary.note)).toBeInTheDocument();
    }

    if (offer.linkButton === 'link') {
      expect(rowLinks).toHaveLength(1);
      expect(rowLinks[0]).toHaveAttribute('href', LINK);
      expect(rowLinks[0]).toHaveAttribute('target', '_blank');
      expect(rowLinks[0]).toHaveAttribute('title', 'View product page');
      expect(rowLinks[0]).not.toHaveTextContent('View item');
    } else if (offer.linkButton === 'none-provided') {
      expect(rowLinks).toHaveLength(0);
      expect(within(card).getByRole('img', { name: 'No link provided' })).toHaveAttribute(
        'title',
        'No link provided'
      );
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
    if (props.isOwner) expect(within(card).queryByText(/book/i)).toBeNull();
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
    const book = screen.getByRole('button', { name: 'Book this item' });
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
    pick('Mark as available');
    expect(onUpdate).toHaveBeenCalledTimes(1);

    openMenu();
    const markAvailable = screen.getByRole('menuitem', { name: 'Mark as available' });
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

describe('WishlistItem — notes overlay', () => {
  // Regression: notes render OVER the image, not by replacing it with a gray box.
  it('regression: shows the note text while the image stays rendered', () => {
    render(
      <WishlistItem
        item={item({ notes: 'Size L, blue please', imageUrl: 'https://x/y.jpg' })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );
    // Toggle notes on.
    fireEvent.click(screen.getByRole('button', { name: /show notes/i }));
    expect(screen.getByText('Size L, blue please')).toBeInTheDocument();
    expect(screen.getByTestId('banner-image')).toBeInTheDocument();
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
    const cover = screen.getByRole('article').querySelector('.aspect-square') as HTMLElement;
    expect(cover.style.background).toBe(placeholderOf('item-1'));
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
  it('regression: falls back to the placeholder on a linked item, keeping the link', () => {
    render(
      <WishlistItem
        item={item({ imageUrl: IMAGE, link: 'https://shop.example/gift' })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );

    fireEvent.error(screen.getByTestId('banner-image'));

    // The cover is one of two product links on the card (the other is the link button).
    const link = screen
      .getAllByRole('link', { name: 'View Cool Gift product page' })
      .find((a) => a.classList.contains('aspect-square')) as HTMLElement;
    expect(link).toHaveAttribute('href', 'https://shop.example/gift');
    expect(screen.queryByTestId('banner-image')).toBeNull();
    expect(link.style.background).toBe(placeholderOf('item-1'));
  });

  it('keeps the placeholder while the notes are toggled over a broken image', () => {
    render(
      <WishlistItem
        item={item({ imageUrl: IMAGE, link: 'https://shop.example/gift', notes: 'Size L' })}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
      />
    );
    fireEvent.error(screen.getByTestId('banner-image'));

    fireEvent.click(screen.getByRole('button', { name: /show notes/i }));

    expect(screen.getByText('Size L')).toBeInTheDocument();
    expect(screen.queryByTestId('banner-image')).toBeNull();
    const cover = screen.getByText('Size L').closest('.aspect-square') as HTMLElement;
    expect(cover.style.background).toBe(placeholderOf('item-1'));
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
    expect(screen.getByText('USD 1.00')).toBeInTheDocument();
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
    const shown = item({ status: 'booked', bookedBy: 'someone-else' });
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
