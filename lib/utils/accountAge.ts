/**
 * How long an account counts as new (WIS-42): the stricter rate-limit tier
 * (`NEW_ACCOUNT_SPECS` in `lib/rateLimit.ts`) applies until this long after
 * its first verified sign-in, then lifts by itself.
 */
export const NEW_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Whether an account is new: its `emailVerified` (its first verified sign-in)
 * is less than `NEW_ACCOUNT_WINDOW_MS` ago, or it has none, or none that reads
 * as a date. Fails towards new, the stricter answer, on anything it can't read.
 */
export function isNewAccount(emailVerified: unknown, now: number = Date.now()): boolean {
  if (!(emailVerified instanceof Date)) return true;
  const verifiedAt = emailVerified.getTime();
  if (Number.isNaN(verifiedAt)) return true;
  return now - verifiedAt < NEW_ACCOUNT_WINDOW_MS;
}
