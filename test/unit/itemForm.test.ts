import { describe, it, expect } from 'vitest';
import {
  itemChanges,
  itemFormContent,
  itemToFormData,
  rebaseItemForm,
  type ItemFormData,
} from '@/lib/utils/itemForm';

const IMAGE = 'https://store.public.blob.vercel-storage.com/uploads/u1/mug.webp';
const OTHER_IMAGE = 'https://store.public.blob.vercel-storage.com/uploads/u2/mug.webp';

// The item as the edit form was filled from it.
const filledFrom: ItemFormData = itemToFormData(
  {
    name: 'Blue Mug',
    imageUrl: IMAGE,
    price: { value: 1250, currency: 'EUR' },
    link: 'https://shop.example.com/mug',
    notes: 'Size M',
    mostWanted: false,
    status: 'available',
  },
  'USD'
);

/** The form as filled, with `change` typed into it. */
const edited = (change: Partial<ItemFormData> = {}): ItemFormData => ({
  ...filledFrom,
  ...change,
});

describe('itemFormContent', () => {
  it('reads the form the way an edit sends it: trimmed, the price in cents', () => {
    expect(
      itemFormContent(
        edited({
          name: '  Blue Mug ',
          imageUrl: ` ${IMAGE} `,
          price: '19.99',
          currency: 'PLN',
          link: ' https://shop.example.com/mug ',
          notes: ' Size M ',
          mostWanted: true,
        })
      )
    ).toEqual({
      name: 'Blue Mug',
      imageUrl: IMAGE,
      price: { value: 1999, currency: 'PLN' },
      link: 'https://shop.example.com/mug',
      notes: 'Size M',
      mostWanted: true,
      tags: [],
    });
  });

  it('reads an empty image, link or notes as none', () => {
    expect(itemFormContent(edited({ imageUrl: '', link: ' ', notes: '' }))).toMatchObject({
      imageUrl: null,
      link: null,
      notes: null,
    });
  });

  it('reads no amount, or one that is not a number of zero or more, as no price', () => {
    expect(itemFormContent(edited({ price: '' })).price).toBeNull();
    expect(itemFormContent(edited({ price: 'abc' })).price).toBeNull();
    expect(itemFormContent(edited({ price: '-5' })).price).toBeNull();
  });

  it('reads the amount with either decimal separator, and with grouping', () => {
    for (const [price, value] of [
      ['349,00', 34900],
      ['349.00', 34900],
      ['1 234,50', 123450],
      ['1,234.50', 123450],
      ['1.234,50', 123450],
    ] as const) {
      expect(itemFormContent(edited({ price })).price).toEqual({ value, currency: 'EUR' });
    }
  });

  it('keeps a zero price, and falls back to USD with no currency', () => {
    expect(itemFormContent(edited({ price: '0' })).price).toEqual({ value: 0, currency: 'EUR' });
    expect(itemFormContent(edited({ price: '3', currency: '' })).price).toEqual({
      value: 300,
      currency: 'USD',
    });
  });
});

describe('itemChanges', () => {
  it('is empty when nothing changed', () => {
    expect(itemChanges(edited(), filledFrom)).toEqual({});
  });

  // regression: the edit modal sent every content field as the form was filled
  // when it opened, so a notes-only save wrote back the name and image it had
  // loaded over a co-owner's change made meanwhile (putting back an image their
  // replacement had freed, and freeing theirs).
  it('regression: a notes-only edit sends only the notes, never the image or the name', () => {
    expect(itemChanges(edited({ notes: 'Size L' }), filledFrom)).toEqual({ notes: 'Size L' });
  });

  it('sends each field the owner changed, and only those', () => {
    expect(itemChanges(edited({ name: 'Red Mug' }), filledFrom)).toEqual({ name: 'Red Mug' });
    expect(itemChanges(edited({ imageUrl: OTHER_IMAGE }), filledFrom)).toEqual({
      imageUrl: OTHER_IMAGE,
    });
    expect(itemChanges(edited({ link: 'https://shop.example.com/red' }), filledFrom)).toEqual({
      link: 'https://shop.example.com/red',
    });
    expect(itemChanges(edited({ mostWanted: true }), filledFrom)).toEqual({ mostWanted: true });
    expect(
      itemChanges(edited({ name: 'Red Mug', notes: 'Size L', mostWanted: true }), filledFrom)
    ).toEqual({ name: 'Red Mug', notes: 'Size L', mostWanted: true });
  });

  it('sends a cleared field as null, so the write clears it', () => {
    expect(itemChanges(edited({ imageUrl: '' }), filledFrom)).toEqual({ imageUrl: null });
    expect(itemChanges(edited({ link: '' }), filledFrom)).toEqual({ link: null });
    expect(itemChanges(edited({ notes: '' }), filledFrom)).toEqual({ notes: null });
    expect(itemChanges(edited({ price: '' }), filledFrom)).toEqual({ price: null });
  });

  it('sends a changed field trimmed', () => {
    expect(itemChanges(edited({ name: ' Red Mug ', notes: ' Size L ' }), filledFrom)).toEqual({
      name: 'Red Mug',
      notes: 'Size L',
    });
  });

  it("doesn't count what would be sent as it already was as a change", () => {
    expect(itemChanges(edited({ name: 'Blue Mug  ', notes: ' Size M' }), filledFrom)).toEqual({});
    expect(itemChanges(edited({ imageUrl: ` ${IMAGE}` }), filledFrom)).toEqual({});
    expect(itemChanges(edited({ price: '12.5' }), filledFrom)).toEqual({});
    // The same amount in the other separator, or as the field reformats it.
    expect(itemChanges(edited({ price: '12,50' }), filledFrom)).toEqual({});
    expect(itemChanges(edited({ price: '€12.50' }), filledFrom)).toEqual({});
    // Changed and changed back.
    expect(itemChanges(edited({ name: 'Blue Mug' }), filledFrom)).toEqual({});
  });

  it('sends the price as one field: the amount and currency together', () => {
    expect(itemChanges(edited({ price: '15' }), filledFrom)).toEqual({
      price: { value: 1500, currency: 'EUR' },
    });
    expect(itemChanges(edited({ price: '1 234,50' }), filledFrom)).toEqual({
      price: { value: 123450, currency: 'EUR' },
    });
    expect(itemChanges(edited({ currency: 'GBP' }), filledFrom)).toEqual({
      price: { value: 1250, currency: 'GBP' },
    });
  });

  it("doesn't count another currency on a priceless item as a change, but does a price added", () => {
    const priceless = itemToFormData({ name: 'Blue Mug', price: null, status: 'available' }, 'PLN');
    expect(itemChanges({ ...priceless, currency: 'EUR' }, priceless)).toEqual({});
    expect(itemChanges({ ...priceless, price: '25' }, priceless)).toEqual({
      price: { value: 2500, currency: 'PLN' },
    });
  });

  // A zero price is a real one: saving another field neither clears nor sends it.
  it('keeps a zero price out of an edit of another field', () => {
    const free = itemToFormData(
      { name: 'Blue Mug', price: { value: 0, currency: 'EUR' }, status: 'available' },
      'PLN'
    );
    expect(itemChanges({ ...free, notes: 'Free' }, free)).toEqual({ notes: 'Free' });
  });

  it('never sends a status: editing an item never changes it', () => {
    expect(itemChanges(edited({ isDraft: true }), filledFrom)).toEqual({});
  });
});

