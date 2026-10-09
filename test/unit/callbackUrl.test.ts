import { describe, it, expect } from 'vitest';
import {
  AUTH_ONLY_PATHS,
  CALLBACK_URL_MAX,
  isAuthOnlyPath,
  safeCallbackPath,
  signInPath,
  SIGN_IN_PATH,
} from '@/lib/utils/callbackUrl';

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

  // What the sign-in page passes for a signed-in visitor: every auth page.
  it('refuses anything under a section passed as the path to avoid', () => {
    for (const authPage of ['/auth/signin?callbackUrl=%2Finvites', '/auth/error', '/auth']) {
      expect(safeCallbackPath(authPage, ORIGIN, '/auth'), authPage).toBe('/');
    }
    expect(safeCallbackPath('/authors', ORIGIN, '/auth')).toBe('/authors');
  });
});

describe('signInPath', () => {
  it('sends to the sign-in page with the path as its encoded callbackUrl', () => {
    expect(signInPath('/notifications')).toBe('/auth/signin?callbackUrl=%2Fnotifications');
    expect(signInPath('/wishlists/mine')).toBe('/auth/signin?callbackUrl=%2Fwishlists%2Fmine');
  });

  it('round-trips: the sign-in page reads back the same path, and continues to it', () => {
    for (const path of AUTH_ONLY_PATHS) {
      const url = new URL(signInPath(path), ORIGIN);
      expect(url.pathname).toBe(SIGN_IN_PATH);
      expect([...url.searchParams.keys()]).toEqual(['callbackUrl']);
      expect(url.searchParams.get('callbackUrl')).toBe(path);
      expect(safeCallbackPath(url.searchParams.get('callbackUrl'), ORIGIN, '/auth')).toBe(path);
    }
  });
});

describe('signInPath with a fragment', () => {
  const FRAGMENT =
    '#name=Mug&price=9.99&currency=EUR&link=https%3A%2F%2Fshop.example.com%2Fp%3Fa%3D1';
  const continuesTo = (hash: string) => {
    const url = new URL(signInPath('/items/new', hash), ORIGIN);
    return safeCallbackPath(url.searchParams.get('callbackUrl'), ORIGIN, '/auth');
  };

  it('keeps the fragment in the callback, and the sign-in page continues to it intact', () => {
    expect(signInPath('/items/new', FRAGMENT)).toBe(
      `/auth/signin?callbackUrl=${encodeURIComponent(`/items/new${FRAGMENT}`)}`
    );
    expect(continuesTo(FRAGMENT)).toBe(`/items/new${FRAGMENT}`);
  });

  it('is the old path without a fragment, or with an empty one', () => {
    expect(signInPath('/items/new')).toBe('/auth/signin?callbackUrl=%2Fitems%2Fnew');
    expect(signInPath('/items/new', '')).toBe(signInPath('/items/new'));
    expect(signInPath('/items/new', '#')).toBe(signInPath('/items/new'));
  });

  // The fragment is attacker-controlled (anyone can link to /items/new#…); it is
  // only ever appended to a fixed path, so it can't move the callback off the site.
  it('cannot escape the origin, whatever the fragment says', () => {
    for (const hash of [
      '#//evil.example/phish',
      '#https://evil.example/',
      '#@evil.example',
      '#/\\evil.example',
      '#\\\\evil.example',
      '#javascript:alert(1)',
      '#name=x&link=https://evil.example',
      '#%0d%0aLocation:%20https://evil.example',
    ]) {
      const callback = new URL(signInPath('/items/new', hash), ORIGIN).searchParams.get(
        'callbackUrl'
      );
      expect(callback?.startsWith('/items/new#'), hash).toBe(true);
      const target = safeCallbackPath(callback, ORIGIN, '/auth');
      expect(new URL(target, ORIGIN).origin, hash).toBe(ORIGIN);
      expect(new URL(target, ORIGIN).pathname, hash).toBe('/items/new');
    }
  });

  it('ignores a "hash" that is not a fragment', () => {
    expect(signInPath('/items/new', 'https://evil.example/')).toBe(signInPath('/items/new'));
    expect(signInPath('/items/new', '//evil.example')).toBe(signInPath('/items/new'));
  });

  it('drops a fragment that would make the callback too long for the sign-in form', () => {
    const huge = `#name=${'x'.repeat(CALLBACK_URL_MAX)}`;
    expect(signInPath('/items/new', huge)).toBe(signInPath('/items/new'));
    const fits = `#name=${'x'.repeat(CALLBACK_URL_MAX - '/items/new#name='.length)}`;
    expect(signInPath('/items/new', fits)).toContain('xxxx');
  });
});

describe('safeCallbackPath with a hostile callbackUrl on the add-from-link page', () => {
  it('keeps the page’s own fragment, and nothing that leaves the site', () => {
    expect(safeCallbackPath('/items/new#name=Mug', ORIGIN, '/auth')).toBe('/items/new#name=Mug');
    expect(safeCallbackPath(`${ORIGIN}/items/new#name=Mug`, ORIGIN, '/auth')).toBe(
      '/items/new#name=Mug'
    );
    for (const hostile of [
      'https://evil.example/items/new#name=Mug',
      '//evil.example/items/new#name=Mug',
      '/\\evil.example#name=Mug',
      '/items/new#',
      `${ORIGIN}//evil.example#name=Mug`,
      'javascript:alert(1)//#/items/new',
    ]) {
      const target = safeCallbackPath(hostile, ORIGIN, '/auth');
      expect(new URL(target, ORIGIN).origin, hostile).toBe(ORIGIN);
    }
    expect(safeCallbackPath('https://evil.example/items/new#name=Mug', ORIGIN)).toBe('/');
    expect(safeCallbackPath(`${ORIGIN}//evil.example#name=Mug`, ORIGIN)).toBe('/');
  });
});

describe('isAuthOnlyPath', () => {
  it('matches each page that needs an account', () => {
    for (const path of AUTH_ONLY_PATHS) expect(isAuthOnlyPath(path), path).toBe(true);
  });

  it('matches nothing else: not a public page, a longer path, or a prefix', () => {
    for (const path of [
      '/',
      '/wishlists/abc123',
      '/users/alice',
      '/items/x',
      '/items/new/',
      '/wishlists/mine-too',
      '/wishlists',
      '/auth/signin',
      '/welcome',
      '',
    ]) {
      expect(isAuthOnlyPath(path), path).toBe(false);
    }
  });
});
