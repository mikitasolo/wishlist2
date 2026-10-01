'use server';

import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { signIn } from '@/lib/auth';
import { clientIp } from '@/lib/rateLimit';
import { asVerifiedSignIn } from '@/lib/signInEmail';
import { verifyTurnstileToken } from '@/lib/turnstile';
import { magicLinkRequestSchema } from '@/lib/validations';

/**
 * - `challenge`: the Turnstile check refused the token (or there was none).
 * - `send_failed`: no link went out. Auth.js doesn't say why (a rate limit, an
 *   SMTP error, a malformed address), so neither does the form.
 */
export type MagicLinkResult = { ok: true } | { ok: false; error: 'challenge' | 'send_failed' };

/**
 * Send a magic link: the sign-in form's submit, and the only way one is sent
 * (Auth.js's own sign-in POST is refused at `/api/auth`).
 *
 * The Turnstile token is checked first (`verifyTurnstileToken`: skipped while
 * Turnstile is off, fail-open when Cloudflare can't answer), before anything
 * else happens, so a refused request neither creates an account nor sends
 * anything. Then Auth.js's server-side `signIn` runs the usual email flow, inside
 * `asVerifiedSignIn` so `sendVerificationRequest` will send. Its rate limits (per
 * email and per IP, fail-closed) still apply there.
 *
 * `redirect: false` makes `signIn` return the URL it would have redirected to
 * instead of throwing a redirect: the verify-request page on success, the error
 * page (`?error=…`) when the send failed, so the form can stay put and show the
 * outcome. `redirectTo` becomes the link's `callbackUrl`, which Auth.js keeps on
 * our own origin (its `redirect` callback). A refused sign-in (`AccessDenied`,
 * from the `signIn` callback) is thrown rather than returned.
 */
export async function requestMagicLink(input: {
  email: string;
  callbackUrl?: string;
  turnstileToken?: string | null;
}): Promise<MagicLinkResult> {
  // A server action is a public endpoint: anything can arrive here.
  const parsed = magicLinkRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'send_failed' };
  const { email, callbackUrl, turnstileToken } = parsed.data;

  const ip = clientIp(await headers());
  const outcome = await verifyTurnstileToken(turnstileToken, ip === 'unknown' ? null : ip);
  if (outcome === 'failed') return { ok: false, error: 'challenge' };

  let url: string;
  try {
    url = await asVerifiedSignIn(() =>
      signIn('nodemailer', { email, redirectTo: callbackUrl, redirect: false })
    );
  } catch (error) {
    unstable_rethrow(error);
    // Auth.js has already logged it.
    return { ok: false, error: 'send_failed' };
  }

  return new URL(url, 'http://localhost').searchParams.has('error')
    ? { ok: false, error: 'send_failed' }
    : { ok: true };
}