describe('itemToFormData — the price', () => {
  const priced = (value: number, currency: string) =>
    ({ name: 'Bike', price: { value, currency }, status: 'available' }) as const;

  it('fills the amount in the format the card shows it in, for the given locale', () => {
    expect(itemToFormData(priced(34900, 'eur'), 'USD', 'de-DE').price).toBe('349,00');
    expect(itemToFormData(priced(34900, 'eur'), 'USD', 'en-US').price).toBe('349.00');
    expect(itemToFormData(priced(1234550, 'pln'), 'USD', 'en-US').price).toBe('12,345.50');
  });

  it('fills it in the fixed fallback locale when given none', () => {
    expect(itemToFormData(priced(123450, 'eur'), 'USD').price).toBe('1,234.50');
  });

  it('fills a lowercase stored currency as the uppercase code, and sends it uppercase', () => {
    const form = itemToFormData(priced(34900, 'eur'), 'USD');
    expect(form.currency).toBe('EUR');
    expect(itemFormContent(form).price).toEqual({ value: 34900, currency: 'EUR' });
    // Only the casing differs, so saving another field leaves the price out.
    expect(itemChanges({ ...form, notes: 'Blue' }, form)).toEqual({ notes: 'Blue' });
  });

  it('sends the currency uppercase, whatever casing the form holds', () => {
    const form = itemToFormData(priced(500, 'EUR'), 'USD');
    expect(itemFormContent({ ...form, currency: 'pln' }).price).toEqual({
      value: 500,
      currency: 'PLN',
    });
    // The same code in another casing isn't a change.
    expect(itemChanges({ ...form, currency: 'eur' }, form)).toEqual({});
  });

  it('reads back, unchanged, as the price it was filled from', () => {
    for (const locale of ['de-DE', 'en-US', 'fr-FR', 'de-CH', 'en-IN']) {
      // "1.234" in de-DE: a yen price has no decimals, so its one separator groups.
      for (const price of [
        { value: 12345678, currency: 'EUR' },
        { value: 123400, currency: 'JPY' },
      ]) {
        const form = itemToFormData(priced(price.value, price.currency), 'USD', locale);
        expect(itemFormContent(form, locale).price).toEqual(price);
        expect(itemChanges({ ...form, notes: 'Blue' }, form, locale)).toEqual({ notes: 'Blue' });
      }
    }
  });
});

describe('rebaseItemForm', () => {
  // The proposer's edit, landed while the owner had the review dialog open (WIS-320).
  const next: ItemFormData = {
    ...filledFrom,
    link: 'https://shop.example.com/other-mug',
    notes: 'Size L',
    price: '15.00',
  };

  it('takes every untouched field from the newer version', () => {
    expect(rebaseItemForm(filledFrom, filledFrom, next)).toEqual(next);
  });

  it('keeps the fields the person changed, and only those', () => {
    const form = { ...filledFrom, notes: 'Owner notes', name: 'Big Blue Mug' };
    expect(rebaseItemForm(form, filledFrom, next)).toEqual({
      ...next,
      notes: 'Owner notes',
      name: 'Big Blue Mug',
    });
  });

  it('keeps the price amount and currency together, as one field', () => {
    const form = { ...filledFrom, currency: 'USD' };
    const rebased = rebaseItemForm(form, filledFrom, next);
    expect([rebased.price, rebased.currency]).toEqual([filledFrom.price, 'USD']);
  });
});
