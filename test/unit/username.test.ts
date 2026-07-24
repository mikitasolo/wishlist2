import { describe, it, expect } from 'vitest';
import { USERNAME_REGEX, isReservedUsername } from '@/lib/utils/username';

describe('USERNAME_REGEX', () => {
  it('accepts 3–20 chars starting with a letter', () => {
    expect(USERNAME_REGEX.test('abc')).toBe(true);
    expect(USERNAME_REGEX.test('john_doe99')).toBe(true);
    expect(USERNAME_REGEX.test('a'.repeat(20))).toBe(true);
  });
  it('rejects too-short, too-long, digit-leading, or bad chars', () => {
    expect(USERNAME_REGEX.test('ab')).toBe(false); // < 3
    expect(USERNAME_REGEX.test('a'.repeat(21))).toBe(false); // > 20
    expect(USERNAME_REGEX.test('1abc')).toBe(false); // starts with digit
    expect(USERNAME_REGEX.test('John')).toBe(false); // uppercase
    expect(USERNAME_REGEX.test('a-b')).toBe(false); // hyphen not allowed
  });
});

describe('isReservedUsername', () => {
  it('reserves system words (case-insensitive)', () => {
    expect(isReservedUsername('admin')).toBe(true);
    expect(isReservedUsername('ME')).toBe(true);
    expect(isReservedUsername('settings')).toBe(true);
  });
  it('allows normal names', () => {
    expect(isReservedUsername('mikita')).toBe(false);
  });
});
