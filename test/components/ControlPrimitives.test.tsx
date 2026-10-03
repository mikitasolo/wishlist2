// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import Field from '@/components/Field';
import Input from '@/components/Input';
import Textarea from '@/components/Textarea';
import SearchField from '@/components/SearchField';
import { buttonClassName, iconButtonClassName } from '@/components/buttonStyles';

beforeEach(() => cleanup());

describe('Button', () => {
  it.each([
    ['sm', 'h-9', 'text-sm', 'px-3.5'],
    ['md', 'h-10', 'text-sm', 'px-4'],
    ['lg', 'h-11', 'text-[15px]', 'px-5'],
    ['xl', 'h-12', 'text-base', 'px-6'],
  ] as const)('is sized %s from the scale', (size, height, text, padding) => {
    render(<Button size={size}>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass(height, text, padding);
  });

  it('is lg (44px) by default, so a form button matches its fields', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('h-11', 'rounded-xl');
  });

  it('is round as a pill', () => {
    render(
      <Button shape="pill" size="sm">
        Share
      </Button>
    );
    const button = screen.getByRole('button', { name: 'Share' });
    expect(button).toHaveClass('rounded-full', 'h-9');
    expect(button).not.toHaveClass('rounded-xl');
  });

  it('draws its icon at the size that goes with its own', () => {
    const { container, rerender } = render(
      <Button size="sm" icon="link">
        Share
      </Button>
    );
    expect(container.querySelector('svg')).toHaveAttribute('width', '16');
    rerender(
      <Button size="lg" icon="link">
        Share
      </Button>
    );
    expect(container.querySelector('svg')).toHaveAttribute('width', '18');
  });

  it("doesn't submit the form it's in unless it says it's the submit button", async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Cancel</Button>
        <IconButton icon="close" label="Clear" />
        <Button type="submit">Save</Button>
      </form>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("is disabled, with the one disabled look, and doesn't fire", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveClass('disabled:opacity-50');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps the glow and the lighter hover to the primary variant', () => {
    const primary = buttonClassName();
    expect(primary).toContain('hover:bg-primary-500');
    expect(primary).toMatch(/shadow-\[0_8px_22px/);
    for (const variant of ['secondary', 'soft', 'danger', 'destructive', 'ghost'] as const) {
      expect(buttonClassName({ variant })).not.toMatch(/shadow-\[0_8px_22px/);
    }
  });
});

describe('IconButton', () => {
  it('is named by its label', async () => {
    const onClick = vi.fn();
    render(<IconButton icon="close" label="Close dialog" onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is 32px inline by default, and square at the row height otherwise, with an 18px icon', () => {
    const { container, rerender } = render(<IconButton icon="close" label="Clear" />);
    expect(screen.getByRole('button')).toHaveClass('h-8', 'w-8');
    expect(container.querySelector('svg')).toHaveAttribute('width', '18');
    rerender(<IconButton icon="plus" label="New wishlist" size="md" shape="pill" />);
    expect(screen.getByRole('button')).toHaveClass('h-10', 'w-10', 'rounded-full');
    expect(container.querySelector('svg')).toHaveAttribute('width', '18');
  });

  it('requires an accessible name in its type', () => {
    // @ts-expect-error: `label` is required.
    render(<IconButton icon="close" />);
    // @ts-expect-error: an aria-label is no substitute; the label is the name.
    render(<IconButton icon="close" label="Close" aria-label="Other" />);
    expect(iconButtonClassName({ size: 'sm' })).toContain('h-9 w-9');
  });
});

describe('Field', () => {
  it('names its input by its label', () => {
    render(
      <Field label="Wishlist name">
        <Input />
      </Field>
    );
    expect(screen.getByRole('textbox', { name: 'Wishlist name' })).toBeInTheDocument();
  });

  it('keeps the id it is given, for the label and the control', () => {
    render(
      <Field label="Notes" id="notes">
        <Textarea />
      </Field>
    );
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveAttribute('id', 'notes');
  });

  it('describes its control by its helper text, and is valid without an error', () => {
    render(
      <Field label="Link" helper="Lowercase letters, numbers, and hyphens.">
        <Input />
      </Field>
    );
    const input = screen.getByRole('textbox', { name: 'Link' });
    expect(input).toHaveAccessibleDescription('Lowercase letters, numbers, and hyphens.');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('describes its control by its error too, and marks it invalid', () => {
    render(
      <Field label="Price" id="price" helper="In the list's currency." error="Enter a price">
        <Input />
      </Field>
    );
    const input = screen.getByRole('textbox', { name: 'Price' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription("In the list's currency. Enter a price");
    expect(screen.getByText('Enter a price')).toHaveAttribute('id', 'price-error');
  });

  it("keeps a description the control has of its own, beside the field's", () => {
    render(
      <>
        <p id="extra">Shown to everyone.</p>
        <Field label="Name" helper="Up to 100 characters.">
          <Input aria-describedby="extra" />
        </Field>
      </>
    );
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAccessibleDescription(
      'Shown to everyone. Up to 100 characters.'
    );
  });

  it('reaches an input with something beside it, deep inside', () => {
    render(
      <Field label="Username" helper="3–20 characters." error="Taken">
        <div>
          <Input leading="@" trailing={<span>Checking…</span>} />
        </div>
      </Field>
    );
    const input = screen.getByRole('textbox', { name: 'Username' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('3–20 characters. Taken');
    // The box around it draws the border and the focus ring, not the input.
    expect(input).not.toHaveClass('field-focus');
    expect(input.parentElement).toHaveClass('field-focus', 'h-11', 'border-border-strong');
  });
});

describe('Input', () => {
  it('is lg (44px) by default and sm (36px) in a toolbar', () => {
    render(
      <>
        <Input aria-label="Form" />
        <Input aria-label="Toolbar" size="sm" />
      </>
    );
    expect(screen.getByRole('textbox', { name: 'Form' })).toHaveClass(
      'h-11',
      'rounded-xl',
      'border-border-strong',
      'bg-surface',
      'px-3.5',
      'text-[15px]',
      'field-focus',
      'outline-hidden'
    );
    expect(screen.getByRole('textbox', { name: 'Toolbar' })).toHaveClass('h-9', 'text-sm');
  });
});

describe('SearchField', () => {
  function Search() {
    const [value, setValue] = useState('');
    return (
      <SearchField
        aria-label="Search items"
        size="sm"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onClear={() => setValue('')}
      />
    );
  }

  it('offers a clear button only while it has text, which empties it', async () => {
    render(<Search />);
    const input = screen.getByRole('textbox', { name: 'Search items' });
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
    await userEvent.type(input, 'lamp');
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  });

  it('keeps focus in the field while the clear button comes and goes', async () => {
    render(<Search />);
    const input = screen.getByRole('textbox', { name: 'Search items' });
    await userEvent.type(input, 'l');
    expect(input).toHaveFocus();
    expect(input.parentElement).toHaveClass('h-9', 'field-focus');
  });

  // regression: the clear button unmounted with focus on it once the field was
  // empty, which dropped focus to <body> and sent the next Tab to the page's top.
  it('puts focus back in the field when its clear button empties it', async () => {
    render(<Search />);
    const input = screen.getByRole('textbox', { name: 'Search items' });
    await userEvent.type(input, 'lamp');
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Clear search' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });
});
