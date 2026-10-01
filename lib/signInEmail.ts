import { AsyncLocalStorage } from 'node:async_hooks';
import { sendMagicLinkEmail } from './email';
import { checkRateLimit, emailKey, ipKey } from './rateLimit';

/** The subset of Auth.js's `sendVerificationRequest` params we use. */
export interface VerificationRequest {
  identifier: string;
  url: string;
  request: Request;
}

/**
 * Marks the one way into a magic-link send: the sign-in form's server action
 * (`app/auth/signin/actions.ts`), once its Turnstile check has let the request
 * through. Auth.js's own `POST /api/auth/signin/<provider>` is refused at the
 * route (`isMagicLinkSignInPath`), and this is the second lock behind it: a send
 * that didn't start inside `asVerifiedSignIn` is refused, whatever path led to it.
 */
const verifiedSignIn = new AsyncLocalStorage<true>();

/** Run `signIn` as a request that has passed the sign-in form's checks. */
export function asVerifiedSignIn<T>(signIn: () => Promise<T>): Promise<T> {
  return verifiedSignIn.run(true, signIn);
}

/** Whether the current call started inside `asVerifiedSignIn`. */
export function isVerifiedSignIn(): boolean {
  return verifiedSignIn.getStore() === true;
}

/**
 * Whether a request path under Auth.js's base path (`/api/auth`) is its
 * sign-in-with-a-provider action, the POST that sends a magic link. Parsed the
 * way Auth.js parses it (`parseActionAndProviderId`): the segments after the
 * base path, empty ones dropped, the first naming the action.
 */
export function isMagicLinkSignInPath(pathname: string, basePath = '/api/auth'): boolean {
  if (!pathname.startsWith(basePath)) return false;
  const [action, ...rest] = pathname.slice(basePath.length).split('/').filter(Boolean);
  return action === 'signin' && rest.length > 0;
}

/**
 * Auth.js `sendVerificationRequest` for the magic-link provider (`lib/auth`).
 *
 * Refuses unless the sign-in form's server action started it (`asVerifiedSignIn`),
 * so a send can't skip its Turnstile check. Then rate limits the send, the top
 * abuse target (email bombing a victim, SMTP cost and reputation). Key on BOTH
 * the target email (so one attacker can't fan across IPs to bomb one address)
 * and the client IP (so one host can't spray many addresses). Throwing aborts
 * the send.
 *
 * The limiter runs before the email goes anywhere, so it applies whichever
 * `EMAIL_TRANSPORT` is active: a blocked request is neither sent nor printed.
 */
export async function sendVerificationRequest({
  identifier: email,
  url,
  request,
}: VerificationRequest): Promise<void> {
  if (!isVerifiedSignIn()) {
    throw new Error('Magic links are only sent from the sign-in form.');
  }
  const [emailOk, ipOk] = await Promise.all([
    checkRateLimit('signinEmail', emailKey(email)),
    checkRateLimit('signinIp', ipKey(request.headers)),
  ]);
  if (!emailOk || !ipOk) {
    throw new Error('Too many sign-in attempts. Please wait a few minutes and try again.');
  }
  await sendMagicLinkEmail(email, url);
}
