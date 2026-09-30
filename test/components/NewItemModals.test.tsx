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
