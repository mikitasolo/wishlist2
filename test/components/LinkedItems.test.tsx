// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { ApiItem } from '@/types/api';

// Linked items (WIS-29): the card's "Goes with" chips (2, then "+N more", the
// sheet showing all), and the dialog's picker held at the cap.

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }),
}));
vi.mock('@/components/ImageUpload', () => ({ default: () => null }));
vi.mock('@/components/BannerImage', () => ({
  default: ({ alt }: { alt?: string }) => <img alt={alt ?? ''} />,
}));

import WishlistItem from '@/components/WishlistItem';
import EditItemModal from '@/components/EditItemModal';
import ItemLinkPicker, { linkPickerNote, type LinkOption } from '@/components/ItemLinkPicker';
import { ITEM_LINKS_MAX, type ItemRef } from '@/lib/utils/itemLinks';

const refs = (n: number): ItemRef[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Partner ${i}` }));

const item: ApiItem = {
  _id: 'item-1',
  wishlist: 'w1',
  name: 'Drill',
  status: 'available',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

beforeEach(() => {
  cleanup();
  // useBodyScrollLock restores the scroll position on close; jsdom lacks it.
  window.scrollTo = vi.fn() as never;
});

describe('the card’s "Goes with" chips', () => {
  it('shows the first 2, then "+N more", which opens the sheet with them all', () => {
    const onShowItem = vi.fn();
    render(
      <WishlistItem
        item={item}
        onUpdate={vi.fn()}
        isAuthenticated
        isMember
        related={refs(5)}
        onShowItem={onShowItem}
      />
    );

    const card = screen.getByRole('article', { name: 'Item: Drill' });
    expect(within(card).getByRole('button', { name: 'Go to Partner 0' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Go to Partner 1' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Go to Partner 2' })).toBeNull();
    const more = within(card).getByRole('button', { name: 'Goes with 3 more items, show all' });
    expect(more).toHaveTextContent('+3 more');

    fireEvent.click(more);
    const sheet = screen.getByRole('dialog', { name: 'Drill' });
    for (let i = 0; i < 5; i++) {
      expect(within(sheet).getByRole('button', { name: `Go to Partner ${i}` })).toBeInTheDocument();
    }

    // A chip in the sheet closes it and goes to its item.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Go to Partner 4' }));
    expect(onShowItem).toHaveBeenCalledWith('p4');
    expect(screen.queryByRole('dialog', { name: 'Drill' })).toBeNull();
  });

  it('says "1 more item" for one left over, and nothing with no partners', () => {
    const { rerender } = render(
      <WishlistItem item={item} onUpdate={vi.fn()} isAuthenticated isMember related={refs(3)} />
    );
    expect(
      screen.getByRole('button', { name: 'Goes with 1 more item, show all' })
    ).toBeInTheDocument();

    rerender(<WishlistItem item={item} onUpdate={vi.fn()} isAuthenticated isMember related={[]} />);
    expect(screen.queryByText('Goes with')).toBeNull();
  });

  it('goes to a partner from a card chip', () => {
    const onShowItem = vi.fn();
    render(
      <WishlistItem
        item={item}
        onUpdate={vi.fn()}
        isAuthenticated
        isOwner
        related={refs(1)}
        onShowItem={onShowItem}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go to Partner 0' }));
    expect(onShowItem).toHaveBeenCalledWith('p0');
  });
});

function Picker({ options, start = [] }: { options: LinkOption[]; start?: string[] }) {
  const [selected, setSelected] = useState(start);
  return <ItemLinkPicker options={options} selected={selected} onChange={setSelected} />;
}

describe('the dialog’s "Goes with" picker', () => {
  it('holds at the cap: the rest are disabled and the note says why, until one is unticked', () => {
    const options = refs(ITEM_LINKS_MAX + 2);
    render(
      <Picker options={options} start={options.slice(0, ITEM_LINKS_MAX - 1).map((o) => o.id)} />
    );
    const group = screen.getByRole('group', { name: 'Goes with' });
    expect(group).toHaveAccessibleDescription(linkPickerNote(ITEM_LINKS_MAX - 1));

    fireEvent.click(screen.getByRole('checkbox', { name: `Partner ${ITEM_LINKS_MAX - 1}` }));

    expect(group).toHaveAccessibleDescription(
      `That's ${ITEM_LINKS_MAX}, the most an item can go with`
    );
    const last = screen.getByRole('checkbox', { name: `Partner ${ITEM_LINKS_MAX + 1}` });
    expect(last).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Partner 0' })).toBeEnabled();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Partner 0' }));
    expect(last).toBeEnabled();
    fireEvent.click(last);
    expect(last).toBeChecked();
  });
});

