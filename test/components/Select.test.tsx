// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import Select from '@/components/Select';

beforeEach(() => cleanup());

const options = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'price', label: 'Price' },
];

/** A Select on a page, outside any dialog, with a button after it. */
function SortPage() {
  const [value, setValue] = useState('newest');
  return (
    <>
      <Select value={value} onChange={setValue} options={options} ariaLabel="Sort by" />
      <button>After</button>
    </>
  );
}

const trigger = () => screen.getByRole('button', { name: 'Sort by' });
const option = (name: string) => screen.getByRole('option', { name });
const menu = () => screen.queryByRole('listbox');

async function openMenu() {
  const user = userEvent.setup();
  render(<SortPage />);
  await user.click(trigger());
  expect(menu()).toBeInTheDocument();
  return user;
}

describe('Select — keyboard focus', () => {
  // regression: choosing removed the focused option along with the menu, and
  // focus dropped to <body>.
  it('regression: hands focus back to the trigger when an option is chosen from the keyboard', async () => {
    const user = await openMenu();
    option('Oldest').focus();

    await user.keyboard('{Enter}');
    expect(menu()).toBeNull();
    expect(trigger()).toHaveTextContent('Oldest');
    expect(trigger()).toHaveFocus();
  });

  it('hands focus back to the trigger when Escape closes the menu from an option', async () => {
    const user = await openMenu();
    option('Price').focus();

    await user.keyboard('{Escape}');
    expect(menu()).toBeNull();
    expect(trigger()).toHaveTextContent('Newest');
    expect(trigger()).toHaveFocus();
  });

  it('closes the menu when focus moves on from an option, but not back to the trigger', async () => {
    const user = await openMenu();

    act(() => option('Oldest').focus());
    act(() => trigger().focus());
    expect(menu()).toBeInTheDocument();

    act(() => option('Oldest').focus());
    act(() => screen.getByRole('button', { name: 'After' }).focus());
    expect(menu()).toBeNull();
    expect(trigger()).toHaveTextContent('Newest');
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();

    // Focus leaving the trigger, rather than the menu, leaves it open.
    await user.click(trigger());
    act(() => screen.getByRole('button', { name: 'After' }).focus());
    expect(menu()).toBeInTheDocument();
  });

  it('leaves focus alone when the menu closes without it', async () => {
    const user = await openMenu();

    await user.click(screen.getByRole('button', { name: 'After' }));
    expect(menu()).toBeNull();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
  });

  // The menu only joins a dialog's Tab order; on a page the browser's own
  // order is left as it was.
  it('leaves Tab to the browser outside a dialog', async () => {
    const user = await openMenu();
    expect(trigger()).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    await user.tab();
    expect(option('Newest')).toHaveFocus();
  });
});

describe('Select — placeholder', () => {
  function Picker() {
    const [value, setValue] = useState('');
    return (
      <Select
        value={value}
        onChange={setValue}
        options={options}
        ariaLabel="Sort by"
        placeholder="Pick one"
      />
    );
  }

  it('shows the placeholder, muted, until an option is picked, then the option', async () => {
    const user = userEvent.setup();
    render(<Picker />);
    expect(trigger()).toHaveTextContent('Pick one');
    expect(screen.getByText('Pick one')).toHaveClass('text-muted-foreground');
    // The placeholder isn't an option of its own.
    await user.click(trigger());
    expect(screen.queryByRole('option', { name: 'Pick one' })).toBeNull();

    await user.click(option('Price'));
    expect(trigger()).toHaveTextContent('Price');
    expect(screen.queryByText('Pick one')).toBeNull();
  });

  it('shows nothing when no option matches and there is no placeholder', () => {
    render(<Select value="" onChange={() => {}} options={options} ariaLabel="Sort by" />);
    expect(trigger()).toHaveTextContent(/^$/);
  });
});
