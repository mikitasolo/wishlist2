// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ImageUpload pulls in react-easy-crop; stub it out.
vi.mock('@/components/ImageUpload', () => ({
  default: () => <div data-testid="image-upload" />,
}));

import AddItemModal from '@/components/AddItemModal';
import ProposeItemModal from '@/components/ProposeItemModal';

type Currencies = {
  wishlistCurrency: string | null | undefined;
  userCurrency: string | null | undefined;
};

// Both "new item" modals get the same currency default; run every case on each.
const modals = [
  {
    name: 'AddItemModal',
    submitLabel: /^add item$/i,
    renderModal: (onSubmit: () => Promise<void>, onClose: () => void, c: Currencies) =>
      render(<AddItemModal isOpen onClose={onClose} onAdd={onSubmit} {...c} />),
  },
  {
    name: 'ProposeItemModal',
    submitLabel: /^propose item$/i,
    renderModal: (onSubmit: () => Promise<void>, onClose: () => void, c: Currencies) =>
      render(<ProposeItemModal isOpen onClose={onClose} onPropose={onSubmit} {...c} />),
  },
];

// The currency picker's trigger is a button labelled with the selected code.
const currencyButton = (code: string) => screen.getByRole('button', { name: code });

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => cleanup());

describe.each(modals)('$name — default currency', ({ renderModal, submitLabel }) => {
  const open = (
    c: Currencies,
    onSubmit = vi.fn().mockResolvedValue(undefined),
    onClose = vi.fn()
  ) => {
    renderModal(onSubmit, onClose, c);
    return { onSubmit, onClose };
  };

  // regression: the form hardcoded a 'USD' default and the modal never gave it
  // the wishlist's currency, so a PLN list's new items all started on USD.
  it("regression: starts on the wishlist's currency, not USD", () => {
    open({ wishlistCurrency: 'PLN', userCurrency: 'EUR' });
    expect(currencyButton('PLN')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'USD' })).toBeNull();
  });

  it("falls back to the viewer's default when the wishlist has no currency", () => {
    open({ wishlistCurrency: undefined, userCurrency: 'EUR' });
    expect(currencyButton('EUR')).toBeInTheDocument();
  });

  it('falls back to USD when neither the wishlist nor the viewer has one', () => {
    open({ wishlistCurrency: null, userCurrency: undefined });
    expect(currencyButton('USD')).toBeInTheDocument();
  });

  it('skips a currency the picker does not offer', () => {
    open({ wishlistCurrency: 'XYZ', userCurrency: 'GBP' });
    expect(currencyButton('GBP')).toBeInTheDocument();
  });

  it('shows the code uppercase and submits it lowercase', async () => {
    const { onSubmit } = open({ wishlistCurrency: 'pln', userCurrency: 'EUR' });
    expect(currencyButton('PLN')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Gift' } });
    fireEvent.change(screen.getByLabelText(/^price$/i), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: submitLabel }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ price: { value: 2000, currency: 'pln' } })
      )
    );
  });

  it('closes without an unsaved-changes prompt when nothing was edited', () => {
    const { onClose } = open({ wishlistCurrency: 'PLN', userCurrency: 'EUR' });
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/discard changes\?/i)).toBeNull();
  });

  it('still prompts once the currency is actually changed', () => {
    const { onClose } = open({ wishlistCurrency: 'PLN', userCurrency: 'EUR' });
    fireEvent.click(currencyButton('PLN'));
    fireEvent.click(screen.getByRole('button', { name: /EUR\s*Euro/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/discard changes\?/i)).toBeInTheDocument();
  });
});

describe.each(modals)('$name — submit outcome', ({ renderModal, submitLabel }) => {
  const currencies = { wishlistCurrency: 'PLN', userCurrency: 'EUR' };
  const nameInput = () => screen.getByLabelText(/item name/i);
  const priceInput = () => screen.getByLabelText(/^price$/i);

  const fillAndSubmit = () => {
    fireEvent.change(nameInput(), { target: { value: 'Bike' } });
    fireEvent.change(priceInput(), { target: { value: '120.50' } });
    fireEvent.click(screen.getByRole('button', { name: submitLabel }));
  };

  // ItemForm logs the rejection it catches; keep the test output clean.
  beforeEach(() => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    return () => consoleError.mockRestore();
  });

  // regression: the modal caught onAdd/onPropose's rejection itself, so ItemForm
  // took the failure for a success and cleared the form (and the page closed the
  // modal regardless), throwing away everything the user typed.
  it('regression: stays open with the typed name and price when the request fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Too many requests'));
    const onClose = vi.fn();
    renderModal(onSubmit, onClose, currencies);

    fillAndSubmit();

    // Submitting has settled once the button is back to its idle label.
    await waitFor(() => expect(screen.getByRole('button', { name: submitLabel })).toBeEnabled());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(nameInput()).toHaveValue('Bike');
    expect(priceInput()).toHaveValue(120.5);
    expect(currencyButton('PLN')).toBeInTheDocument();
  });

  it('still asks before discarding the input after a failure', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Network error'));
    const onClose = vi.fn();
    renderModal(onSubmit, onClose, currencies);

    fillAndSubmit();
    await waitFor(() => expect(screen.getByRole('button', { name: submitLabel })).toBeEnabled());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/discard changes\?/i)).toBeInTheDocument();
  });

  it('lets the user retry after a failure, and closes once it succeeds', async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error('Server error'))
      .mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    renderModal(onSubmit, onClose, currencies);

    fillAndSubmit();
    await waitFor(() => expect(screen.getByRole('button', { name: submitLabel })).toBeEnabled());
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: submitLabel }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Bike', price: { value: 12050, currency: 'pln' } })
    );
  });
});

describe('New item modals — most wanted', () => {
  const currencies = { wishlistCurrency: 'USD', userCurrency: 'USD' };
  const mostWantedSwitch = () => screen.queryByRole('switch', { name: /most wanted/i });

  it('lets an owner add an item as most wanted', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<AddItemModal isOpen onClose={vi.fn()} onAdd={onAdd} {...currencies} />);

    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Bike' } });
    fireEvent.click(mostWantedSwitch()!);
    fireEvent.click(screen.getByRole('button', { name: /^add item$/i }));
    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Bike', mostWanted: true })
      )
    );
  });

  it('does not offer it when proposing', () => {
    render(<ProposeItemModal isOpen onClose={vi.fn()} onPropose={vi.fn()} {...currencies} />);
    expect(mostWantedSwitch()).toBeNull();
  });
});
