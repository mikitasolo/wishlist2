import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import { serializeGiftLog } from '@/lib/utils/giftHistory';

const id = new Types.ObjectId();
const wishlist = new Types.ObjectId();
const giftedAt = new Date('2026-10-01T10:00:00.000Z');

describe('serializeGiftLog', () => {
  it('shapes an entry, linking its wishlist by the current slug', () => {
    const slugs = new Map([[wishlist.toString(), 'birthday-a1b2c']]);

    expect(
      serializeGiftLog(
        {
          _id: id,
          itemName: 'Blue Mug',
          itemImage: 'https://shop.example/mug.png',
          itemPrice: { value: 1250, currency: 'usd' },
          recipientUsername: 'alice',
          wishlistName: 'Birthday',
          wishlist,
          giftedAt,
        },
        slugs
      )
    ).toEqual({
      _id: id.toString(),
      itemName: 'Blue Mug',
      itemImage: 'https://shop.example/mug.png',
      itemPrice: { value: 1250, currency: 'usd' },
      recipientUsername: 'alice',
      wishlistName: 'Birthday',
      wishlistId: wishlist.toString(),
      wishlistSlug: 'birthday-a1b2c',
      giftedAt,
    });
  });

  it('answers null for every snapshot field the entry lacks', () => {
    expect(serializeGiftLog({ _id: id, itemName: 'Blue Mug', giftedAt }, new Map())).toEqual({
      _id: id.toString(),
      itemName: 'Blue Mug',
      itemImage: null,
      itemPrice: null,
      recipientUsername: null,
      wishlistName: null,
      wishlistId: null,
      wishlistSlug: null,
      giftedAt,
    });
  });

  it('keeps the pointer but has no slug for a wishlist that no longer exists', () => {
    const entry = serializeGiftLog(
      { _id: id, itemName: 'Blue Mug', wishlist, giftedAt },
      new Map()
    );
    expect(entry.wishlistId).toBe(wishlist.toString());
    expect(entry.wishlistSlug).toBeNull();
  });
});
