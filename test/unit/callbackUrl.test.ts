import { describe, it, expect } from 'vitest';
import { safeCallbackPath } from '@/lib/utils/callbackUrl';

const ORIGIN = 'https://wishlist.example';

describe('safeCallbackPath', () => {
  it('keeps a same-site relative path, with its query and hash', () => {
    expect(safeCallbackPath('/invites', ORIGIN)).toBe('/invites');
    expect(safeCallbackPath('/wishlists/abc?tab=items#top', ORIGIN)).toBe(
      '/wishlists/abc?tab=items#top'
    );
  });

  // What Auth.js passes to pages.newUser: the callback URL it already resolved
  // against the site's origin.
  it('turns an absolute same-origin URL into its path', () => {
    expect(safeCallbackPath(`${ORIGIN}/invites`, ORIGIN)).toBe('/invites');
    expect(safeCallbackPath(`${ORIGIN}/users/jane?x=1`, ORIGIN)).toBe('/users/jane?x=1');
    expect(safeCallbackPath(ORIGIN, ORIGIN)).toBe('/');
  });

  it('falls back to / without a callback URL', () => {
    expect(safeCallbackPath(null, ORIGIN)).toBe('/');
    expect(safeCallbackPath(undefined, ORIGIN)).toBe('/');
    expect(safeCallbackPath('', ORIGIN)).toBe('/');
  });

  it('falls back to / for a URL that doesn’t parse', () => {
    expect(safeCallbackPath('http://[', ORIGIN)).toBe('/');
  });

  it('refuses anything that would leave the site (no open redirect)', () => {
    for (const offsite of [
      'https://evil.example/phish',
      'http://wishlist.example/invites', // another scheme is another origin
      'https://wishlist.example.evil.example/',
      'https://wishlist.example@evil.example/',
      '//evil.example/phish',
      '/\\evil.example/phish',
      '\\\\evil.example',
      'javascript:alert(1)',
      'data:text/html,hi',
      // The default Auth.js redirect callback makes `//evil.example` into this:
      // same origin, but a path that reads as protocol-relative on its own.
      `${ORIGIN}//evil.example/phish`,
    ]) {
      expect(safeCallbackPath(offsite, ORIGIN), offsite).toBe('/');
    }
  });

  it('refuses the page that is redirecting, so it can’t loop', () => {
    expect(safeCallbackPath('/welcome', ORIGIN, '/welcome')).toBe('/');
    expect(safeCallbackPath(`${ORIGIN}/welcome?callbackUrl=%2Fwelcome`, ORIGIN, '/welcome')).toBe(
      '/'
    );
    expect(safeCallbackPath('/welcome/x', ORIGIN, '/welcome')).toBe('/');
    // Only that page, not every path that starts with its name.
    expect(safeCallbackPath('/welcomes', ORIGIN, '/welcome')).toBe('/welcomes');
  });
});
