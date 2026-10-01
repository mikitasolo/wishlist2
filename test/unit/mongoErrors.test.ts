import { describe, it, expect } from 'vitest';
import { duplicateKeyField, isDuplicateKeyError } from '@/lib/utils/mongoErrors';

const duplicate = (keyPattern?: Record<string, number>) =>
  Object.assign(new Error('E11000 duplicate key error'), { code: 11000, keyPattern });

describe('isDuplicateKeyError', () => {
  it('recognises MongoDB’s duplicate-key error by its code', () => {
    expect(isDuplicateKeyError(duplicate({ email: 1 }))).toBe(true);
    expect(isDuplicateKeyError({ code: 11000 })).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isDuplicateKeyError(new Error('connection refused'))).toBe(false);
    expect(isDuplicateKeyError({ code: 11001 })).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError('E11000')).toBe(false);
  });
});

describe('duplicateKeyField', () => {
  it('names the index field the error tripped', () => {
    expect(duplicateKeyField(duplicate({ email: 1 }))).toBe('email');
    expect(duplicateKeyField(duplicate({ username: 1 }))).toBe('username');
  });

  it('says only "key" when the error doesn’t say which', () => {
    expect(duplicateKeyField(duplicate())).toBe('key');
    expect(duplicateKeyField(duplicate({}))).toBe('key');
  });

  it('is null for any other error', () => {
    expect(duplicateKeyField(new Error('connection refused'))).toBeNull();
    expect(duplicateKeyField(undefined)).toBeNull();
  });
});
