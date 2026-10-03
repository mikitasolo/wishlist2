// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import type { ApiItem } from '@/types/api';

// The card reads the session to tell who booked what.
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'owner-1' } }, status: 'authenticated' }),
}));

// BannerImage wraps next/image; ImageUpload pulls in react-easy-crop.
vi.mock('@/components/BannerImage', () => ({
  default: ({ alt }: { alt?: string }) => <img alt={alt ?? ''} />,
}));
vi.mock('@/components/ImageUpload', () => ({
  default: () => <div data-testid="image-upload" />,
}));

import WishlistItem from '@/components/WishlistItem';
import EditItemModal from '@/components/EditItemModal';

function item(overrides: Partial<ApiItem> = {}): ApiItem {
  return {
    _id: 'item-1',
    wishlist: 'w1',
    name: 'Headphones',
    status: 'available',
    price: { value: 34900, currency: 'eur' },
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  } as ApiItem;
}

const inLocale = (locale: string) => vi.spyOn(navigator, 'language', 'get').mockReturnValue(locale);

/** The item's card, with its edit dialog open on the same item. */
function renderCardAndEdit(shown: ApiItem, onSave = vi.fn().mockResolvedValue(undefined)) {
  const onClose = vi.fn();
  render(
    <>
      <WishlistItem item={shown} onUpdate={vi.fn()} onEdit={vi.fn()} isAuthenticated isOwner />
      <EditItemModal
        isOpen
        onClose={onClose}
        onSave={onSave}
        item={shown}
        wishlistCurrency="EUR"
        userCurrency="EUR"
      />
    </>
  );
  const dialog = screen.getByRole('dialog', { name: 'Edit Item' });
  return {
    card: screen.getByRole('article', { name: `Item: ${shown.name}` }),
    dialog,
    price: within(dialog).getByLabelText(/^price$/i),
    save: () => fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' })),
    onSave,
    onClose,
  };
}

beforeEach(() => {
  // useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('item prices — the card and the edit dialog agree', () => {
  // regression: the card printed "EUR 349.00" (`toFixed`, no locale) while the
  // edit dialog's `type=number` field showed the browser's format, "349,00".
  it.each([
    ['de-DE', '349,00 €', '349,00'],
    ['en-US', '€349.00', '349.00'],
    ['fr-FR', '349,00 €', '349,00'],
  ])('regression: in %s, the dialog shows the price as the card does', (locale, card, field) => {
    inLocale(locale);
    const view = renderCardAndEdit(item());
    expect(within(view.card).getByText(card)).toBeInTheDocument();
    expect(view.price).toHaveValue(field);
  });

  // regression: the number field refused "349,00", the format it showed itself
  // in a comma locale, so it couldn't be typed back.
  it.each(['de-DE', 'en-US'])(
    'regression: saving "349,00" stores 34900 cents (%s)',
    async (locale) => {
      inLocale(locale);
      const view = renderCardAndEdit(item({ price: { value: 5000, currency: 'eur' } }));

      fireEvent.change(view.price, { target: { value: '349,00' } });
      view.save();

      await waitFor(() => expect(view.onSave).toHaveBeenCalledTimes(1));
      // Only the price changed, so only the price is sent.
      expect(view.onSave).toHaveBeenCalledWith({ price: { value: 34900, currency: 'eur' } });
    }
  );

  it('sends no price when the amount was only written differently', async () => {
    inLocale('de-DE');
    const view = renderCardAndEdit(item());

    fireEvent.change(view.price, { target: { value: '349' } });
    fireEvent.blur(view.price);
    expect(view.price).toHaveValue('349,00');
    fireEvent.change(view.price, { target: { value: '349.00' } });
    view.save();

    await waitFor(() => expect(view.onClose).toHaveBeenCalledTimes(1));
    expect(view.onSave).not.toHaveBeenCalled();
  });
});

describe('item prices — server render', () => {
  // The server can't know the viewer's locale: it formats in the fixed one, as
  // does the render that hydrates it, or React would refuse the mismatch.
  it('formats in the fixed locale on the server, whatever the browser’s', () => {
    inLocale('de-DE');
    const html = renderToString(
      <WishlistItem item={item()} onUpdate={vi.fn()} isAuthenticated isOwner />
    );
    expect(html).toContain('€349.00');
    expect(html).not.toContain('349,00');
  });
});
