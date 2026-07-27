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

  // The `owners[]` migration runs after deploy, so reads must still resolve rows
  // that only carry the old single `owner` field.
  it('falls back to the legacy single owner when owners[] is empty', () => {
    const legacy = wishlist({ owners: [], owner: B });
    expect(ownerIds(legacy)).toEqual([B.toString()]);
    expect(primaryOwnerId(legacy)).toBe(B.toString());
  });

  it('prefers owners[] over the legacy field once both exist', () => {
    expect(ownerIds(wishlist({ owners: [A, B], owner: C }))).toEqual([A.toString(), B.toString()]);
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
  it('matches owners[] plus the two legacy shapes', () => {
    const filter = ownedByFilter(A.toString()) as { $or: Record<string, unknown>[] };
    expect(filter.$or).toHaveLength(3);
    expect(filter.$or[0]).toEqual({ owners: A });
    expect(filter.$or[1]).toEqual({ owner: A, owners: { $size: 0 } });
    expect(filter.$or[2]).toEqual({ owner: A, owners: { $exists: false } });
  });
});

describe('isLastOwner', () => {
  it('is true only for the sole remaining owner', () => {
    expect(isLastOwner(wishlist({ owners: [A] }), A.toString())).toBe(true);
    expect(isLastOwner(wishlist({ owners: [A, B] }), A.toString())).toBe(false);
    expect(isLastOwner(wishlist({ owners: [A] }), B.toString())).toBe(false);
  });

  it('reads the legacy single owner too', () => {
    expect(isLastOwner(wishlist({ owners: [], owner: A }), A.toString())).toBe(true);
  });
});

describe('isFeaturedBy', () => {
  it('is per-owner: one owner pinning a list does not pin it for another', () => {
    const w = wishlist({ owners: [A, B], featuredBy: [A] });
    expect(isFeaturedBy(w, A.toString())).toBe(true);
    expect(isFeaturedBy(w, B.toString())).toBe(false);
  });

  it('falls back to the legacy flag for un-migrated rows', () => {
    const legacy = wishlist({ owners: [], owner: A, featuredBy: [], featured: true });
    expect(isFeaturedBy(legacy, A.toString())).toBe(true);
    expect(isFeaturedBy(legacy, B.toString())).toBe(false);
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

  it('drops the deprecated single-owner fields', () => {
    const out = serializeWishlist(wishlist({ owners: [A], owner: A, featuredBy: [A] }), null);
    expect(out).not.toHaveProperty('owner');
    expect(out).not.toHaveProperty('featuredBy');
  });

  it('keeps the rest of the wishlist intact', () => {
    const out = serializeWishlist(wishlist({ name: 'Birthday', slug: 'bday' }), null);
    expect(out.name).toBe('Birthday');
    expect(out.slug).toBe('bday');
    expect(out.createdAt).toEqual(new Date('2026-01-01'));
  });
});
