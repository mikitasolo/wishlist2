import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { isObjectIdParam } from '@/lib/utils/objectId';

describe('isObjectIdParam', () => {
  it('accepts a 24-character hex id, in either case', () => {
    const id = new mongoose.Types.ObjectId().toString();
    expect(isObjectIdParam(id)).toBe(true);
    expect(isObjectIdParam(id.toUpperCase())).toBe(true);
  });

  it('rejects anything else a URL segment can carry', () => {
    for (const param of [
      '',
      'not-an-id',
      '12345',
      'z'.repeat(24),
      'a'.repeat(23),
      'a'.repeat(25),
      // 12 characters: `mongoose.isValidObjectId` accepts these, but no id we
      // hand out has this shape.
      'abcdefghijkl',
      ` ${'a'.repeat(24)}`,
      'family-list',
    ]) {
      expect(isObjectIdParam(param)).toBe(false);
    }
  });
});
