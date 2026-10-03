import { describe, it, expect } from 'vitest';
import { Types } from 'mongoose';
import { serializeGiftLog } from '@/lib/utils/giftHistory';

const id = new Types.ObjectId();
const wishlist = new Types.ObjectId();
const giftedAt = new Date('2026-10-01T10:00:00.000Z');

describe('serializeGiftLog', () => {
  // The entry is the snapshot the gift took, and its list's id: nothing read
  // from the live list, so no slug to link it by.
  it('shapes an entry from its snapshot alone', () => {
    expect(
      serializeGiftLog({
        _id: id,
        itemName: 'Blue Mug',
        itemImage: 'https://shop.example/mug.png',
        itemPrice: { value: 1250, currency: 'usd' },
        recipientUsername: 'alice',
        wishlistName: 'Birthday',
        wishlist,
        giftedAt,
      })
    ).toEqual({
      _id: id.toString(),
      itemName: 'Blue Mug',
      itemImage: 'https://shop.example/mug.png',
      itemPrice: { value: 1250, currency: 'usd' },
      recipientUsername: 'alice',
      wishlistName: 'Birthday',
      wishlistId: wishlist.toString(),
      giftedAt,
    });
  });

  it('answers null for every snapshot field the entry lacks', () => {
    expect(serializeGiftLog({ _id: id, itemName: 'Blue Mug', giftedAt })).toEqual({
      _id: id.toString(),
      itemName: 'Blue Mug',
      itemImage: null,
      itemPrice: null,
      recipientUsername: null,
      wishlistName: null,
      wishlistId: null,
      giftedAt,
    });
  });
});
