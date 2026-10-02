// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import OccasionField from '@/components/OccasionField';
import {
  draftToOccasion,
  occasionToDraft,
  type Occasion,
  type OccasionDraft,
} from '@/lib/utils/occasion';

// The viewer's local date is Oct 2, 2026 throughout.
beforeEach(() => {
  cleanup();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 2, 12));
});

afterEach(() => {
  vi.useRealTimers();
});

/** The field in a settings form, showing what the form would send. */
function Settings({ initial = null }: { initial?: Occasion | null }) {
  const [draft, setDraft] = useState<OccasionDraft>(occasionToDraft(initial));
  return (
    <>
      <OccasionField value={draft} onChange={setDraft} saved={initial} />
      <output data-testid="sent">{JSON.stringify(draftToOccasion(draft))}</output>
    </>
  );
}

const sent = () => JSON.parse(screen.getByTestId('sent').textContent ?? 'null');
const field = () => screen.getByRole('group', { name: /Occasion/ });
const kindPicker = () => screen.getByRole('button', { name: 'Occasion' });
const monthPicker = () => screen.queryByRole('button', { name: 'Occasion month' });
const dayPicker = () => screen.queryByRole('button', { name: 'Occasion day' });
const dateInput = () => screen.queryByLabelText('Occasion date');
const yearly = () => screen.queryByRole('checkbox', { name: 'Repeats every year' });

type User = ReturnType<typeof userEvent.setup>;

async function choose(user: User, picker: HTMLElement, option: string) {
  await user.click(picker);
  await user.click(screen.getByRole('option', { name: option }));
}

const pick = (user: User, kind: string) => choose(user, kindPicker(), kind);

async function dayOptions(user: User) {
  await user.click(dayPicker()!);
  const days = screen.getAllByRole('option').map((o) => o.textContent);
  await user.keyboard('{Escape}');
  return days;
}

