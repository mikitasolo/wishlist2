import { describe, it, expect } from 'vitest';
import {
  itemChanges,
  itemFormContent,
  itemToFormData,
  type ItemFormData,
} from '@/lib/utils/itemForm';

const IMAGE = 'https://store.public.blob.vercel-storage.com/uploads/u1/mug.webp';
const OTHER_IMAGE = 'https://store.public.blob.vercel-storage.com/uploads/u2/mug.webp';

// The item as the edit form was filled from it.
const filledFrom: ItemFormData = itemToFormData(
  {
    name: 'Blue Mug',
    imageUrl: IMAGE,
    price: { value: 1250, currency: 'eur' },
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
      price: { value: 1999, currency: 'pln' },
      link: 'https://shop.example.com/mug',
      notes: 'Size M',
      mostWanted: true,
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

  it('keeps a zero price, and falls back to USD with no currency', () => {
    expect(itemFormContent(edited({ price: '0' })).price).toEqual({ value: 0, currency: 'eur' });
    expect(itemFormContent(edited({ price: '3', currency: '' })).price).toEqual({
      value: 300,
      currency: 'usd',
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
    // Changed and changed back.
    expect(itemChanges(edited({ name: 'Blue Mug' }), filledFrom)).toEqual({});
  });

  it('sends the price as one field: the amount and currency together', () => {
    expect(itemChanges(edited({ price: '15' }), filledFrom)).toEqual({
      price: { value: 1500, currency: 'eur' },
    });
    expect(itemChanges(edited({ currency: 'GBP' }), filledFrom)).toEqual({
      price: { value: 1250, currency: 'gbp' },
    });
  });

  it("doesn't count another currency on a priceless item as a change, but does a price added", () => {
    const priceless = itemToFormData({ name: 'Blue Mug', price: null, status: 'available' }, 'PLN');
    expect(itemChanges({ ...priceless, currency: 'EUR' }, priceless)).toEqual({});
    expect(itemChanges({ ...priceless, price: '25' }, priceless)).toEqual({
      price: { value: 2500, currency: 'pln' },
    });
  });

  // A zero price is a real one: saving another field neither clears nor sends it.
  it('keeps a zero price out of an edit of another field', () => {
    const free = itemToFormData(
      { name: 'Blue Mug', price: { value: 0, currency: 'eur' }, status: 'available' },
      'PLN'
    );
    expect(itemChanges({ ...free, notes: 'Free' }, free)).toEqual({ notes: 'Free' });
  });

  it('never sends a status: editing an item never changes it', () => {
    expect(itemChanges(edited({ isDraft: true }), filledFrom)).toEqual({});
  });
});
