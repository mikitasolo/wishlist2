// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import MultiSelectDropdown from '@/components/MultiSelectDropdown';

beforeEach(() => cleanup());

const lists = [
  { value: 'w1', label: 'Birthday' },
  { value: 'w2', label: 'Wedding' },
];

/** The list filter on Items: the plain rule, a visible label and an extra switch. */
function ListFilter({ onArchived = vi.fn() }: { onArchived?: (checked: boolean) => void }) {
  const [selected, setSelected] = useState(['w1', 'w2']);
  return (
    <MultiSelectDropdown
      label="List"
      options={lists}
      selected={selected}
      onChange={setSelected}
      allLabel="All lists"
      extraToggle={{ label: 'Include archived', checked: false, onChange: onArchived }}
    />
  );
}

const box = (name: string) => screen.getByRole('checkbox', { name });

describe('MultiSelectDropdown — the plain rule', () => {
  it('says what is picked on the trigger, and opens a checkbox list under an All row', async () => {
    const user = userEvent.setup();
    render(<ListFilter />);
    const trigger = screen.getByRole('button', { name: 'All lists' });
    expect(screen.getByText('List:')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();

    await user.click(trigger);
    expect(screen.getAllByRole('checkbox').map((el) => el.closest('label')!.textContent)).toEqual([
      'All lists',
      'Birthday',
      'Wedding',
      'Include archived',
    ]);
    expect(box('All lists')).toBeChecked();
    expect(box('Birthday')).toBeChecked();
  });

  it('ticks and unticks a row, and All selects everything or nothing', async () => {
    const user = userEvent.setup();
    render(<ListFilter />);
    await user.click(screen.getByRole('button', { name: 'All lists' }));

    await user.click(box('Wedding'));
    expect(box('Wedding')).not.toBeChecked();
    expect(box('All lists')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Birthday' })).toBeInTheDocument();

    await user.click(box('Birthday'));
    expect(screen.getByRole('button', { name: 'None selected' })).toBeInTheDocument();

    await user.click(box('All lists'));
    expect(box('Birthday')).toBeChecked();
    expect(box('Wedding')).toBeChecked();
    await user.click(box('All lists'));
    expect(screen.getByRole('button', { name: 'None selected' })).toBeInTheDocument();
  });

  it('hands its extra switch its own change, apart from the options', async () => {
    const onArchived = vi.fn();
    const user = userEvent.setup();
    render(<ListFilter onArchived={onArchived} />);
    await user.click(screen.getByRole('button', { name: 'All lists' }));
    await user.click(box('Include archived'));
    expect(onArchived).toHaveBeenCalledExactlyOnceWith(true);
    expect(box('Birthday')).toBeChecked();
  });

  it('closes on a click outside', async () => {
    const user = userEvent.setup();
    render(
      <>
        <ListFilter />
        <button>Outside</button>
      </>
    );
    await user.click(screen.getByRole('button', { name: 'All lists' }));
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  // regression: the checkboxes' `text-accent rounded border-border-strong`
  // does nothing to a native checkbox, so they showed in the browser's colour.
  it('regression: colours its checkboxes with the accent', async () => {
    const user = userEvent.setup();
    render(<ListFilter />);
    await user.click(screen.getByRole('button', { name: 'All lists' }));
    for (const el of screen.getAllByRole('checkbox')) expect(el).toHaveClass('accent-primary-600');
  });
});
