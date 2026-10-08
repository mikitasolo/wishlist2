import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import { serializeItem, type ItemViewer } from '@/lib/utils/itemSerializer';
import type { IItem } from '@/models/Item';

// units per USD: 10.00 EUR is $20.00
const rates = new Map([
  ['usd', 1],
  ['eur', 0.5],
]);

const me = new Types.ObjectId().toString();
const someoneElse = new Types.ObjectId();

function item(overrides: Partial<IItem> = {}): IItem {
  return {
    _id: new Types.ObjectId(),
    wishlist: new Types.ObjectId(),
    name: 'Kettle',
    price: { value: 1000, currency: 'eur' },
    status: 'available',
    bookedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const bookedByMe = (extra: Partial<IItem> = {}) =>
  item({ status: 'booked', bookedBy: new Types.ObjectId(me), ...extra });
const bookedBySomeoneElse = () => item({ status: 'booked', bookedBy: someoneElse });
const proposedByMe = () => item({ status: 'proposed', proposedBy: new Types.ObjectId(me) });
const proposedBySomeoneElse = () => item({ status: 'proposed', proposedBy: someoneElse });

const owner: ItemViewer = { role: 'owner' };
const visitor: ItemViewer = { role: 'visitor' };
const proposer: ItemViewer = { role: 'proposer', id: me };
const member = (givenByViewer: string[] = []): ItemViewer => ({
  role: 'member',
  id: me,
  givenByViewer: new Set(givenByViewer),
});

describe('serializeItem', () => {
  it('carries priceInUsdCents for every viewer, and null without a price', () => {
    for (const viewer of [owner, visitor, proposer, member()]) {
      expect(serializeItem(item(), viewer, rates, []).priceInUsdCents).toBe(2000);
      expect(serializeItem(item({ price: null }), viewer, rates, []).priceInUsdCents).toBeNull();
    }
  });

  it('keeps the content fields as stored', () => {
    const source = item({ link: 'https://shop.example/k', notes: 'Blue', mostWanted: true });
    expect(serializeItem(source, owner, rates, [])).toMatchObject({
      _id: source._id,
      name: 'Kettle',
      link: 'https://shop.example/k',
      notes: 'Blue',
      mostWanted: true,
      price: { value: 1000, currency: 'eur' },
    });
  });

  it('calls a document’s toObject rather than spreading the document', () => {
    const plain = bookedBySomeoneElse();
    const doc = { ...plain, toObject: () => ({ ...plain }) };
    const out = serializeItem(doc, owner, rates, []);
    expect(out).not.toHaveProperty('toObject');
    expect(out.status).toBe('available');
  });

  describe('owner', () => {
    it('folds booked into available and never names the gifter', () => {
      const out = serializeItem(bookedBySomeoneElse(), owner, rates, []);
      expect(out.status).toBe('available');
      expect(out.bookedBy).toBeUndefined();
      expect(out).not.toHaveProperty('givenByMe');
    });

    it('never names a proposer', () => {
      const out = serializeItem(proposedBySomeoneElse(), owner, rates, []);
      expect(out.status).toBe('proposed');
      expect(out.proposedBy).toBeUndefined();
    });

    it('keeps every other status as it is', () => {
      for (const status of ['draft', 'available', 'completed'] as const) {
        expect(serializeItem(item({ status }), owner, rates, []).status).toBe(status);
      }
    });
  });

  describe('member', () => {
    it('sees their own booking, with their own id', () => {
      const out = serializeItem(bookedByMe(), member(), rates, []);
      expect(out.status).toBe('booked');
      expect(out.bookedBy).toBe(me);
      expect(out.givenByMe).toBe(false);
    });

    it('sees that someone else booked an item, but not who', () => {
      const out = serializeItem(bookedBySomeoneElse(), member(), rates, []);
      expect(out.status).toBe('booked');
      expect(out.bookedBy).toBeUndefined();
      expect(out.givenByMe).toBe(false);
    });

    it('sees their own proposal’s id, never someone else’s', () => {
      expect(serializeItem(proposedByMe(), member(), rates, []).proposedBy).toBe(me);
      expect(
        serializeItem(proposedBySomeoneElse(), member(), rates, []).proposedBy
      ).toBeUndefined();
    });

    it('gets givenByMe on a gift they hold the booking of and marked as given', () => {
      const mine = bookedByMe();
      expect(serializeItem(mine, member([mine._id.toString()]), rates, []).givenByMe).toBe(true);
    });

    // givenByMe is only ever about the viewer's own booking: an id in the set
    // for an item someone else holds never turns it on.
    it('never gets givenByMe on someone else’s booking', () => {
      const theirs = bookedBySomeoneElse();
      expect(serializeItem(theirs, member([theirs._id.toString()]), rates, []).givenByMe).toBe(
        false
      );
    });
  });

  describe('non-member proposer', () => {
    it('sees their own proposal’s id', () => {
      const out = serializeItem(proposedByMe(), proposer, rates, []);
      expect(out.proposedBy).toBe(me);
      expect(out).not.toHaveProperty('givenByMe');
    });

    it('never sees someone else’s proposal id or any booking', () => {
      expect(
        serializeItem(proposedBySomeoneElse(), proposer, rates, []).proposedBy
      ).toBeUndefined();
      const booked = serializeItem(bookedByMe(), proposer, rates, []);
      expect(booked.status).toBe('available');
      expect(booked.bookedBy).toBeUndefined();
    });
  });

  describe('visitor (signed out, or signed in without a membership)', () => {
    it('folds booked into available and names nobody', () => {
      const out = serializeItem(bookedBySomeoneElse(), visitor, rates, []);
      expect(out.status).toBe('available');
      expect(out.bookedBy).toBeUndefined();
      expect(out.proposedBy).toBeUndefined();
      expect(out).not.toHaveProperty('givenByMe');
    });

    it('names no proposer, theirs included', () => {
      expect(serializeItem(proposedByMe(), visitor, rates, []).proposedBy).toBeUndefined();
      expect(serializeItem(proposedBySomeoneElse(), visitor, rates, []).proposedBy).toBeUndefined();
    });
  });

  describe('linked items (WIS-29)', () => {
    it('never answers the stored ids, only the refs it was given, as { id, name }', () => {
      const partner = new Types.ObjectId();
      const source = item({ relatedItems: [partner, new Types.ObjectId()] });
      for (const viewer of [owner, visitor, proposer, member()]) {
        const out = serializeItem(source, viewer, rates, [
          { id: partner.toString(), name: 'Drill bits', status: 'booked' } as never,
        ]);
        // A stray field on a ref (a status) is never passed on.
        expect(out.relatedItems).toEqual([{ id: partner.toString(), name: 'Drill bits' }]);
      }
    });

    it('answers no partners as an empty list', () => {
      expect(serializeItem(item(), owner, rates, []).relatedItems).toEqual([]);
    });
  });
});
