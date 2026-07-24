import { describe, it, expect } from 'vitest';
import {
  WISHLIST_SLUG_REGEX,
  isReservedWishlistSlug,
  slugifyName,
} from '@/lib/utils/wishlistSlug';

describe('WISHLIST_SLUG_REGEX', () => {
  it('accepts lowercase alphanumeric words joined by single hyphens', () => {
    expect(WISHLIST_SLUG_REGEX.test('my-birthday-2024')).toBe(true);
    expect(WISHLIST_SLUG_REGEX.test('list')).toBe(true);
  });
  it('rejects leading/trailing/double hyphens, uppercase, and spaces', () => {
    expect(WISHLIST_SLUG_REGEX.test('-nope')).toBe(false);
    expect(WISHLIST_SLUG_REGEX.test('nope-')).toBe(false);
    expect(WISHLIST_SLUG_REGEX.test('a--b')).toBe(false);
    expect(WISHLIST_SLUG_REGEX.test('Upper')).toBe(false);
    expect(WISHLIST_SLUG_REGEX.test('with space')).toBe(false);
  });
});

describe('isReservedWishlistSlug', () => {
  it('reserves route-colliding words (case-insensitive)', () => {
    expect(isReservedWishlistSlug('new')).toBe(true);
    expect(isReservedWishlistSlug('MINE')).toBe(true);
    expect(isReservedWishlistSlug('shared')).toBe(true);
  });
  it('allows normal slugs', () => {
    expect(isReservedWishlistSlug('birthday')).toBe(false);
  });
});

describe('slugifyName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyName('My Birthday List')).toBe('my-birthday-list');
  });
  it('strips accents and punctuation', () => {
    expect(slugifyName('Café & Crème!!!')).toBe('cafe-creme');
  });
  it('trims leading/trailing separators', () => {
    expect(slugifyName('  --Hello--  ')).toBe('hello');
  });
  it('caps length at 40 chars with no trailing hyphen', () => {
    const out = slugifyName('a'.repeat(100));
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('-')).toBe(false);
  });
  it('produces a slug that satisfies the slug regex', () => {
    expect(WISHLIST_SLUG_REGEX.test(slugifyName('Weird   Name 123'))).toBe(true);
  });
});
