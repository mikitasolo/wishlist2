// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ImageUpload pulls in react-easy-crop; stub it out.
vi.mock('@/components/ImageUpload', () => ({
  default: () => <div data-testid="image-upload" />,
}));

import ItemForm, { type ItemFormData } from '@/components/ItemForm';

const filled: ItemFormData = {
  name: 'Existing',
  imageUrl: '',
  price: '',
  currency: 'USD',
  link: '',
  notes: '',
  mostWanted: false,
  isDraft: false,
};

beforeEach(() => cleanup());

describe('ItemForm — status toggle visibility', () => {
  it('shows the Published/Draft toggle when creating', () => {
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="create" />);
    expect(screen.getByRole('button', { name: /published/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /draft/i })).toBeInTheDocument();
  });

  it('shows the toggle when reviewing a proposal', () => {
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="review" initialData={filled} />);
    expect(screen.getByRole('button', { name: /published/i })).toBeInTheDocument();
  });

  it('hides the toggle in propose mode', () => {
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="propose" />);
    expect(screen.queryByRole('button', { name: /published/i })).toBeNull();
  });

  // Regression: editing an existing item must NOT expose a status toggle — sending
  // status on a content edit used to clobber a booking (owners can't see bookings).
  it('regression: hides the status toggle when editing', () => {
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="edit" initialData={filled} />);
    expect(screen.queryByRole('button', { name: /published/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^draft$/i })).toBeNull();
  });
});

describe('ItemForm — create submission', () => {
  it('submits status "available" when Published, "draft" when toggled', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="create" />);

    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Gift' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Gift', status: 'available' }),
        expect.anything()
      )
    );

    onSubmit.mockClear();
    rerender(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="create" />);
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Draft gift' } });
    fireEvent.click(screen.getByRole('button', { name: /^draft$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'draft' }),
        expect.anything()
      )
    );
  });
});

describe('ItemForm — what an edit changed', () => {
  const saveEdit = () => fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
  const changesSent = (onSubmit: ReturnType<typeof vi.fn>, call: number) =>
    onSubmit.mock.calls[call][1];

  it('hands over the changes from the item the form was filled from', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="edit" initialData={filled} />);

    fireEvent.change(screen.getByLabelText(/^notes$/i), { target: { value: 'Size M' } });
    saveEdit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(changesSent(onSubmit, 0)).toEqual({ notes: 'Size M' });
  });

  it('still counts the changes of a failed save on the next one', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('Network error'));
    onSubmit.mockResolvedValue(undefined);
    render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="edit" initialData={filled} />);

    fireEvent.change(screen.getByLabelText(/^notes$/i), { target: { value: 'Size M' } });
    saveEdit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText(/^notes$/i)).toBeEnabled());

    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Renamed' } });
    saveEdit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(changesSent(onSubmit, 1)).toEqual({ name: 'Renamed', notes: 'Size M' });
    consoleError.mockRestore();
  });

  it('counts the next changes from what a successful save stored', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="edit" initialData={filled} />);

    fireEvent.change(screen.getByLabelText(/^notes$/i), { target: { value: 'Size M' } });
    saveEdit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText(/^notes$/i)).toBeEnabled());

    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Renamed' } });
    saveEdit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(changesSent(onSubmit, 1)).toEqual({ name: 'Renamed' });
  });
});

// The currency picker's trigger is a button labelled with the selected code.
const currencyButton = (code: string) => screen.getByRole('button', { name: code });
const pickCurrency = (from: string, name: RegExp) => {
  fireEvent.click(currencyButton(from));
  fireEvent.click(screen.getByRole('button', { name }));
};

describe('ItemForm — default currency', () => {
  // regression: the create/propose form hardcoded a 'USD' default
  // (DEFAULT_ITEM_FORM_DATA.currency) and ignored the wishlist's currency, so
  // someone with a PLN list had to switch the currency on every new item.
  it('regression: a new item starts on the given default currency, not USD', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="create" defaultCurrency="PLN" />);

    expect(currencyButton('PLN')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'USD' })).toBeNull();

    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Gift' } });
    fireEvent.change(screen.getByLabelText(/^price$/i), { target: { value: '12.50' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    // Shown uppercase, stored lowercase to match Item.price.currency.
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ price: { value: 1250, currency: 'pln' } }),
        expect.anything()
      )
    );
  });

  it('falls back to USD when no default currency is given', () => {
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="create" />);
    expect(currencyButton('USD')).toBeInTheDocument();
  });

  it('resets to the default currency (not USD) after a successful create', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="create" defaultCurrency="PLN" />);

    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Gift' } });
    pickCurrency('PLN', /EUR\s*Euro/);
    expect(currencyButton('EUR')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    await waitFor(() => expect(currencyButton('PLN')).toBeInTheDocument());
  });

  it('does not count the prefilled currency as an unsaved change', () => {
    const onFormChange = vi.fn();
    render(
      <ItemForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        mode="create"
        defaultCurrency="PLN"
        onFormChange={onFormChange}
      />
    );
    expect(onFormChange).toHaveBeenCalled();
    expect(onFormChange).not.toHaveBeenCalledWith(true);

    // Picking a different currency is a real edit.
    pickCurrency('PLN', /EUR\s*Euro/);
    expect(onFormChange).toHaveBeenLastCalledWith(true);
  });

  it("editing keeps the item's own currency, whatever the default", () => {
    render(
      <ItemForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        mode="edit"
        initialData={{ ...filled, price: '10.00', currency: 'EUR' }}
        defaultCurrency="PLN"
      />
    );
    expect(currencyButton('EUR')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'PLN' })).toBeNull();
  });
});

describe('ItemForm — most wanted', () => {
  const mostWantedSwitch = () => screen.queryByRole('switch', { name: /most wanted/i });

  it('offers the switch when creating, editing and reviewing, but not proposing', () => {
    for (const mode of ['create', 'edit', 'review'] as const) {
      const { unmount } = render(
        <ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode={mode} initialData={filled} />
      );
      expect(mostWantedSwitch()).toBeInTheDocument();
      unmount();
    }
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="propose" />);
    expect(mostWantedSwitch()).toBeNull();
  });

  it('submits false by default and true once switched on', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="create" />);

    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Plain' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ mostWanted: false }),
        expect.anything()
      )
    );

    onSubmit.mockClear();
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Bike' } });
    fireEvent.click(mostWantedSwitch()!);
    expect(mostWantedSwitch()).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Bike', mostWanted: true }),
        expect.anything()
      )
    );
  });

  it("starts from the item's own flag when editing", () => {
    render(
      <ItemForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        mode="edit"
        initialData={{ ...filled, mostWanted: true }}
      />
    );
    expect(mostWantedSwitch()).toHaveAttribute('aria-checked', 'true');
  });

  it('leaves mostWanted out of a proposal', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="propose" />);
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Idea' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].mostWanted).toBeUndefined();
  });
});
