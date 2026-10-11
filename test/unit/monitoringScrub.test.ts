import { describe, it, expect } from 'vitest';
import {
  FILTERED,
  scrubBreadcrumb,
  scrubEvent,
  scrubPath,
  scrubString,
  scrubUrl,
} from '@/lib/monitoring/scrub';

// WIS-381: every error report leaves through this scrub (beforeSend /
// beforeBreadcrumb on the server and in the browser). One test per way a
// person's data or a credential could reach Sentry.

const TOKEN = 'aB3dE5gH7jK9mN1pQ3sT5v'; // 22 base62, a share token's shape
const USER_ID = '64b7f0c2a1d3e4f5a6b7c8d9';
const MAGIC_LINK =
  'https://wishlist.example/api/auth/callback/nodemailer?callbackUrl=%2Fl%2F' +
  TOKEN +
  '&token=9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08&email=ann%40example.com';

describe('scrubString', () => {
  it('takes out email addresses', () => {
    expect(scrubString('No account for ann.lee+gifts@example.co.uk, sorry')).toBe(
      `No account for ${FILTERED}, sorry`
    );
  });

  it('takes out a share token from a /l/ path or URL', () => {
    expect(scrubString(`Failed to load /l/${TOKEN}`)).toBe('Failed to load /l/[token]');
    expect(scrubString(`at https://wishlist.example/l/${TOKEN}/`)).toBe(
      'at https://wishlist.example/l/[token]/'
    );
  });

  it('takes out a share-token-shaped word on its own', () => {
    expect(scrubString(`resolveShareLink(${TOKEN}) failed`)).toBe(
      'resolveShareLink([token]) failed'
    );
  });

  // regression (review): a 22-character base62 token has no digit about 2% of
  // the time, and was let through.
  it('takes out a share-token-shaped word with no digit', () => {
    expect(scrubString('token AbCdEfGhIjKlMnOpQrStUv seen')).toBe('token [token] seen');
  });

  it('takes out the whole query of a magic link (token, email, callback)', () => {
    const out = scrubString(`fetch failed: ${MAGIC_LINK}`);
    expect(out).toBe('fetch failed: https://wishlist.example/api/auth/callback/nodemailer');
    expect(out).not.toContain('token=');
    expect(out).not.toContain('example.com');
  });

  it('takes out token= / email= pairs outside a URL', () => {
    expect(scrubString('bad params token=abc123 email=ann')).toBe(
      `bad params token=${FILTERED} email=${FILTERED}`
    );
  });

  it('takes out a username from a profile path', () => {
    expect(scrubString('GET /users/annlee 500')).toBe('GET /users/[username] 500');
    expect(scrubString('GET /api/users/by-username/annlee')).toBe(
      'GET /api/users/by-username/[username]'
    );
    expect(scrubString('GET /api/users/annlee/wishlists')).toBe('GET /api/users/[id]/wishlists');
  });

  // regression (review): the list API takes a list's slug as its id, which
  // can name a person ("annas-40th-birthday").
  it('takes out a list’s id or slug from a list path', () => {
    expect(scrubString('GET /api/wishlists/annas-40th-birthday/items')).toBe(
      'GET /api/wishlists/[id]/items'
    );
    expect(scrubString('GET /wishlists/annas-40th-birthday')).toBe('GET /wishlists/[id]');
  });

  it('keeps the routes that name nobody', () => {
    expect(scrubString('GET /api/users/me/groups')).toBe('GET /api/users/me/groups');
    expect(scrubString('GET /wishlists/mine')).toBe('GET /wishlists/mine');
  });

  it('takes out record ids (a user id is one)', () => {
    expect(scrubString(`Cast to ObjectId failed for value "${USER_ID}"`)).toBe(
      'Cast to ObjectId failed for value "[id]"'
    );
    expect(scrubString(`/api/wishlists/${USER_ID}/members/${USER_ID}`)).toBe(
      '/api/wishlists/[id]/members/[id]'
    );
  });

  it('takes out the value a duplicate-key error quotes', () => {
    expect(
      scrubString(
        'E11000 duplicate key error collection: test.users index: username_1 dup key: { username: "annlee" }'
      )
    ).toBe(
      `E11000 duplicate key error collection: test.users index: username_1 dup key: ${FILTERED}`
    );
  });

  it('leaves ordinary messages alone', () => {
    const msg = "Cannot read properties of undefined (reading 'price')";
    expect(scrubString(msg)).toBe(msg);
  });
});

