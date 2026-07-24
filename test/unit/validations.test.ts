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

  it('accepts an explicit admin role', () => {
    const ok = inviteMemberSchema.safeParse({ username: 'mikita', role: 'admin' });
    expect(ok.success && ok.data.role).toBe('admin');
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
});