describe('OccasionField', () => {
  it('starts at None, with nothing else to fill in, and sends no occasion', () => {
    render(<Settings />);
    expect(kindPicker()).toHaveTextContent('None');
    expect(dateInput()).toBeNull();
    expect(monthPicker()).toBeNull();
    expect(yearly()).toBeNull();
    expect(sent()).toBeNull();
  });

  it('offers None and every kind', async () => {
    const user = userEvent.setup();
    render(<Settings />);
    await user.click(kindPicker());
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'None',
      'Birthday',
      'Holiday',
      'Wedding',
      'Other',
    ]);
  });

  it('asks a one-off for a full date, required and from today on', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await pick(user, 'Wedding');
    expect(yearly()).not.toBeChecked();
    expect(monthPicker()).toBeNull();
    expect(dayPicker()).toBeNull();
    expect(dateInput()).toBeRequired();
    expect(dateInput()).toHaveAttribute('min', '2026-10-02');
    expect(dateInput()).toHaveValue('');

    fireEvent.change(dateInput()!, { target: { value: '2027-06-12' } });
    expect(sent()).toEqual({ kind: 'wedding', date: '2027-06-12', recurrence: null });
  });

  it('asks a yearly one for a day and month only, with no year anywhere', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await pick(user, 'Birthday');
    expect(yearly()).toBeChecked();
    expect(dateInput()).toBeNull();
    expect(monthPicker()).toHaveTextContent('Month');
    expect(dayPicker()).toHaveTextContent('Day');

    await choose(user, monthPicker()!, 'October');
    await choose(user, dayPicker()!, '14');
    expect(monthPicker()).toHaveTextContent('October');
    expect(dayPicker()).toHaveTextContent('14');
    // Sent on the placeholder year, which the field itself never shows.
    expect(sent()).toEqual({ kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' });
    expect(field().innerHTML).not.toContain('2000');
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });

  it("offers only the chosen month's days, Feb 29 included, and keeps the day inside it", async () => {
    const user = userEvent.setup();
    render(<Settings initial={{ kind: 'birthday', date: '2000-01-31', recurrence: 'yearly' }} />);
    expect(await dayOptions(user)).toHaveLength(31);

    await choose(user, monthPicker()!, 'February');
    expect(await dayOptions(user)).toHaveLength(29);
    expect(dayPicker()).toHaveTextContent('29');
    expect(sent().date).toBe('2000-02-29');

    await choose(user, monthPicker()!, 'April');
    expect(await dayOptions(user)).toHaveLength(30);
    expect(sent().date).toBe('2000-04-29');
  });

  it('shows a saved yearly occasion as its day and month when the settings are reopened', () => {
    render(<Settings initial={{ kind: 'holiday', date: '2000-12-25', recurrence: 'yearly' }} />);
    expect(yearly()).toBeChecked();
    expect(monthPicker()).toHaveTextContent('December');
    expect(dayPicker()).toHaveTextContent('25');
    expect(field().innerHTML).not.toContain('2000');
  });

  it('keeps the day and month when switching between yearly and one-off', async () => {
    const user = userEvent.setup();
    render(<Settings initial={{ kind: 'wedding', date: '2027-06-12', recurrence: null }} />);

    await user.click(yearly()!);
    expect(monthPicker()).toHaveTextContent('June');
    expect(dayPicker()).toHaveTextContent('12');
    expect(sent()).toEqual({ kind: 'wedding', date: '2000-06-12', recurrence: 'yearly' });

    // Back to a one-off on the same day: the date it had, year and all.
    await user.click(yearly()!);
    expect(dateInput()).toHaveValue('2027-06-12');
    expect(sent()).toEqual({ kind: 'wedding', date: '2027-06-12', recurrence: null });

    // A new day and month, made a one-off: the next time it comes round.
    await user.click(yearly()!);
    await choose(user, monthPicker()!, 'October');
    await choose(user, dayPicker()!, '14');
    await user.click(yearly()!);
    expect(dateInput()).toHaveValue('2026-10-14');
    await user.click(yearly()!);
    await choose(user, monthPicker()!, 'March');
    await user.click(yearly()!);
    expect(dateInput()).toHaveValue('2027-03-14');
  });

  it('lets a saved one-off that has passed be saved as it is, but a new date must be from today', () => {
    render(<Settings initial={{ kind: 'wedding', date: '2026-06-12', recurrence: null }} />);
    expect(dateInput()).toHaveValue('2026-06-12');
    expect(dateInput()).not.toHaveAttribute('min');

    fireEvent.change(dateInput()!, { target: { value: '2026-11-01' } });
    expect(dateInput()).toHaveAttribute('min', '2026-10-02');
  });

  it('starts "Repeats every year" ticked for a birthday or a holiday, unticked otherwise', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await pick(user, 'Birthday');
    expect(yearly()).toBeChecked();
    await pick(user, 'None');
    await pick(user, 'Holiday');
    expect(yearly()).toBeChecked();
    await pick(user, 'None');
    await pick(user, 'Other');
    expect(yearly()).not.toBeChecked();
  });

  it("keeps the owner's yearly choice and the date when switching from one kind to another", async () => {
    const user = userEvent.setup();
    render(<Settings initial={{ kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' }} />);

    await pick(user, 'Holiday');
    expect(sent()).toEqual({ kind: 'holiday', date: '2000-10-14', recurrence: 'yearly' });

    await user.click(yearly()!);
    await pick(user, 'Wedding');
    expect(sent()).toEqual({ kind: 'wedding', date: '2026-10-14', recurrence: null });
  });

  it('clears the occasion when None is picked', async () => {
    const user = userEvent.setup();
    render(<Settings initial={{ kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' }} />);
    expect(yearly()).toBeChecked();

    await pick(user, 'None');
    expect(monthPicker()).toBeNull();
    expect(dayPicker()).toBeNull();
    expect(yearly()).toBeNull();
    expect(sent()).toBeNull();
  });

  it('says where the occasion shows, and nothing about years', () => {
    render(<Settings initial={{ kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' }} />);
    expect(
      screen.getByText(
        "Shown next to the list's name, with a countdown, to everyone who can see the list."
      )
    ).toBeInTheDocument();
    expect(field()).not.toHaveTextContent(/year you were born|see its date/);
  });

  it('is disabled while the settings are saving', () => {
    const { rerender } = render(
      <OccasionField
        value={{ kind: 'birthday', yearly: true, date: '', month: '10', day: '14' }}
        onChange={() => {}}
        disabled
      />
    );
    expect(kindPicker()).toBeDisabled();
    expect(monthPicker()).toBeDisabled();
    expect(dayPicker()).toBeDisabled();
    expect(yearly()).toBeDisabled();

    rerender(
      <OccasionField
        value={{ kind: 'wedding', yearly: false, date: '2027-06-12', month: '06', day: '12' }}
        onChange={() => {}}
        disabled
      />
    );
    expect(dateInput()).toBeDisabled();
  });
});
