import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { format } from 'node:util';

// The sign-in form's server action, against a mocked Auth.js `signIn` and a
// mocked `fetch` standing in for Cloudflare's siteverify: no network, no mail.
vi.mock('@/lib/auth', () => ({ signIn: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn() }));

import { signIn } from '@/lib/auth';
import { headers } from 'next/headers';
import { requestMagicLink } from '@/app/auth/signin/actions';
import { isVerifiedSignIn } from '@/lib/signInEmail';
import { SITEVERIFY_URL, TURNSTILE_VERIFY_TIMEOUT_MS } from '@/lib/turnstile';

const mockedSignIn = vi.mocked(signIn);
const mockedHeaders = vi.mocked(headers);
const fetchMock = vi.fn<typeof fetch>();

const EMAIL = 'Friend@Example.com';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const IP = '203.0.113.7';
const SECRET_KEY = 'secret-key-456';
// What Auth.js's server-side signIn returns with `redirect: false`.
const SENT_URL = 'http://localhost:3000/api/auth/verify-request?provider=nodemailer&type=email';
const FAILED_URL = 'http://localhost:3000/auth/error?error=Configuration';

function turnstileOn() {
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site-key-123');
  vi.stubEnv('TURNSTILE_SECRET_KEY', SECRET_KEY);
}

function siteverify(body: unknown, status = 200) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  );
}

let errorLog: ReturnType<typeof vi.spyOn>;
let warnLog: ReturnType<typeof vi.spyOn>;
const logged = () =>
  [...errorLog.mock.calls, ...warnLog.mock.calls]
    .map((args: unknown[]) => format(...args))
    .join('\n')
    .toLowerCase();

/** Whether `signIn` ran inside `asVerifiedSignIn`, so the send would go ahead. */
let signInVerified: boolean | null;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', undefined);
  vi.stubEnv('TURNSTILE_SECRET_KEY', undefined);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  mockedHeaders.mockReset();
  mockedHeaders.mockResolvedValue(
    new Headers({ 'x-forwarded-for': `${IP}, 10.0.0.1` }) as Awaited<ReturnType<typeof headers>>
  );
  signInVerified = null;
  mockedSignIn.mockReset();
  mockedSignIn.mockImplementation(async () => {
    signInVerified = isVerifiedSignIn();
    return SENT_URL;
  });
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function expectSent(callbackUrl = '/') {
  expect(mockedSignIn).toHaveBeenCalledTimes(1);
  expect(mockedSignIn).toHaveBeenCalledWith('nodemailer', {
    email: EMAIL,
    redirectTo: callbackUrl,
    redirect: false,
  });
  expect(signInVerified).toBe(true);
}

describe('requestMagicLink with Turnstile off (keys unset)', () => {
  it('skips the check and sends, keeping the callbackUrl', async () => {
    const result = await requestMagicLink({ email: EMAIL, callbackUrl: '/invites' });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expectSent('/invites');
  });

  it('defaults the callbackUrl to /', async () => {
    expect(await requestMagicLink({ email: EMAIL })).toEqual({ ok: true });
    expectSent('/');
  });

  // lib/env refuses a half config at startup; at request time it reads as off.
  it.each([
    ['only the secret', 'TURNSTILE_SECRET_KEY'],
    ['only the site key', 'NEXT_PUBLIC_TURNSTILE_SITE_KEY'],
  ])('skips the check with %s set', async (_label, name) => {
    vi.stubEnv(name, 'a-key');
    expect(await requestMagicLink({ email: EMAIL, turnstileToken: null })).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expectSent();
  });
});