describe('the edit dialog’s links', () => {
  it('sends only the links added and removed, and nothing when they’re put back', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <EditItemModal
        isOpen
        onClose={onClose}
        onSave={onSave}
        item={{ ...item, relatedItems: [{ id: 'p0', name: 'Partner 0' }] }}
        wishlistCurrency="USD"
        userCurrency="USD"
        linkOptions={refs(3)}
      />
    );

    expect(screen.getByRole('checkbox', { name: 'Partner 0' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Partner 0' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Partner 2' }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ linkItems: ['p2'], unlinkItems: ['p0'] });
  });

  it('offers no picker without options (a proposal, a non-owner)', () => {
    render(
      <EditItemModal
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        item={item}
        wishlistCurrency="USD"
        userCurrency="USD"
      />
    );
    expect(screen.queryByRole('group', { name: 'Goes with' })).toBeNull();
  });
});

describe('searching the "Goes with" picker', () => {
  const many = () => refs(8).map((r, i) => ({ ...r, name: i === 3 ? 'Blue Drill' : r.name }));

  it('filters by name, trimmed and case-insensitive, says when nothing matches, and clears', () => {
    render(<Picker options={many()} />);
    const search = screen.getByRole('textbox', { name: 'Search items to link' });
    fireEvent.change(search, { target: { value: '  blue ' } });
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByRole('checkbox', { name: 'Blue Drill' })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByText('No items match')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(8);
    expect(screen.queryByText('No items match')).toBeNull();
  });

  it('pins ticked items first and keeps them while the search hides the rest', () => {
    render(<Picker options={many()} start={['p5']} />);
    expect(screen.getAllByRole('checkbox')[0]).toHaveAccessibleName('Partner 5');
    fireEvent.change(screen.getByRole('textbox', { name: 'Search items to link' }), {
      target: { value: 'blue' },
    });
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toHaveAccessibleName('Partner 5');
    expect(boxes[1]).toHaveAccessibleName('Blue Drill');
    expect(screen.getByRole('checkbox', { name: 'Partner 5' })).toBeChecked();
    expect(screen.queryByText('No items match')).toBeNull();
    // regression: a ticked match on screen is not "no match"
    fireEvent.change(screen.getByRole('textbox', { name: 'Search items to link' }), {
      target: { value: 'partner 5' },
    });
    expect(screen.queryByText('No items match')).toBeNull();
  });

  it('counts N of 10 and disables the unticked rows at the cap, even while searching', () => {
    const options = refs(12);
    render(<Picker options={options} start={options.slice(0, 9).map((o) => o.id)} />);
    expect(screen.getByText('9 of 10')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Partner 9' }));
    expect(screen.getByText('10 of 10')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search items to link' }), {
      target: { value: 'partner 1' },
    });
    expect(screen.getByRole('checkbox', { name: 'Partner 11' })).toBeDisabled();
  });

  it('shows the placeholder initial without an image, and the image with one', () => {
    const { container } = render(
      <Picker
        options={[
          { id: 'a', name: 'Alpha', imageUrl: null },
          { id: 'b', name: 'Beta', imageUrl: 'https://example.com/b.jpg' },
        ]}
      />
    );
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByText('B')).toBeNull();
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('offers no search for a handful of items', () => {
    render(<Picker options={refs(6)} />);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('does not submit the dialog on Enter in the search', () => {
    render(<Picker options={many()} />);
    expect(
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search items to link' }), {
        key: 'Enter',
      })
    ).toBe(false);
  });
});
