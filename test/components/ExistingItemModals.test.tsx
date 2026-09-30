// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { ApiItem } from '@/types/api';

// ImageUpload pulls in react-easy-crop; stub it out.
vi.mock('@/components/ImageUpload', () => ({
  default: () => <div data-testid="image-upload" />,
}));

import EditItemModal from '@/components/EditItemModal';
import ReviewItemModal from '@/components/ReviewItemModal';
import { itemToFormData } from '@/components/ItemForm';

type Currencies = {
  wishlistCurrency: string | null | undefined;
  userCurrency: string | null | undefined;
};

function item(overrides: Partial<ApiItem>): ApiItem {
  return {
    _id: 'item-1',
    wishlist: 'w1',
    name: 'Bike',
    status: 'available',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  } as ApiItem;
}

type Submit = (updates: Partial<ApiItem>) => Promise<void>;

// Every form that opens on an existing item maps its price the same way and gets
// the same currency default; run every case on each.
const modals = [
  {
    name: 'EditItemModal',
    status: 'available' as const,
    submitLabel: /^save changes$/i,
    renderModal: (it: ApiItem, onSubmit: Submit, onClose: () => void, c: Currencies) =>
      render(<EditItemModal isOpen onClose={onClose} onSave={onSubmit} item={it} {...c} />),
  },
  {
    name: 'EditItemModal (a proposer editing their proposal)',
    status: 'proposed' as const,
    submitLabel: /^save changes$/i,
    renderModal: (it: ApiItem, onSubmit: Submit, onClose: () => void, c: Currencies) =>
      render(<EditItemModal isOpen onClose={onClose} onSave={onSubmit} item={it} {...c} />),
  },
  {
    name: 'ReviewItemModal',
    status: 'proposed' as const,
    submitLabel: /^approve item$/i,
    renderModal: (it: ApiItem, onSubmit: Submit, onClose: () => void, c: Currencies) =>
      render(<ReviewItemModal isOpen onClose={onClose} onApprove={onSubmit} item={it} {...c} />),
  },
];

// The currency picker's trigger is a button labelled with the selected code.
const currencyButton = (code: string) => screen.getByRole('button', { name: code });
const priceInput = () => screen.getByLabelText(/^price$/i);

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => cleanup());

describe.each(modals)('$name — price and currency', ({ status, submitLabel, renderModal }) => {
  const plnList = { wishlistCurrency: 'PLN', userCurrency: 'EUR' };
  const open = (
    overrides: Partial<ApiItem>,
    c: Currencies = plnList,
    onSubmit = vi.fn<Submit>().mockResolvedValue(undefined),
    onClose = vi.fn()
  ) => {
    renderModal(item({ status, ...overrides }), onSubmit, onClose, c);
    return { onSubmit, onClose };
  };

  // regression: itemToFormData fell back to a hardcoded 'USD' for an item with no
  // price, so a price added while editing or approving it on a PLN list was
  // saved in USD.
  it("regression: a priceless item starts on the wishlist's currency, not USD", async () => {
    const { onSubmit } = open({ price: null });
    expect(currencyButton('PLN')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'USD' })).toBeNull();

    fireEvent.change(priceInput(), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: submitLabel }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // Shown uppercase, stored lowercase to match Item.price.currency.
    expect(onSubmit.mock.calls[0][0].price).toEqual({ value: 2500, currency: 'pln' });
  });

  it('an item priced in EUR still starts on EUR on a PLN list', async () => {
    const { onSubmit } = open({ price: { value: 1000, currency: 'eur' } });
    expect(currencyButton('EUR')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'PLN' })).toBeNull();
    expect(priceInput()).toHaveValue(10);

    fireEvent.click(screen.getByRole('button', { name: submitLabel }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].price).toEqual({ value: 1000, currency: 'eur' });
  });

  it("falls back to the viewer's default, then USD, when the wishlist has no currency", () => {
    open({ price: null }, { wishlistCurrency: undefined, userCurrency: 'EUR' });
    expect(currencyButton('EUR')).toBeInTheDocument();
    cleanup();
    open({ price: null }, { wishlistCurrency: null, userCurrency: undefined });
    expect(currencyButton('USD')).toBeInTheDocument();
  });

  it('keeps a priceless item priceless when saved without a price', async () => {
    const { onSubmit } = open({ price: null });
    fireEvent.click(screen.getByRole('button', { name: submitLabel }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].price).toBeNull();
  });

  it('does not count the prefilled currency as an unsaved change', () => {
    const { onClose } = open({ price: null });
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/discard changes\?/i)).toBeNull();
  });

  it('still prompts once a price is added', () => {
    const { onClose } = open({ price: null });
    fireEvent.change(priceInput(), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/discard changes\?/i)).toBeInTheDocument();
  });

  // regression: itemToFormData mapped the price with a truthiness check on
  // price.value, so an item priced at 0 opened with an empty price field and
  // saving any other change submitted `price: null`, which cleared it.
  it('regression: an item priced at 0 keeps its price when another field is saved', async () => {
    const { onSubmit } = open({ price: { value: 0, currency: 'eur' } });
    expect(priceInput()).toHaveDisplayValue('0.00');
    expect(currencyButton('EUR')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^notes$/i), {
      target: { value: 'Free, just take it' },
    });
    fireEvent.click(screen.getByRole('button', { name: submitLabel }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      notes: 'Free, just take it',
      price: { value: 0, currency: 'eur' },
    });
  });

  it('does not count a 0.00 price as an unsaved change', () => {
    const { onClose } = open({ price: { value: 0, currency: 'eur' } });
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/discard changes\?/i)).toBeNull();
  });
});

describe('itemToFormData — price', () => {
  it('shows a zero price as 0.00, not as an empty field', () => {
    expect(itemToFormData(item({ price: { value: 0, currency: 'eur' } }), 'PLN').price).toBe(
      '0.00'
    );
  });

  it('shows cents as a two-decimal amount', () => {
    expect(itemToFormData(item({ price: { value: 1999, currency: 'eur' } }), 'PLN').price).toBe(
      '19.99'
    );
  });

  it('leaves the field empty for an item with no price', () => {
    expect(itemToFormData(item({ price: null }), 'PLN').price).toBe('');
    expect(itemToFormData(item({ price: undefined }), 'PLN').price).toBe('');
  });
});

describe('itemToFormData — currency', () => {
  it('uses the default for an item with no price', () => {
    expect(itemToFormData(item({ price: null }), 'PLN').currency).toBe('PLN');
    expect(itemToFormData(item({ price: undefined }), 'PLN').currency).toBe('PLN');
  });

  it("keeps a priced item's own currency, shown uppercase", () => {
    expect(itemToFormData(item({ price: { value: 1000, currency: 'eur' } }), 'PLN').currency).toBe(
      'EUR'
    );
    // A zero price is still a price, so it keeps its own currency too.
    expect(itemToFormData(item({ price: { value: 0, currency: 'gbp' } }), 'PLN').currency).toBe(
      'GBP'
    );
  });

  it('normalizes the default the way a new item does', () => {
    expect(itemToFormData(item({ price: null }), 'pln').currency).toBe('PLN');
    expect(itemToFormData(item({ price: null }), 'XYZ').currency).toBe('USD');
    expect(itemToFormData(item({ price: null }), '').currency).toBe('USD');
  });
});
