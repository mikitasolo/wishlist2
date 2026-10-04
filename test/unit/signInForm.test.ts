import { describe, it, expect } from 'vitest';
import {
  emailInputError,
  signInDestination,
  signInRetryPath,
  signInSubtitle,
} from '@/lib/utils/signInForm';

const ORIGIN = 'http://localhost:3000';

describe('signInDestination', () => {
  it.each([
    ['/wishlists/abc123', 'wishlist'],
    ['/wishlists/birthday-2026?show=available', 'wishlist'],
    [`${ORIGIN}/wishlists/abc123`, 'wishlist'],
    ['/users/anna', 'profile'],
    ['/wishlists/mine', null],
    ['/wishlists/shared', null],
    ['/wishlists/abc/edit', null],
    ['/notifications', null],
    ['/', null],
    ['', null],
    [undefined, null],
    // Off-site, or back into sign-in: nowhere to mention.
    ['https://evil.example/wishlists/abc', null],
    ['//evil.example/wishlists/abc', null],
    ['/auth/signin?callbackUrl=%2Fwishlists%2Fabc', null],
  ] as const)('%s → %s', (raw, expected) => {
    expect(signInDestination(raw, ORIGIN)).toBe(expected);
  });

  it('keeps the subtitle generic: no list or person is named', () => {
    expect(signInSubtitle(null)).toBe("We'll email you a link — no password.");
    expect(signInSubtitle('wishlist')).toBe(
      "We'll email you a link to continue to the wishlist you opened — no password."
    );
    expect(signInSubtitle('profile')).toBe(
      "We'll email you a link to continue to the profile you opened — no password."
    );
  });
});

describe('signInRetryPath', () => {
  // regression: the error page's Try again dropped the callbackUrl, so someone
  // whose link came from a shared list landed on the dashboard instead.
  it('keeps a callbackUrl on this site', () => {
    expect(signInRetryPath('/wishlists/abc?show=available', ORIGIN)).toBe(
      '/auth/signin?callbackUrl=%2Fwishlists%2Fabc%3Fshow%3Davailable'
    );
    expect(signInRetryPath(`${ORIGIN}/users/anna`, ORIGIN)).toBe(
      '/auth/signin?callbackUrl=%2Fusers%2Fanna'
    );
  });

  it.each([
    'https://evil.example/phish',
    '//evil.example',
    'javascript:alert(1)',
    '/auth/signin',
    '/',
    '',
    undefined,
  ])('drops %s', (raw) => {
    expect(signInRetryPath(raw, ORIGIN)).toBe('/auth/signin');
  });
});

describe('emailInputError', () => {
  it('asks for an address when there is none', () => {
    expect(emailInputError('')).toBe('Enter your email address');
    expect(emailInputError('   ')).toBe('Enter your email address');
  });

  it.each(['me', 'me@', '@example.com', 'me@example', 'me @example.com'])('refuses %s', (value) => {
    expect(emailInputError(value)).toBe('Enter an email address like you@example.com');
  });

  it.each(['me@example.com', '  me@example.com  ', 'first.last+tag@sub.example.co.uk'])(
    'accepts %s',
    (value) => {
      expect(emailInputError(value)).toBeNull();
    }
  );
});
