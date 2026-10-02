// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
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

beforeEach(() => cleanup());

/** The field in a settings form, showing what the form would send. */
function Settings({ initial = null }: { initial?: Occasion | null }) {
  const [draft, setDraft] = useState<OccasionDraft>(occasionToDraft(initial));
  return (
    <>
      <OccasionField value={draft} onChange={setDraft} />
      <output data-testid="sent">{JSON.stringify(draftToOccasion(draft))}</output>
    </>
  );
}

const sent = () => JSON.parse(screen.getByTestId('sent').textContent ?? 'null');
const kindPicker = () => screen.getByRole('button', { name: 'Occasion' });
const dateInput = () => screen.queryByLabelText('Occasion date');
const yearly = () => screen.queryByRole('checkbox', { name: 'Repeats every year' });

async function pick(user: ReturnType<typeof userEvent.setup>, kind: string) {
  await user.click(kindPicker());
  await user.click(screen.getByRole('option', { name: kind }));
}

describe('OccasionField', () => {
  it('starts at None, with no date or yearly control, and sends no occasion', () => {
    render(<Settings />);
    expect(kindPicker()).toHaveTextContent('None');
    expect(dateInput()).toBeNull();
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

  it('sets an occasion: a kind, then its date, which is required', async () => {
    const user = userEvent.setup();
    render(<Settings />);

    await pick(user, 'Wedding');
    expect(dateInput()).toBeRequired();
    expect(dateInput()).toHaveValue('');

    fireEvent.change(dateInput()!, { target: { value: '2027-06-12' } });
    expect(sent()).toEqual({ kind: 'wedding', date: '2027-06-12', recurrence: null });
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

  it('toggles yearly recurrence on and off', async () => {
    const user = userEvent.setup();
    render(<Settings initial={{ kind: 'wedding', date: '2027-06-12', recurrence: null }} />);
    expect(yearly()).not.toBeChecked();

    await user.click(yearly()!);
    expect(sent()).toEqual({ kind: 'wedding', date: '2027-06-12', recurrence: 'yearly' });

    await user.click(yearly()!);
    expect(sent()).toEqual({ kind: 'wedding', date: '2027-06-12', recurrence: null });
  });

  // Viewers get the stored date, year included, so a yearly birthday entered
  // as a birth date would tell them the owner's age.
  it('says viewers see the date, and that a yearly one needs no birth year', async () => {
    const user = userEvent.setup();
    render(<Settings />);
    expect(screen.getByText(/They can see its date too\./)).toBeInTheDocument();
    expect(screen.queryByText(/the year you were born/)).toBeNull();

    await pick(user, 'Birthday');
    expect(screen.getByText(/doesn’t need the year you were born/)).toBeInTheDocument();
    await user.click(yearly()!);
    expect(screen.queryByText(/the year you were born/)).toBeNull();
  });

  it("keeps the owner's yearly choice when switching from one kind to another", async () => {
    const user = userEvent.setup();
    render(<Settings initial={{ kind: 'birthday', date: '1990-10-14', recurrence: 'yearly' }} />);

    await user.click(yearly()!);
    await pick(user, 'Wedding');
    expect(sent()).toEqual({ kind: 'wedding', date: '1990-10-14', recurrence: null });
  });

  it('clears the occasion when None is picked', async () => {
    const user = userEvent.setup();
    render(<Settings initial={{ kind: 'birthday', date: '1990-10-14', recurrence: 'yearly' }} />);
    expect(dateInput()).toHaveValue('1990-10-14');
    expect(yearly()).toBeChecked();

    await pick(user, 'None');
    expect(dateInput()).toBeNull();
    expect(yearly()).toBeNull();
    expect(sent()).toBeNull();
  });

  it('is disabled while the settings are saving', () => {
    render(
      <OccasionField
        value={{ kind: 'birthday', date: '1990-10-14', yearly: true }}
        onChange={() => {}}
        disabled
      />
    );
    expect(kindPicker()).toBeDisabled();
    expect(dateInput()).toBeDisabled();
    expect(yearly()).toBeDisabled();
  });
});