describe('requestMagicLink with Turnstile on', () => {
  beforeEach(turnstileOn);

  it('sends when Cloudflare accepts the token, checking it first with the visitor IP', async () => {
    siteverify({ success: true, 'error-codes': [] });

    const result = await requestMagicLink({
      email: EMAIL,
      callbackUrl: '/invites',
      turnstileToken: TOKEN,
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(SITEVERIFY_URL);
    expect(Object.fromEntries(new URLSearchParams(init?.body as URLSearchParams))).toEqual({
      secret: SECRET_KEY,
      response: TOKEN,
      remoteip: IP,
    });
    expectSent('/invites');
    // The check ran before Auth.js did anything (account creation included).
    expect(fetchMock.mock.invocationCallOrder[0]!).toBeLessThan(
      mockedSignIn.mock.invocationCallOrder[0]!
    );
  });

  it('refuses an invalid token without sending', async () => {
    siteverify({ success: false, 'error-codes': ['invalid-input-response'] });

    const result = await requestMagicLink({ email: EMAIL, turnstileToken: TOKEN });

    expect(result).toEqual({ ok: false, error: 'challenge' });
    expect(mockedSignIn).not.toHaveBeenCalled();
  });

  it('refuses a spent token without sending', async () => {
    siteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] });
    expect(await requestMagicLink({ email: EMAIL, turnstileToken: TOKEN })).toEqual({
      ok: false,
      error: 'challenge',
    });
    expect(mockedSignIn).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
  ])('refuses a %s token without sending, once Cloudflare says so', async (_label, token) => {
    siteverify({ success: false, 'error-codes': ['missing-input-response'] });

    expect(await requestMagicLink({ email: EMAIL, turnstileToken: token })).toEqual({
      ok: false,
      error: 'challenge',
    });
    expect(mockedSignIn).not.toHaveBeenCalled();
  });

  // The form sends no token when Cloudflare's script couldn't load or run; if
  // Cloudflare is down for us too, that's an outage, and sign-in fails open.
  it('sends without a token when siteverify is down too', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    expect(await requestMagicLink({ email: EMAIL, turnstileToken: null })).toEqual({ ok: true });
    expectSent();
  });

  it('sends when siteverify is down, and logs it without the email, IP or token', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const result = await requestMagicLink({ email: EMAIL, turnstileToken: TOKEN });

    expect(result).toEqual({ ok: true });
    expectSent();
    expect(errorLog).toHaveBeenCalledWith(
      JSON.stringify({ event: 'turnstile_unavailable', reason: 'network' })
    );
    expect(logged()).not.toContain(EMAIL.toLowerCase());
    expect(logged()).not.toContain('friend');
    expect(logged()).not.toContain(IP);
    expect(logged()).not.toContain(TOKEN.toLowerCase());
  });

  it('sends when siteverify answers a 5xx', async () => {
    siteverify({}, 503);
    expect(await requestMagicLink({ email: EMAIL, turnstileToken: TOKEN })).toEqual({ ok: true });
    expectSent();
    expect(errorLog).toHaveBeenCalledWith(
      JSON.stringify({ event: 'turnstile_unavailable', reason: 'http_503' })
    );
  });

  it(`sends when siteverify hangs past ${TURNSTILE_VERIFY_TIMEOUT_MS} ms`, async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        })
    );

    const result = requestMagicLink({ email: EMAIL, turnstileToken: TOKEN });
    await vi.advanceTimersByTimeAsync(TURNSTILE_VERIFY_TIMEOUT_MS);

    expect(await result).toEqual({ ok: true });
    expectSent();
    expect(errorLog).toHaveBeenCalledWith(
      JSON.stringify({ event: 'turnstile_unavailable', reason: 'timeout' })
    );
  });

  it('leaves out remoteip when the request carries no client IP', async () => {
    mockedHeaders.mockResolvedValue(new Headers() as Awaited<ReturnType<typeof headers>>);
    siteverify({ success: true });

    expect(await requestMagicLink({ email: EMAIL, turnstileToken: TOKEN })).toEqual({ ok: true });
    const form = new URLSearchParams(fetchMock.mock.calls[0]![1]?.body as URLSearchParams);
    expect(form.has('remoteip')).toBe(false);
  });
});

describe('requestMagicLink: the send', () => {
  // Rate limited, SMTP down, a malformed address: Auth.js answers its error page.
  it('reports send_failed when Auth.js returns its error page', async () => {
    mockedSignIn.mockResolvedValue(FAILED_URL);
    expect(await requestMagicLink({ email: EMAIL })).toEqual({ ok: false, error: 'send_failed' });
  });

  // Only the verify-request page means sent: e.g. a caller adding
  // X-Auth-Return-Redirect gets Auth.js's JSON answer, and signIn falls back to
  // returning its own sign-in URL, whether or not anything went out.
  it('reports send_failed for any URL but the verify-request page', async () => {
    mockedSignIn.mockResolvedValue('http://localhost:3000/api/auth/signin/nodemailer?');
    expect(await requestMagicLink({ email: EMAIL })).toEqual({ ok: false, error: 'send_failed' });
  });

  // e.g. AccessDenied, when the signIn callback refuses (a database error).
  it('reports send_failed when Auth.js throws', async () => {
    mockedSignIn.mockRejectedValue(
      Object.assign(new Error('AccessDenied'), { type: 'AccessDenied' })
    );
    expect(await requestMagicLink({ email: EMAIL })).toEqual({ ok: false, error: 'send_failed' });
  });

  it.each([
    ['no email', { email: '' }],
    ['a blank email', { email: '   ' }],
    ['an email that is not a string', { email: 42 }],
    ['an absurdly long email', { email: `${'a'.repeat(250)}@example.com` }],
    ['a token that is not a string', { email: EMAIL, turnstileToken: 42 }],
  ])('refuses %s without checking or sending', async (_label, input) => {
    turnstileOn();
    const result = await requestMagicLink(input as Parameters<typeof requestMagicLink>[0]);
    expect(result).toEqual({ ok: false, error: 'send_failed' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedSignIn).not.toHaveBeenCalled();
  });
});
