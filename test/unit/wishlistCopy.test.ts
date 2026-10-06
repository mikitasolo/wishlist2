import { describe, it, expect } from 'vitest';
import {
  copiedStatus,
  isCopyableStatus,
  serializeCopyCandidate,
  startingCopyOccasion,
} from '@/lib/utils/wishlistCopy';
import { copyWishlistSchema } from '@/lib/validations';

describe('which items a new list can bring over (WIS-325)', () => {
  it('offers drafts and available items, and booked ones alike, never received ones or proposals', () => {
    expect(isCopyableStatus('draft')).toBe(true);
    expect(isCopyableStatus('available')).toBe(true);
    // Owners can't tell booked from available, so neither may the picker.
    expect(isCopyableStatus('booked')).toBe(true);
    expect(isCopyableStatus('completed')).toBe(false);
    expect(isCopyableStatus('proposed')).toBe(false);
  });

  it('keeps a draft a draft and makes everything else available', () => {
    expect(copiedStatus('draft')).toBe('draft');
    expect(copiedStatus('available')).toBe('available');
    expect(copiedStatus('booked')).toBe('available');
  });

  it('shapes a booked item exactly as an available one', () => {
    const base = { _id: 'abc', name: 'Mug', imageUrl: null, price: null, mostWanted: false };
    const booked = { ...base, status: 'booked', bookedBy: 'x', proposedBy: 'y' };
    expect(serializeCopyCandidate(booked)).toEqual(
      serializeCopyCandidate({ ...base, status: 'available' })
    );
    expect(serializeCopyCandidate(booked)).toEqual({ ...base, draft: false });
  });
});

describe('startingCopyOccasion', () => {
  it('keeps a yearly occasion and leaves a one-off one to pick', () => {
    const yearly = { kind: 'birthday', date: '2000-03-14', recurrence: 'yearly' } as const;
    expect(startingCopyOccasion(yearly)).toEqual(yearly);
    expect(
      startingCopyOccasion({ kind: 'wedding', date: '2026-06-01', recurrence: null })
    ).toBeNull();
    expect(startingCopyOccasion(null)).toBeNull();
    expect(startingCopyOccasion(undefined)).toBeNull();
  });
});

describe('copyWishlistSchema', () => {
  const id = 'AbCdEf0123456789abcdef01';

  it('dedupes picked ids and defaults to none', () => {
    expect(
      copyWishlistSchema.parse({
        name: ' Next ',
        visibility: 'private',
        itemIds: [id, id.toLowerCase()],
      })
    ).toEqual({ name: 'Next', visibility: 'private', itemIds: [id.toLowerCase()] });
    expect(copyWishlistSchema.parse({ name: 'Next', visibility: 'everyone' }).itemIds).toEqual([]);
  });

  it('refuses a blank name, an unknown visibility, a malformed id and too many items', () => {
    expect(copyWishlistSchema.safeParse({ name: ' ', visibility: 'everyone' }).success).toBe(false);
    expect(copyWishlistSchema.safeParse({ name: 'N', visibility: 'all' }).success).toBe(false);
    expect(
      copyWishlistSchema.safeParse({ name: 'N', visibility: 'everyone', itemIds: [{ $ne: 1 }] })
        .success
    ).toBe(false);
    expect(
      copyWishlistSchema.safeParse({
        name: 'N',
        visibility: 'everyone',
        itemIds: Array.from({ length: 101 }, (_, i) => i.toString(16).padStart(24, '0')),
      }).success
    ).toBe(false);
  });
});
