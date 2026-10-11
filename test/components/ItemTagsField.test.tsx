// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ImageUpload pulls in react-easy-crop; stub it out.
vi.mock('@/components/ImageUpload', () => ({
  default: () => <div data-testid="image-upload" />,
}));

import ItemForm from './ItemFormWithFooter';
import type { ItemFormData } from '@/lib/utils/itemForm';
import TagChips from '@/components/TagChips';
import { ITEM_TAGS_MAX, LIST_TAGS_MAX } from '@/lib/utils/itemTags';

// Item tags in the owner's item form (WIS-385): the list's tags as toggles, a
// field for a new one, never in a proposal.

beforeEach(() => cleanup());

const tagInput = () => screen.getByRole('textbox', { name: 'New tag' });

function typeTag(value: string) {
  fireEvent.change(tagInput(), { target: { value } });
  fireEvent.keyDown(tagInput(), { key: 'Enter' });
}

describe('ItemForm — tags', () => {
  it('adds a typed tag with Enter, without submitting, and sends it with the new item', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="create" tagOptions={['Books']} />
    );
    fireEvent.change(screen.getByLabelText(/name/i, { selector: 'input' }), {
      target: { value: 'Pan' },
    });

    typeTag('Kitchen');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Kitchen', pressed: true })).toBeInTheDocument();
    // The list's own tag is offered, off.
    fireEvent.click(screen.getByRole('button', { name: 'Books', pressed: false }));

    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ['Kitchen', 'Books'] }),
        expect.anything()
      )
    );
  });

  it('marks picked tags with a × and takes one off the item when tapped, sending the change', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const item: ItemFormData = {
      name: 'Pan',
      price: '',
      currency: 'USD',
      link: '',
      imageUrl: '',
      notes: '',
      mostWanted: false,
      tags: ['Books', 'Kitchen'],
      isDraft: false,
      relatedItems: [],
    };
    render(
      <ItemForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        mode="edit"
        initialData={item}
        tagOptions={['Books', 'Kitchen']}
      />
    );
    const books = screen.getByRole('button', { name: 'Books', pressed: true });
    // The × is decoration: the name stays the tag's.
    expect(books.querySelector('svg')).not.toBeNull();

    fireEvent.click(books);
    expect(
      screen.getByRole('button', { name: 'Books', pressed: false }).querySelector('svg')
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][1]).toEqual({ tags: ['Kitchen'] });
  });

  it('takes the list’s spelling of a tag typed in another case', () => {
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="create" tagOptions={['Books']} />);
    typeTag('BOOKS');
    expect(screen.getByRole('button', { name: 'Books', pressed: true })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'BOOKS' })).toBeNull();
  });

  it('stops at the most an item can have', () => {
    const options = Array.from({ length: ITEM_TAGS_MAX + 1 }, (_, i) => `T${i + 1}`);
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="create" tagOptions={options} />);
    for (const tag of options.slice(0, ITEM_TAGS_MAX)) {
      fireEvent.click(screen.getByRole('button', { name: tag }));
    }
    expect(screen.getByRole('button', { name: options[ITEM_TAGS_MAX] })).toBeDisabled();
    expect(tagInput()).toBeDisabled();
    expect(screen.getByText(/the most an item can have/)).toBeInTheDocument();
  });

  it('refuses a new tag on a list that has all it can, and points to the ones it has', () => {
    const options = Array.from({ length: LIST_TAGS_MAX }, (_, i) => `T${i + 1}`);
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="create" tagOptions={options} />);
    typeTag('Extra');
    expect(screen.getByText(/the most it can have/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Extra' })).toBeNull();
  });

  it('offers no tags in a proposal, or without the list’s tags (a copy)', () => {
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="propose" tagOptions={['A']} />);
    expect(screen.queryByRole('textbox', { name: 'New tag' })).toBeNull();
    cleanup();
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="create" />);
    expect(screen.queryByRole('textbox', { name: 'New tag' })).toBeNull();
  });
});

describe('TagChips', () => {
  it('toggles tags, shows which are on, and carries no counts', () => {
    const onToggle = vi.fn();
    render(<TagChips tags={['Books', 'Kitchen']} picked={['books']} onToggle={onToggle} />);
    const books = screen.getByRole('button', { name: 'Books' });
    expect(books).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Kitchen' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.getByRole('group', { name: 'Filter by tag' }).textContent).not.toMatch(/\d/);
    fireEvent.click(screen.getByRole('button', { name: 'Kitchen' }));
    expect(onToggle).toHaveBeenCalledWith('Kitchen');
  });
});