describe('scrubUrl / scrubPath', () => {
  it('drops query and fragment, keeps the origin', () => {
    expect(scrubUrl('https://wishlist.example/unsubscribe?u=1&sig=abc#x')).toBe(
      'https://wishlist.example/unsubscribe'
    );
  });

  it('is idempotent', () => {
    const once = scrubUrl(`https://wishlist.example/l/${TOKEN}?a=1`);
    expect(scrubUrl(once)).toBe(once);
    expect(scrubPath('/l/[token]')).toBe('/l/[token]');
  });
});

describe('scrubEvent', () => {
  // The request the server SDK records from Next's onRequestError, and the one
  // the browser SDK records from the page: every header (the session cookie,
  // X-Share-Token, Authorization, a Referer naming a /l/ link), the body, the
  // query and the cookies.
  const request = {
    url: `https://wishlist.example/l/${TOKEN}?ref=ann%40example.com`,
    method: 'GET',
    headers: {
      Cookie: 'authjs.session-token=secret',
      'x-share-token': TOKEN,
      authorization: 'Bearer secret',
      Referer: `https://wishlist.example/l/${TOKEN}`,
      'User-Agent': 'Mozilla/5.0',
    },
    cookies: { 'authjs.session-token': 'secret' },
    data: { email: 'ann@example.com', name: 'Ann Lee' },
    query_string: 'ref=ann@example.com',
    env: { REMOTE_ADDR: '1.2.3.4' },
  };

  it('keeps only the scrubbed URL, the method and the user agent of the request', () => {
    const out = scrubEvent({ request });
    expect(out.request).toEqual({
      url: 'https://wishlist.example/l/[token]',
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(JSON.stringify(out)).not.toContain('secret');
    expect(JSON.stringify(out)).not.toContain('example.com');
  });

  it('drops the user', () => {
    const out = scrubEvent({ user: { id: USER_ID, email: 'ann@example.com', username: 'annlee' } });
    expect(out).not.toHaveProperty('user');
  });

  it('scrubs the message, the exception values and the transaction', () => {
    const out = scrubEvent({
      message: 'Invite for ann@example.com failed',
      transaction: `GET /l/${TOKEN}`,
      exception: { values: [{ type: 'Error', value: `No list at /l/${TOKEN}` }] },
    });
    expect(out.message).toBe(`Invite for ${FILTERED} failed`);
    expect(out.transaction).toBe('GET /l/[token]');
    expect(out.exception?.values?.[0].value).toBe('No list at /l/[token]');
  });

  it('drops stack frames’ local variables but keeps the frames', () => {
    const out = scrubEvent({
      exception: {
        values: [
          {
            type: 'Error',
            value: 'x',
            stacktrace: { frames: [{ vars: { email: 'ann@example.com' } }] },
          },
        ],
      },
    });
    expect(out.exception?.values?.[0].stacktrace?.frames).toEqual([{}]);
  });

  // regression (review): a frame of code inline in the page names the page's
  // own URL, query and all (an email, an unsubscribe signature, a /l/ token).
  it('scrubs a frame’s file URL, and leaves chunk and server paths alone', () => {
    const frames = [
      { filename: `https://wishlist.example/l/${TOKEN}?email=ann%40example.com`, lineno: 1 },
      { abs_path: 'https://wishlist.example/unsubscribe?sig=abc', lineno: 2 },
      { filename: 'https://wishlist.example/_next/static/chunks/37i90vczayg3y.js', lineno: 3 },
      { filename: '/var/task/.next/server/chunks/ssr/app_l_[token]_page.js', lineno: 4 },
      { filename: '<anonymous>', lineno: 5 },
    ];
    const out = scrubEvent({
      exception: { values: [{ type: 'Error', value: 'x', stacktrace: { frames } }] },
    });
    expect(out.exception?.values?.[0].stacktrace?.frames).toEqual([
      { filename: 'https://wishlist.example/l/[token]', lineno: 1 },
      { abs_path: 'https://wishlist.example/unsubscribe', lineno: 2 },
      frames[2],
      frames[3],
      frames[4],
    ]);
  });

  it('scrubs a console.error captured with its arguments', () => {
    const out = scrubEvent({
      logentry: { message: 'Error inviting %s', params: ['ann@example.com'] },
      extra: { arguments: ['Error inviting', 'ann@example.com', { username: 'annlee' }] },
    });
    expect(out.logentry).toEqual({ message: 'Error inviting %s', params: [FILTERED] });
    expect(out.extra).toEqual({ arguments: ['Error inviting', FILTERED, { username: FILTERED }] });
  });

  it('scrubs Next’s request context (its path can be a /l/ link)', () => {
    const out = scrubEvent({
      contexts: {
        nextjs: { request_path: `/l/${TOKEN}`, router_path: '/l/[token]' },
        os: { name: 'Linux' },
        trace: { trace_id: '0123456789abcdef0123456789abcdef' },
      },
    });
    expect(out.contexts).toEqual({
      nextjs: { request_path: '/l/[token]', router_path: '/l/[token]' },
      os: { name: 'Linux' },
      trace: { trace_id: '0123456789abcdef0123456789abcdef' },
    });
  });

  it('scrubs tags and extra by key and value', () => {
    const out = scrubEvent({
      tags: { url: `/users/annlee`, username: 'annlee' },
      extra: { email: 'a@b.co', note: 'see ann@example.com', nested: { displayName: 'Ann' } },
    });
    expect(out.tags).toEqual({ url: '/users/[username]', username: FILTERED });
    expect(out.extra).toEqual({
      email: FILTERED,
      note: `see ${FILTERED}`,
      nested: { displayName: FILTERED },
    });
  });

  it('scrubs the breadcrumbs it carries', () => {
    const out = scrubEvent({
      breadcrumbs: [
        { category: 'ui.click', message: 'img[alt="Ann Lee"]' },
        { category: 'navigation', data: { from: `/l/${TOKEN}`, to: '/users/annlee' } },
      ],
    });
    expect(out.breadcrumbs).toEqual([
      { category: 'navigation', data: { from: '/l/[token]', to: '/users/[username]' } },
    ]);
  });

  it('leaves the original event untouched', () => {
    const event = { user: { id: '1' }, request: { ...request } };
    scrubEvent(event);
    expect(event.user).toEqual({ id: '1' });
    expect(event.request.headers).toBe(request.headers);
  });
});

describe('scrubBreadcrumb', () => {
  it('drops DOM breadcrumbs (a selector can carry a person’s name)', () => {
    expect(scrubBreadcrumb({ category: 'ui.click', message: 'img[alt="Ann Lee"]' })).toBeNull();
    expect(scrubBreadcrumb({ category: 'ui.input', message: 'input[name="email"]' })).toBeNull();
  });

  it('scrubs a fetch breadcrumb’s URL (a magic link, a share link)', () => {
    expect(
      scrubBreadcrumb({
        category: 'fetch',
        data: { method: 'GET', url: MAGIC_LINK, status_code: 200 },
      })
    ).toEqual({
      category: 'fetch',
      data: {
        method: 'GET',
        url: 'https://wishlist.example/api/auth/callback/nodemailer',
        status_code: 200,
      },
    });
    expect(
      scrubBreadcrumb({ category: 'xhr', data: { url: `/api/wishlists/${USER_ID}?shareToken=x` } })
    ).toEqual({ category: 'xhr', data: { url: '/api/wishlists/[id]' } });
  });

  it('scrubs a navigation breadcrumb’s from / to (a referrer-like trail)', () => {
    expect(
      scrubBreadcrumb({
        category: 'navigation',
        data: { from: `https://wishlist.example/l/${TOKEN}`, to: '/auth/signin?email=a%40b.co' },
      })
    ).toEqual({
      category: 'navigation',
      data: { from: 'https://wishlist.example/l/[token]', to: '/auth/signin' },
    });
  });

  it('keeps a console breadcrumb’s scrubbed message, never its raw arguments', () => {
    expect(
      scrubBreadcrumb({
        category: 'console',
        message: 'Error updating item: ann@example.com',
        data: {
          arguments: ['Error updating item:', { email: 'ann@example.com' }],
          logger: 'console',
        },
      })
    ).toEqual({ category: 'console', message: `Error updating item: ${FILTERED}` });
  });

  it('takes a whole value out under a personal key in its data', () => {
    expect(
      scrubBreadcrumb({ category: 'custom', data: { email: 'x', token: 'y', cookie: 'z', ok: 1 } })
    ).toEqual({
      category: 'custom',
      data: { email: FILTERED, token: FILTERED, cookie: FILTERED, ok: 1 },
    });
  });
});
