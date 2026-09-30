import { describe, it, expect } from 'vitest';
import {
  createWishlistSchema,
  updateWishlistSchema,
  updateProfileSchema,
  inviteMemberSchema,
  createItemSchema,
  updateItemSchema,
} from '@/lib/validations';

describe('createWishlistSchema', () => {
  it('requires a non-empty name and defaults visibility to everyone', () => {
    const ok = createWishlistSchema.safeParse({ name: 'Birthday' });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.visibility).toBe('everyone');
  });
  it('rejects empty name and >100 chars', () => {
    expect(createWishlistSchema.safeParse({ name: '' }).success).toBe(false);
    expect(createWishlistSchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
  });
  it('uppercases and validates currency codes', () => {
    const ok = createWishlistSchema.safeParse({ name: 'x', currency: 'pln' });
    expect(ok.success && ok.data.currency).toBe('PLN');
    expect(createWishlistSchema.safeParse({ name: 'x', currency: 'zz' }).success).toBe(false);
  });
});

describe('updateWishlistSchema', () => {
  it('requires at least one field', () => {
    expect(updateWishlistSchema.safeParse({}).success).toBe(false);
  });
  it('validates slug format', () => {
    expect(updateWishlistSchema.safeParse({ slug: 'my-list' }).success).toBe(true);
    expect(updateWishlistSchema.safeParse({ slug: 'ab' }).success).toBe(false); // < 3
    expect(updateWishlistSchema.safeParse({ slug: '-bad' }).success).toBe(false);
    expect(updateWishlistSchema.safeParse({ slug: 'Bad Slug' }).success).toBe(false);
  });
});

describe('updateProfileSchema', () => {
  it('accepts a bio up to 300 chars and rejects longer', () => {
    expect(updateProfileSchema.safeParse({ bio: 'hello' }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ bio: 'x'.repeat(301) }).success).toBe(false);
  });
  it('lowercases username and enforces the format', () => {
    const ok = updateProfileSchema.safeParse({ username: 'John_Doe' });
    expect(ok.success && ok.data.username).toBe('john_doe');
    expect(updateProfileSchema.safeParse({ username: 'ab' }).success).toBe(false);
  });
});

describe('inviteMemberSchema', () => {
  it('accepts a username and defaults role to member', () => {
    const ok = inviteMemberSchema.safeParse({ username: 'mikita' });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.role).toBe('member');
  });

  it('accepts an explicit owner role', () => {
    const ok = inviteMemberSchema.safeParse({ username: 'mikita', role: 'owner' });
    expect(ok.success && ok.data.role).toBe('owner');
  });

  // The admin tier is gone: a wishlist has owners and members, nothing between.
  it('rejects the retired admin role', () => {
    expect(inviteMemberSchema.safeParse({ username: 'mikita', role: 'admin' }).success).toBe(false);
  });

  // Regression: invites are registered-users-only now. Email must be required as
  // username and NOT accepted as an invite target.
  it('regression: requires username; email alone is rejected', () => {
    expect(inviteMemberSchema.safeParse({}).success).toBe(false);
    expect(inviteMemberSchema.safeParse({ email: 'someone@example.com' }).success).toBe(false);
  });
});

describe('createItemSchema', () => {
  it('requires a name and defaults status to available', () => {
    const ok = createItemSchema.safeParse({ name: 'Toy' });
    expect(ok.success && ok.data.status).toBe('available');
  });
  it('validates the price object (integer cents, currency)', () => {
    expect(
      createItemSchema.safeParse({ name: 'x', price: { value: 999, currency: 'USD' } }).success
    ).toBe(true);
    expect(
      createItemSchema.safeParse({ name: 'x', price: { value: 9.99, currency: 'usd' } }).success
    ).toBe(false); // non-integer cents
  });

  // regression: the create schema accepted `booked` / `completed`, so a create
  // could make an item that is already booked with no Reservation behind it.
  it('regression: only allows draft, available and proposed as a status', () => {
    for (const status of ['draft', 'available', 'proposed']) {
      expect(createItemSchema.safeParse({ name: 'Toy', status }).success).toBe(true);
    }
    for (const status of ['booked', 'completed', 'bogus']) {
      expect(createItemSchema.safeParse({ name: 'Toy', status }).success).toBe(false);
    }
  });

  // regression: the create schema passed `bookedBy` through to the route, which
  // stored it as given.
  it('regression: drops a client-sent bookedBy', () => {
    const parsed = createItemSchema.safeParse({ name: 'Toy', bookedBy: 'someone' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'bookedBy' in parsed.data).toBe(false);
  });

  // regression: the create schema accepted a `proposedBy` the route ignores (it
  // sets the proposer from the session), a dead client-controlled field.
  it('regression: drops a client-sent proposedBy', () => {
    const parsed = createItemSchema.safeParse({
      name: 'Toy',
      status: 'proposed',
      proposedBy: 'someone',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'proposedBy' in parsed.data).toBe(false);
  });
});

describe('mostWanted on the item schemas', () => {
  it('is optional on create and accepts a boolean', () => {
    const omitted = createItemSchema.safeParse({ name: 'Toy' });
    expect(omitted.success && omitted.data.mostWanted).toBeUndefined();
    const set = createItemSchema.safeParse({ name: 'Toy', mostWanted: true });
    expect(set.success && set.data.mostWanted).toBe(true);
  });

  it('rejects a non-boolean value', () => {
    for (const mostWanted of ['true', 1, null]) {
      expect(createItemSchema.safeParse({ name: 'Toy', mostWanted }).success).toBe(false);
      expect(updateItemSchema.safeParse({ mostWanted }).success).toBe(false);
    }
  });

  it('counts as the one field an update needs, including false', () => {
    const cleared = updateItemSchema.safeParse({ mostWanted: false });
    expect(cleared.success && cleared.data.mostWanted).toBe(false);
  });
});

describe('updateItemSchema', () => {
  it('requires at least one field', () => {
    expect(updateItemSchema.safeParse({}).success).toBe(false);
  });

  // Regression: the item-coupled `gifted` flag was removed (gifting moved to the
  // Reservation/GiftLog flow). It must not survive parsing as a recognised field.
  it('regression: does not accept a `gifted` field', () => {
    const res = updateItemSchema.safeParse({ status: 'available', gifted: true });
    expect(res.success).toBe(true);
    expect(res.success && res.data).not.toHaveProperty('gifted');
  });

  // regression: the update schema passed `bookedBy` through, and the owner branch
  // stored it as given: a booking with no Reservation behind it.
  it('regression: drops a client-sent bookedBy and proposedBy', () => {
    const res = updateItemSchema.safeParse({ name: 'Toy', bookedBy: 'a', proposedBy: 'b' });
    expect(res.success).toBe(true);
    expect(res.success && res.data).toEqual({ name: 'Toy' });
    // With nothing else, there's no field left to update.
    expect(updateItemSchema.safeParse({ bookedBy: 'a' }).success).toBe(false);
    expect(updateItemSchema.safeParse({ bookedBy: null }).success).toBe(false);
  });
});
