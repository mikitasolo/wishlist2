/**
 * How long an account counts as new (WIS-42): the stricter rate-limit tier
 * (`NEW_ACCOUNT_SPECS` in `lib/rateLimit.ts`) applies until this long after
 * its first verified sign-in, then lifts by itself.
 */
export const NEW_ACCOUNT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The fields of a user row (raw or Mongoose) that say how old the account is. */
export interface AccountAgeFields {
  createdAt?: unknown;
  emailVerified?: unknown;
}

function time(value: unknown): number | null {
  if (!(value instanceof Date)) return null;
  const ms = value.getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Whether an account is new: its first verified sign-in is less than
 * `NEW_ACCOUNT_WINDOW_MS` ago.
 *
 * That moment is the row's `createdAt`, since accounts are created by the
 * adapter on the first verified sign-in (`createUserAccount`). It isn't
 * `emailVerified`: Auth.js rewrites that to "now" on every magic-link sign-in
 * of an existing account, so an account years old would read as new for a day
 * after each sign-in. `emailVerified` stands in only for a row with no
 * `createdAt`, and a row with neither (or neither readable as a date) is new,
 * the stricter answer.
 */
export function isNewAccount(user: AccountAgeFields, now: number = Date.now()): boolean {
  const since = time(user.createdAt) ?? time(user.emailVerified);
  if (since === null) return true;
  return now - since < NEW_ACCOUNT_WINDOW_MS;
}
