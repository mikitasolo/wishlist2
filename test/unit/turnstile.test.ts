import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { format } from 'node:util';
import {
  MAX_TOKEN_LENGTH,
  SITEVERIFY_URL,
  TURNSTILE_VERIFY_TIMEOUT_MS,
  verifyTurnstileToken,
} from '@/lib/turnstile';

const SITE_KEY = 'site-key-123';
const SECRET_KEY = 'secret-key-456';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const IP = '203.0.113.7';

const fetchMock = vi.fn<typeof fetch>();

function answer(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let errorLog: ReturnType<typeof vi.spyOn>;
let warnLog: ReturnType<typeof vi.spyOn>;
/** Everything logged, the way it prints. */
const logged = () =>
  [...errorLog.mock.calls, ...warnLog.mock.calls]
    .map((args: unknown[]) => format(...args))
    .join('\n');

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', SITE_KEY);
  vi.stubEnv('TURNSTILE_SECRET_KEY', SECRET_KEY);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('verifyTurnstileToken: keys unset', () => {
  it.each([
    ['neither key', {}],
    // lib/env refuses a half config; should one get this far, it's still off.
    ['only the secret', { TURNSTILE_SECRET_KEY: SECRET_KEY }],
    ['only the site key', { NEXT_PUBLIC_TURNSTILE_SITE_KEY: SITE_KEY }],
  ])('skips the check with %s, without calling Cloudflare', async (_label, vars) => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', undefined);
    vi.stubEnv('TURNSTILE_SECRET_KEY', undefined);
    for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);

    expect(await verifyTurnstileToken(undefined, IP)).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('verifyTurnstileToken: a verdict', () => {
  it('passes a token Cloudflare accepts, sending the secret, the token and the IP', async () => {
    fetchMock.mockResolvedValue(answer({ success: true, 'error-codes': [] }));

    expect(await verifyTurnstileToken(TOKEN, IP)).toBe('passed');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(SITEVERIFY_URL);
    expect(init?.method).toBe('POST');
    const form = new URLSearchParams(init?.body as URLSearchParams);
    expect(Object.fromEntries(form)).toEqual({ secret: SECRET_KEY, response: TOKEN, remoteip: IP });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    // A success needs no log line.
    expect(errorLog).not.toHaveBeenCalled();
    expect(warnLog).not.toHaveBeenCalled();
  });

  it('leaves out remoteip when the IP is unknown', async () => {
    fetchMock.mockResolvedValue(answer({ success: true }));

    expect(await verifyTurnstileToken(TOKEN, null)).toBe('passed');

    const form = new URLSearchParams(fetchMock.mock.calls[0]![1]?.body as URLSearchParams);
    expect(form.has('remoteip')).toBe(false);
  });

  it.each(['invalid-input-response', 'timeout-or-duplicate', 'bad-request'])(
    'refuses a token Cloudflare refuses with %s, logging the code only',
    async (code) => {
      fetchMock.mockResolvedValue(answer({ success: false, 'error-codes': [code] }));

      expect(await verifyTurnstileToken(TOKEN, IP)).toBe('failed');

      expect(warnLog).toHaveBeenCalledWith(
        JSON.stringify({ event: 'turnstile_refused', errorCodes: [code] })
      );
      expect(errorLog).not.toHaveBeenCalled();
    }
  );

  it('refuses a refusal with no error codes', async () => {
    fetchMock.mockResolvedValue(answer({ success: false }));
    expect(await verifyTurnstileToken(TOKEN, IP)).toBe('failed');
  });

  // Mixed with a code about the token, an internal error is still a refusal:
  // only codes that aren't about the token fail open.
  it('refuses when a token code comes with internal-error', async () => {
    fetchMock.mockResolvedValue(
      answer({ success: false, 'error-codes': ['internal-error', 'invalid-input-response'] })
    );
    expect(await verifyTurnstileToken(TOKEN, IP)).toBe('failed');
  });

  // A missing token is still put to Cloudflare, as an empty one: refused when
  // it answers, failing open only when it can't (see the next describe).
  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
  ])('refuses a %s token once Cloudflare says it is missing', async (_label, token) => {
    fetchMock.mockResolvedValue(
      answer({ success: false, 'error-codes': ['missing-input-response'] })
    );

    expect(await verifyTurnstileToken(token, IP)).toBe('failed');

    const form = new URLSearchParams(fetchMock.mock.calls[0]![1]?.body as URLSearchParams);
    expect(form.get('response')).toBe('');
    expect(warnLog).toHaveBeenCalledWith(
      JSON.stringify({ event: 'turnstile_refused', errorCodes: ['missing-input-response'] })
    );
  });

  it('refuses a token that is not a string without calling Cloudflare', async () => {
    expect(await verifyTurnstileToken(42, IP)).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a token longer than Cloudflare allows without calling it', async () => {
    expect(await verifyTurnstileToken('x'.repeat(MAX_TOKEN_LENGTH + 1), IP)).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('only logs error codes that look like one', async () => {
    fetchMock.mockResolvedValue(
      answer({ success: false, 'error-codes': ['invalid-input-response', TOKEN, 7] })
    );
    expect(await verifyTurnstileToken(TOKEN, IP)).toBe('failed');
    expect(warnLog).toHaveBeenCalledWith(
      JSON.stringify({ event: 'turnstile_refused', errorCodes: ['invalid-input-response'] })
    );
  });
});

// Cloudflare couldn't give a verdict: sign-in fails open (the fail-closed
// limiters stay the backstop), and one line says why, with nothing personal.
describe('verifyTurnstileToken: Cloudflare unavailable (fails open)', () => {
  function expectUnavailableLogged(reason: string) {
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(
      JSON.stringify({ event: 'turnstile_unavailable', reason })
    );
    const printed = logged();
    expect(printed).not.toContain(TOKEN);
    expect(printed).not.toContain(IP);
    expect(printed).not.toContain(SECRET_KEY);
  }

  // What the form sends when Cloudflare's script couldn't load or run: refused
  // while Cloudflare answers, but an outage mustn't lock everyone out.
  it('fails open on a missing token when Cloudflare is unreachable too', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(await verifyTurnstileToken(null, IP)).toBe('unavailable');
    expectUnavailableLogged('network');
  });

  it('fails open when the network is down', async () => {
    fetchMock.mockRejectedValue(
      new TypeError(`fetch failed (${SITEVERIFY_URL}, response=${TOKEN}, remoteip=${IP})`)
    );
    expect(await verifyTurnstileToken(TOKEN, IP)).toBe('unavailable');
    expectUnavailableLogged('network');
  });

  it.each([500, 502, 503])('fails open on an HTTP %i', async (status) => {
    fetchMock.mockResolvedValue(answer({ success: false }, status));
    expect(await verifyTurnstileToken(TOKEN, IP)).toBe('unavailable');
    expectUnavailableLogged(`http_${status}`);
  });

  it.each([
    ['not JSON', '<html>rate limited</html>', 429],
    ['JSON without a verdict', { hello: 'world' }, 200],
    ['a JSON array', [], 200],
  ])('fails open on an answer that is %s', async (_label, body, status) => {
    fetchMock.mockResolvedValue(answer(body, status));
    expect(await verifyTurnstileToken(TOKEN, IP)).toBe('unavailable');
    expectUnavailableLogged(`unreadable_${status}`);
  });

  it("fails open on Cloudflare's own internal-error", async () => {
    fetchMock.mockResolvedValue(answer({ success: false, 'error-codes': ['internal-error'] }));
    expect(await verifyTurnstileToken(TOKEN, IP)).toBe('unavailable');
    expectUnavailableLogged('internal-error');
  });

  // Our misconfiguration, not the visitor's doing: failing closed would lock
  // everyone out. Logged as an error with the code, so it's found.
  it('fails open on a secret Cloudflare rejects', async () => {
    fetchMock.mockResolvedValue(
      answer({ success: false, 'error-codes': ['invalid-input-secret'] })
    );
    expect(await verifyTurnstileToken(TOKEN, IP)).toBe('unavailable');
    expectUnavailableLogged('invalid-input-secret');
  });

  it(`fails open when Cloudflare doesn't answer within ${TURNSTILE_VERIFY_TIMEOUT_MS} ms`, async () => {
    vi.useFakeTimers();
    let aborted = false;
    // Hangs until aborted, like a fetch to a host that never answers.
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(init.signal!.reason);
          });
        })
    );

    const result = verifyTurnstileToken(TOKEN, IP);
    await vi.advanceTimersByTimeAsync(TURNSTILE_VERIFY_TIMEOUT_MS - 1);
    expect(errorLog).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(await result).toBe('unavailable');
    // The connection is dropped, not left open.
    expect(aborted).toBe(true);
    expectUnavailableLogged('timeout');
  });

  it('times out a body that never finishes, too', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({
      status: 200,
      json: () => new Promise(() => {}),
    } as unknown as Response);

    const result = verifyTurnstileToken(TOKEN, IP);
    await vi.advanceTimersByTimeAsync(TURNSTILE_VERIFY_TIMEOUT_MS);

    expect(await result).toBe('unavailable');
    expectUnavailableLogged('timeout');
  });
});
