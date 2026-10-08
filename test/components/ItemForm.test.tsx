// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ImageUpload pulls in react-easy-crop; stub it out.
vi.mock('@/components/ImageUpload', () => ({
  default: () => <div data-testid="image-upload" />,
}));

import ItemForm from './ItemFormWithFooter';
import type { ItemFormData } from '@/components/ItemForm';

const filled: ItemFormData = {
  name: 'Existing',
  imageUrl: '',
  price: '',
  currency: 'USD',
  link: '',
  notes: '',
  mostWanted: false,
  isDraft: false,
  relatedItems: [],
};

beforeEach(() => cleanup());

describe('ItemForm — status toggle visibility', () => {
  it("has no status toggle when creating: Save as draft is the footer's", () => {
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="create" />);
    expect(screen.queryByRole('radio', { name: /published/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save as draft' })).toBeInTheDocument();
  });

  // The review's status comes from the button pressed (Add to list or Add as
  // draft), as a create's does.
  it('has no status toggle when reviewing a proposal', () => {
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="review" initialData={filled} />);
    expect(screen.queryByRole('radio', { name: /published/i })).toBeNull();
    expect(screen.queryByRole('radio', { name: /^draft$/i })).toBeNull();
  });

  it('hides the toggle in propose mode', () => {
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="propose" />);
    expect(screen.queryByRole('radio', { name: /published/i })).toBeNull();
  });

  // Regression: editing an existing item must NOT expose a status toggle — sending
  // status on a content edit used to clobber a booking (owners can't see bookings).
  it('regression: hides the status toggle when editing', () => {
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="edit" initialData={filled} />);
    expect(screen.queryByRole('radio', { name: /published/i })).toBeNull();
    expect(screen.queryByRole('radio', { name: /^draft$/i })).toBeNull();
  });
});

describe('ItemForm — review submission', () => {
  it('submits status "available" from the primary button, "draft" from the draft button', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="review" initialData={filled} />);

    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'available' }),
        expect.anything()
      )
    );

    onSubmit.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'draft' }),
        expect.anything()
      )
    );
  });
});

describe('ItemForm — a link the schema now refuses', () => {
  // An item or proposal saved before only http(s) links were accepted can hold
  // another scheme. The form says so as it opens, and won't save it back as it
  // is: the owner fixes or clears it first (WIS-257).
  it('says what is wrong with it as the form opens, and refuses to save it', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ItemForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        mode="review"
        initialData={{ ...filled, link: 'ftp://example.com/gift' }}
      />
    );
    const link = screen.getByLabelText(/product link/i);
    expect(link).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a web address like https://example.com')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() => expect(link).toHaveFocus());
    expect(onSubmit).not.toHaveBeenCalled();

    // Cleared, it saves, and the change sent clears the stored link.
    fireEvent.change(link, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][1]).toEqual({ link: null });
  });

  it('shows no error for a valid link, or none, as the form opens', () => {
    render(
      <ItemForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        mode="edit"
        initialData={{ ...filled, link: 'https://example.com' }}
      />
    );
    expect(screen.getByLabelText(/product link/i)).not.toHaveAttribute('aria-invalid', 'true');
  });
});

