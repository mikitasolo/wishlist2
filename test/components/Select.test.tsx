// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
