import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import type { IWishlist } from '@/models/Wishlist';
import {
  isFeaturedBy,
  isWishlistOwner,
  ownedByFilter,
  ownerIds,
  primaryOwnerId,
  serializeWishlist,
} from '@/lib/utils/wishlistOwners';
import { isLastOwner } from '@/lib/utils/wishlistOwnership';

const A = new mongoose.Types.ObjectId();
const B = new mongoose.Types.ObjectId();
const C = new mongoose.Types.ObjectId();

function wishlist(overrides: Partial<IWishlist> = {}): IWishlist {
  return {
    _id: new mongoose.Types.ObjectId(),
    name: 'List',
    slug: 'list',
    description: null,
    owners: [A],
    isPublic: true,
    visibility: 'everyone',
    archived: false,
    currency: 'USD',
    featuredBy: [],
    bannerUrl: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    ...overrides,
  };
}

describe('ownerIds / primaryOwnerId', () => {
  it('returns every owner, in order', () => {
    expect(ownerIds(wishlist({ owners: [A, B] }))).toEqual([A.toString(), B.toString()]);
    expect(primaryOwnerId(wishlist({ owners: [A, B] }))).toBe(A.toString());
  });

  it('returns nothing for an unowned row', () => {
    expect(ownerIds(wishlist({ owners: [] }))).toEqual([]);
    expect(primaryOwnerId(wishlist({ owners: [] }))).toBeNull();
  });
});

describe('isWishlistOwner', () => {
  it('treats every co-owner as an owner', () => {
    const w = wishlist({ owners: [A, B] });
    expect(isWishlistOwner(w, A.toString())).toBe(true);
    expect(isWishlistOwner(w, B.toString())).toBe(true);
    expect(isWishlistOwner(w, C.toString())).toBe(false);
  });

  it('is false for an anonymous viewer', () => {
    expect(isWishlistOwner(wishlist(), null)).toBe(false);
    expect(isWishlistOwner(wishlist(), undefined)).toBe(false);
  });
});

describe('ownedByFilter', () => {
  it('matches on the owners set', () => {
    expect(ownedByFilter(A.toString())).toEqual({ owners: A });
  });
});

describe('isLastOwner', () => {
  it('is true only for the sole remaining owner', () => {
    expect(isLastOwner(wishlist({ owners: [A] }), A.toString())).toBe(true);
    expect(isLastOwner(wishlist({ owners: [A, B] }), A.toString())).toBe(false);
    expect(isLastOwner(wishlist({ owners: [A] }), B.toString())).toBe(false);
  });
});

describe('isFeaturedBy', () => {
  it('is per-owner: one owner pinning a list does not pin it for another', () => {
    const w = wishlist({ owners: [A, B], featuredBy: [A] });
    expect(isFeaturedBy(w, A.toString())).toBe(true);
    expect(isFeaturedBy(w, B.toString())).toBe(false);
  });

  it('is false without a viewer', () => {
    expect(isFeaturedBy(wishlist({ featuredBy: [A] }), null)).toBe(false);
  });
});

describe('serializeWishlist', () => {
  it('exposes owners as ids and folds featured down to the viewer', () => {
    const w = wishlist({ owners: [A, B], featuredBy: [B] });

    const forA = serializeWishlist(w, A.toString());
    expect(forA.owners).toEqual([A.toString(), B.toString()]);
    expect(forA.featured).toBe(false);

    const forB = serializeWishlist(w, B.toString());
    expect(forB.featured).toBe(true);
  });

  // `featuredBy` is per-owner state; clients get the folded `featured` boolean
  // instead, so the raw set must not leak into the response.
  it('does not expose the raw featuredBy set', () => {
    const out = serializeWishlist(wishlist({ owners: [A], featuredBy: [A] }), null);
    expect(out).not.toHaveProperty('featuredBy');
  });

  it('keeps the rest of the wishlist intact', () => {
    const out = serializeWishlist(wishlist({ name: 'Birthday', slug: 'bday' }), null);
    expect(out.name).toBe('Birthday');
    expect(out.slug).toBe('bday');
    expect(out.createdAt).toEqual(new Date('2026-01-01'));
  });
});