describe('ItemForm — create submission', () => {
  it('submits status "available" from the primary button, "draft" from Save as draft', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="create" />);

    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Gift' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Gift', status: 'available' }),
        expect.anything()
      )
    );

    onSubmit.mockClear();
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Draft gift' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Draft gift', status: 'draft' }),
        expect.anything()
      )
    );

    // The draft asked for once doesn't stick to the next save.
    onSubmit.mockClear();
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Another' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'available' }),
        expect.anything()
      )
    );
  });

  it('lays the fields out as Name, Link, Price, Notes, Photo, Most wanted', () => {
    const { container } = render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="create" />);
    const form = container.querySelector('form')!;
    const order = [
      screen.getByLabelText(/item name/i),
      screen.getByLabelText(/product link/i),
      screen.getByLabelText(/^price$/i),
      screen.getByLabelText(/^notes$/i),
      screen.getByTestId('image-upload'),
      screen.getByRole('switch', { name: /most wanted/i }),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
    expect(form).toHaveAttribute('novalidate');
  });

  it('shows errors under the fields and focuses the first invalid one', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="create" />);

    fireEvent.change(screen.getByLabelText(/product link/i), { target: { value: 'javascript:x' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));

    expect(await screen.findByText('Enter a name for the item')).toBeInTheDocument();
    expect(screen.getByLabelText(/item name/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/item name/i)).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Gift' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    expect(await screen.findByText(/enter a web address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/product link/i)).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a name with a text-direction override under Name, but not an unchanged one', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="create" />);
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Gift \u202E' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    expect(
      await screen.findByText("Name can't contain hidden text-direction characters")
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/item name/i)).toHaveAttribute('aria-invalid', 'true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // WIS-292: an item named before the bidi check existed stays editable.
  it('lets an edit save while a name the schema now refuses is left as it was', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const legacy = { ...filled, name: 'Gift \u202E' };
    render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="edit" initialData={legacy} />);
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  });

  it('accepts a link without a scheme, and fills in https:// when it is left', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="create" />);
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Gift' } });
    const link = screen.getByLabelText(/product link/i);
    fireEvent.change(link, { target: { value: 'amazon.de/dp/123' } });
    fireEvent.blur(link);
    expect(link).toHaveValue('https://amazon.de/dp/123');

    fireEvent.change(link, { target: { value: 'etsy.com/x' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ link: 'https://etsy.com/x' }),
        expect.anything()
      )
    );
  });

  it('counts the notes only near the 300 character limit', () => {
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="create" />);
    const notes = screen.getByLabelText(/^notes$/i);
    expect(notes).toHaveAttribute('maxlength', '300');
    expect(screen.queryByText(/\/300 characters/)).toBeNull();
    fireEvent.change(notes, { target: { value: 'x'.repeat(250) } });
    expect(screen.getByText('250/300 characters')).toBeInTheDocument();
  });
});

describe('ItemForm — propose', () => {
  it('says the owners will review it, in one line, without naming a proposer', () => {
    const { container } = render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="propose" />);
    expect(screen.getByText("The owners will review it before it's added")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/proposer|proposed by|you proposed/i);
    expect(screen.queryByRole('switch', { name: /most wanted/i })).toBeNull();
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

// The currency picker is the shared Select: a combobox whose trigger shows the
// selected code, with the options in a listbox.
const currencyButton = (code: string) => {
  const trigger = screen.getByRole('combobox', { name: 'Currency' });
  expect(trigger).toHaveTextContent(code);
  return trigger;
};
const pickCurrency = (from: string, name: RegExp) => {
  fireEvent.click(currencyButton(from));
  fireEvent.click(screen.getByRole('option', { name }));
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
        expect.objectContaining({ price: { value: 1250, currency: 'PLN' } }),
        expect.anything()
      )
    );
  });

  it('falls back to USD when no default currency is given', () => {
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="create" />);
    expect(currencyButton('USD')).toBeInTheDocument();
  });

  // Keep adding (WIS-242): the next item is most likely priced in the same
  // currency, so a cleared form keeps the one picked, not the default or USD.
  it('keeps the picked currency when it clears after a successful create', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onFormChange = vi.fn();
    render(
      <ItemForm
        onSubmit={onSubmit}
        onCancel={vi.fn()}
        mode="create"
        defaultCurrency="PLN"
        onFormChange={onFormChange}
      />
    );

    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Gift' } });
    pickCurrency('PLN', /EUR · Euro/);
    expect(currencyButton('EUR')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText(/item name/i)).toHaveValue(''));
    expect(currencyButton('EUR')).toBeInTheDocument();
    // The kept currency is where the next item starts, not an unsaved change.
    expect(onFormChange).toHaveBeenLastCalledWith(false);
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
    pickCurrency('PLN', /EUR · Euro/);
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

