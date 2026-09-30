import { sendMagicLinkEmail } from './email';
import { checkRateLimit, emailKey, ipKey } from './rateLimit';

/** The subset of Auth.js's `sendVerificationRequest` params we use. */
export interface VerificationRequest {
  identifier: string;
  url: string;
  request: Request;
}

/**
 * Auth.js `sendVerificationRequest` for the magic-link provider (`lib/auth`).
 *
 * Rate limit the magic-link send, the top abuse target (email bombing a victim,
 * SMTP cost and reputation). Key on BOTH the target email (so one attacker can't
 * fan across IPs to bomb one address) and the client IP (so one host can't spray
 * many addresses). Throwing aborts the send.
 *
 * The limiter runs before the email goes anywhere, so it applies whichever
 * `EMAIL_TRANSPORT` is active: a blocked request is neither sent nor printed.
 */
export async function sendVerificationRequest({
  identifier: email,
  url,
  request,
}: VerificationRequest): Promise<void> {
  const [emailOk, ipOk] = await Promise.all([
    checkRateLimit('signinEmail', emailKey(email)),
    checkRateLimit('signinIp', ipKey(request.headers)),
  ]);
  if (!emailOk || !ipOk) {
    throw new Error('Too many sign-in attempts. Please wait a few minutes and try again.');
  }
  await sendMagicLinkEmail(email, url);
}
