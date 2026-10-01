import { getTurnstileKeys } from './env';
import { RequestTimeoutError, withRequestTimeout } from './utils/requestTimeout';

/**
 * Cloudflare Turnstile, the bot check on the magic-link sign-in form (WIS-38).
 *
 * The widget (`components/TurnstileWidget.tsx`) hands the browser a one-time
 * token; the sign-in server action (`app/auth/signin/actions.ts`) checks it here
 * with Cloudflare's `siteverify` before any email is sent. Off unless both keys
 * are set (`getTurnstileKeys`), like rate limiting without Redis.
 *
 * Failure policy: a token Cloudflare refuses (or no token) is refused. When
 * Cloudflare can't give a verdict (unreachable, a timeout, a 5xx, an answer we
 * can't read, its own `internal-error`, or a secret it doesn't recognise), the
 * check fails **open**: sign-in goes ahead and one `turnstile_unavailable` line
 * is logged. The sign-in limiters (per email and per IP, fail-closed, in
 * `lib/signInEmail.ts`) stay the backstop. The split follows who controls the
 * cause: the visitor controls only the token, so everything about the token
 * fails closed, and only Cloudflare or our own configuration can fail it open.
 *
 * Logs carry the outcome's kind and Cloudflare's error codes only, never the
 * token, the visitor's IP, the email being signed in or the secret.
 */

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * How long sign-in waits for `siteverify` before failing open: 3 s. A healthy
 * answer takes well under half a second, and sign-in may still wait on the rate
 * limiter (`STORE_TIMEOUT_MS`, 2 s) and SMTP after it, so a hanging Cloudflare
 * costs a visitor a few seconds rather than the browser's own timeout.
 */
export const TURNSTILE_VERIFY_TIMEOUT_MS = 3_000;

/** Cloudflare's cap on a token's length. Anything longer is refused unsent. */
export const MAX_TOKEN_LENGTH = 2048;

/**
 * `siteverify` error codes that aren't about the token, so they aren't a verdict
 * on the visitor: Cloudflare's own failure, or a secret it doesn't recognise
 * (our misconfiguration, which fails open rather than locking everyone out).
 */
const NOT_A_VERDICT = new Set(['internal-error', 'missing-input-secret', 'invalid-input-secret']);

/**
 * - `skipped`: Turnstile is off (keys unset), so there's nothing to check.
 * - `passed`: Cloudflare accepted the token.
 * - `failed`: no token, or Cloudflare refused it. The only refusal.
 * - `unavailable`: no verdict from Cloudflare; sign-in fails open.
 */
export type TurnstileOutcome = 'skipped' | 'passed' | 'failed' | 'unavailable';

/** Error codes as Cloudflare sent them, kept only if they look like one (`invalid-input-response`). */
function errorCodes(body: Record<string, unknown>): string[] {
  const codes = body['error-codes'];
  if (!Array.isArray(codes)) return [];
  return codes.filter(
    (code): code is string => typeof code === 'string' && /^[a-z-]{1,64}$/.test(code)
  );
}

function unavailable(reason: string): 'unavailable' {
  console.error(JSON.stringify({ event: 'turnstile_unavailable', reason }));
  return 'unavailable';
}

function refused(codes: string[]): 'failed' {
  // One line per refusal, like `rate_limited`, to see what the wall turns away.
  console.warn(JSON.stringify({ event: 'turnstile_refused', errorCodes: codes }));
  return 'failed';
}

type SiteverifyAnswer =
  { kind: 'http_error'; status: number } | { kind: 'body'; status: number; body: unknown };

/**
 * Check a sign-in form's Turnstile token with Cloudflare. `remoteIp` is the
 * visitor's IP, passed on to Cloudflare as a signal (it already saw the visitor
 * when it served the widget); omit it when unknown.
 */
export async function verifyTurnstileToken(
  token: unknown,
  remoteIp?: string | null
): Promise<TurnstileOutcome> {
  const keys = getTurnstileKeys();
  if (!keys) return 'skipped';

  if (typeof token !== 'string' || token.length === 0) return refused(['missing-input-response']);
  if (token.length > MAX_TOKEN_LENGTH) return refused(['invalid-input-response']);

  const form = new URLSearchParams({ secret: keys.secretKey, response: token });
  if (remoteIp) form.set('remoteip', remoteIp);

  let answer: SiteverifyAnswer;
  try {
    // The bound covers reading the body too, not just the wait for the headers.
    answer = await withRequestTimeout(async (signal) => {
      const res = await fetch(SITEVERIFY_URL, { method: 'POST', body: form, signal });
      if (res.status >= 500) return { kind: 'http_error', status: res.status };
      return { kind: 'body', status: res.status, body: await res.json().catch(() => null) };
    }, TURNSTILE_VERIFY_TIMEOUT_MS);
  } catch (error) {
    // Only the kind: a fetch error can quote the request it failed on.
    return unavailable(error instanceof RequestTimeoutError ? 'timeout' : 'network');
  }

  if (answer.kind === 'http_error') return unavailable(`http_${answer.status}`);

  const body = answer.body;
  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as { success?: unknown }).success !== 'boolean'
  ) {
    return unavailable(`unreadable_${answer.status}`);
  }
  const result = body as Record<string, unknown>;
  if (result.success === true) return 'passed';

  const codes = errorCodes(result);
  if (codes.length > 0 && codes.every((code) => NOT_A_VERDICT.has(code))) {
    return unavailable(codes.join(','));
  }
  return refused(codes);
}