describe('ItemForm — price field', () => {
  const priceInput = () => screen.getByLabelText(/^price$/i) as HTMLInputElement;
  const submit = () => fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
  const typePrice = (value: string) => {
    fireEvent.change(priceInput(), { target: { value } });
    fireEvent.blur(priceInput());
  };
  const inLocale = (locale: string) =>
    vi.spyOn(navigator, 'language', 'get').mockReturnValue(locale);

  afterEach(() => vi.restoreAllMocks());

  // regression: a `type=number` field showed the browser's own decimal format
  // ("349,00") next to the card's ("349.00"), and refused the other separator.
  it('regression: is a decimal text field that takes either separator', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="create" defaultCurrency="EUR" />);
    expect(priceInput()).toHaveAttribute('type', 'text');
    expect(priceInput()).toHaveAttribute('inputmode', 'decimal');

    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Gift' } });
    fireEvent.change(priceInput(), { target: { value: '349,00' } });
    submit();
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ price: { value: 34900, currency: 'EUR' } }),
        expect.anything()
      )
    );
  });

  it('shows the currency’s symbol in front of the amount, in the viewer’s locale', () => {
    inLocale('pl-PL');
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="create" defaultCurrency="PLN" />);
    expect(priceInput().parentElement).toHaveTextContent(/^zł$/);
    pickCurrency('PLN', /EUR · Euro/);
    expect(priceInput().parentElement).toHaveTextContent(/^€$/);
  });

  it('puts the amount in the cards’ format when the field is left', () => {
    inLocale('de-DE');
    render(<ItemForm onSubmit={vi.fn()} onCancel={vi.fn()} mode="create" defaultCurrency="EUR" />);
    typePrice('1234,5');
    expect(priceInput()).toHaveValue('1.234,50');
    typePrice('1,234.50');
    expect(priceInput()).toHaveValue('1.234,50');
    typePrice('  ');
    expect(priceInput()).toHaveValue('');
  });

  it('refuses an amount it can’t read, rather than save it as no price', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="create" />);
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Gift' } });

    // Typing isn't nagged; leaving the field says what's wrong, and keeps it.
    fireEvent.change(priceInput(), { target: { value: '12,34,5' } });
    expect(screen.queryByText(/enter a price like/i)).toBeNull();
    fireEvent.blur(priceInput());
    expect(priceInput()).toHaveValue('12,34,5');
    expect(priceInput()).toHaveAttribute('aria-invalid', 'true');
    expect(priceInput()).toHaveAccessibleDescription('Enter a price like 349.00');

    submit();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSubmit).not.toHaveBeenCalled();

    typePrice('12.50');
    expect(priceInput()).not.toHaveAttribute('aria-invalid');
    // Once fixed, typing isn't nagged again until the field is left.
    fireEvent.change(priceInput(), { target: { value: '12.5.' } });
    expect(screen.queryByText(/enter a price like/i)).toBeNull();
    fireEvent.change(priceInput(), { target: { value: '12.50' } });

    submit();
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ price: { value: 1250, currency: 'USD' } }),
        expect.anything()
      )
    );
  });

  // "1.999" is three decimals where "." is the decimal separator, not 1999.00:
  // read that way, a typo would save 1000 times the price meant.
  it('reads one separator before three digits as the viewer’s locale writes numbers', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="create" />);
    typePrice('1.999');
    expect(priceInput()).toHaveAttribute('aria-invalid', 'true');

    cleanup();
    inLocale('de-DE');
    render(<ItemForm onSubmit={onSubmit} onCancel={vi.fn()} mode="create" />);
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Gift' } });
    typePrice('1.999');
    expect(priceInput()).toHaveValue('1.999,00');
    submit();
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ price: { value: 199900, currency: 'USD' } }),
        expect.anything()
      )
    );
  });

  it('does not count a reformatted amount as an unsaved change', () => {
    const onFormChange = vi.fn();
    render(
      <ItemForm
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        mode="edit"
        initialData={{ ...filled, price: '10.00' }}
        onFormChange={onFormChange}
      />
    );
    typePrice('10');
    expect(priceInput()).toHaveValue('10.00');
    expect(onFormChange).toHaveBeenLastCalledWith(false);
  });
});
