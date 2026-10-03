// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import SegmentedControl from '@/components/SegmentedControl';

beforeEach(() => cleanup());

const OPTIONS = [
  { value: 'everyone', label: 'Public' },
  { value: 'friends', label: 'Friends' },
  { value: 'private', label: 'Invite only' },
] as const;
type Value = (typeof OPTIONS)[number]['value'];

function Harness({
  initial = 'everyone',
  onChange,
  disabled,
}: {
  initial?: Value;
  onChange?: (v: Value) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<Value>(initial);
  return (
    <>
      <button type="button">Before</button>
      <SegmentedControl
        ariaLabel="Visibility"
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
        options={OPTIONS}
        disabled={disabled}
      />
      <button type="button">After</button>
    </>
  );
}

const radio = (name: string) => screen.getByRole('radio', { name });

describe('SegmentedControl — semantics', () => {
  it('is a named radio group whose selected segment is checked', () => {
    render(<Harness initial="friends" />);
    expect(screen.getByRole('radiogroup', { name: 'Visibility' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(radio('Friends')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Public')).toHaveAttribute('aria-checked', 'false');
    expect(radio('Invite only')).toHaveAttribute('aria-checked', 'false');
  });

  it('can be named by a visible label and described by a helper', () => {
    render(
      <>
        <span id="label">Status</span>
        <p id="helper">Draft items are not visible to others</p>
        <SegmentedControl
          ariaLabelledBy="label"
          ariaDescribedBy="helper"
          value="draft"
          onChange={() => {}}
          options={[
            { value: 'published', label: 'Published' },
            { value: 'draft', label: 'Draft' },
          ]}
        />
      </>
    );
    const group = screen.getByRole('radiogroup', { name: 'Status' });
    expect(group).toHaveAccessibleDescription('Draft items are not visible to others');
  });

  it('picks a segment on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(radio('Invite only'));
    expect(onChange).toHaveBeenCalledWith('private');
    expect(radio('Invite only')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Public')).toHaveAttribute('aria-checked', 'false');
  });

  it('does not report a click on the segment already selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(radio('Public'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('sizes its segments sm 32px and md 36px (the default)', () => {
    const { rerender } = render(
      <SegmentedControl
        ariaLabel="G"
        value="a"
        onChange={() => {}}
        options={[{ value: 'a', label: 'A' }]}
      />
    );
    expect(radio('A')).toHaveClass('h-9');
    rerender(
      <SegmentedControl
        ariaLabel="G"
        size="sm"
        value="a"
        onChange={() => {}}
        options={[{ value: 'a', label: 'A' }]}
      />
    );
    expect(radio('A')).toHaveClass('h-8');
  });
});

describe('SegmentedControl — keyboard', () => {
  it('is one Tab stop, on the selected segment', async () => {
    const user = userEvent.setup();
    render(<Harness initial="friends" />);
    await user.click(screen.getByRole('button', { name: 'Before' }));
    await user.tab();
    expect(radio('Friends')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(radio('Friends')).toHaveFocus();
  });

  it('moves and selects with the arrow keys, wrapping at both ends', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    radio('Public').focus();

    await user.keyboard('{ArrowRight}');
    expect(radio('Friends')).toHaveFocus();
    expect(radio('Friends')).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowDown}');
    expect(radio('Invite only')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(radio('Public')).toHaveFocus();
    expect(radio('Public')).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(radio('Invite only')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(radio('Friends')).toHaveFocus();
    expect(onChange.mock.calls.map(([v]) => v)).toEqual([
      'friends',
      'private',
      'everyone',
      'private',
      'friends',
    ]);
  });

  it('jumps to the first and last segment with Home and End', async () => {
    const user = userEvent.setup();
    render(<Harness initial="friends" />);
    radio('Friends').focus();
    await user.keyboard('{End}');
    expect(radio('Invite only')).toHaveFocus();
    expect(radio('Invite only')).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Home}');
    expect(radio('Public')).toHaveFocus();
    expect(radio('Public')).toHaveAttribute('aria-checked', 'true');
  });

  it('leaves the tab order of a disabled group to the browser', () => {
    render(<Harness disabled />);
    for (const r of screen.getAllByRole('radio')) {
      expect(r).toBeDisabled();
      // A focus trap counts any `tabindex` as a stop, even on a disabled button.
      expect(r).not.toHaveAttribute('tabindex');
    }
  });
});
