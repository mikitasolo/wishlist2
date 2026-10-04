import { describe, it, expect } from 'vitest';
import {
  isIdempotencyKeyClash,
  readIdempotencyKey,
  scopedIdempotencyKey,
} from '@/lib/utils/itemIdempotency';
import { createSubmissionKeys } from '@/lib/utils/submissionKey';

describe('createSubmissionKeys', () => {
  it('keeps a key across retries of the same fields', () => {
    const keys = createSubmissionKeys();
    const key = keys.keyFor({ name: 'Bike' });
    expect(keys.keyFor({ name: 'Bike' })).toBe(key);
    // A key the server takes.
    expect(readIdempotencyKey(new Headers({ 'Idempotency-Key': key }))).toBe(key);
  });

  it('gives edited fields a new key: an edit after a timeout is a new submission', () => {
    const keys = createSubmissionKeys();
    const key = keys.keyFor({ name: 'Bike' });
    expect(keys.keyFor({ name: 'Red bike' })).not.toBe(key);
  });

  it('starts afresh after a reset (a save, or the dialog closing)', () => {
    const keys = createSubmissionKeys();
    const key = keys.keyFor({ name: 'Bike' });
    keys.reset();
    expect(keys.keyFor({ name: 'Bike' })).not.toBe(key);
  });
});

describe('readIdempotencyKey', () => {
  it('is null without the header, and undefined for one that is not a key', () => {
    expect(readIdempotencyKey(new Headers())).toBeNull();
    expect(readIdempotencyKey(new Headers({ 'Idempotency-Key': 'short' }))).toBeUndefined();
    expect(
      readIdempotencyKey(new Headers({ 'Idempotency-Key': 'has spaces in it, sixteen+' }))
    ).toBeUndefined();
    expect(readIdempotencyKey(new Headers({ 'Idempotency-Key': 'x'.repeat(129) }))).toBeUndefined();
  });
});

describe('scopedIdempotencyKey', () => {
  it('differs per sender for one key, and is stable for one sender', () => {
    const key = '3f1c2a9e-4b7d-4e2a-9c1f-8d6b5a4e3c2b';
    expect(scopedIdempotencyKey('a', key)).toBe(scopedIdempotencyKey('a', key));
    expect(scopedIdempotencyKey('a', key)).not.toBe(scopedIdempotencyKey('b', key));
    expect(scopedIdempotencyKey('a', key)).not.toContain(key);
  });
});

describe('isIdempotencyKeyClash', () => {
  it("only matches the key index's duplicate-key error", () => {
    expect(
      isIdempotencyKeyClash({ code: 11000, keyPattern: { wishlist: 1, idempotencyKey: 1 } })
    ).toBe(true);
    expect(isIdempotencyKeyClash({ code: 11000, keyPattern: { slug: 1 } })).toBe(false);
    expect(isIdempotencyKeyClash(new Error('boom'))).toBe(false);
    expect(isIdempotencyKeyClash(null)).toBe(false);
  });
});
