import type { Session } from 'next-auth';
import { isNewAccount } from './accountAge';

/**
 * Everything a session carries about its user, and so everything `auth()`
 * and `GET /api/auth/session` give out. Each one is read somewhere:
 * - `id`: every authorization check, and the client's "is this mine" checks;
 * - `email`: the user's own address, in their account menu (never to others);
 * - `username`: their public handle (header, invites, follows, profile links);
 * - `name`: the `publicDisplayName` fallback, set only by an identity provider;
 * - `image`: their avatar in the header;
 * - `defaultCurrency`: the default for new lists and for showing prices;
 * - `currencyChosen`: whether they've answered the dashboard's currency prompt,
 *   which reads it (a yes or no: `User.currencyChosenAt` itself isn't sent);
 * - `newAccount`: whether the account's first verified sign-in is under 24h
 *   old (`isNewAccount`), which picks the stricter rate-limit tier on the
 *   routes that pass it to `enforce` (WIS-42). A yes or no about the caller's
 *   own account, worked out on every check, so no route reads the account
 *   again for it and the account's timestamps themselves aren't sent.
 * Add a field only together with what reads it.
 */
export const SESSION_USER_FIELDS = [
  'id',
  'email',
  'username',
  'name',
  'image',
  'defaultCurrency',
  'currencyChosen',
  'newAccount',
] as const;

/** A non-empty string from a raw row, or undefined. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * The session callback's result (lib/auth.ts): an explicit allowlist, built
 * fresh, never the object Auth.js passes in. With database sessions that
 * object is `{ ...sessionRow, user: userRow }`, the raw rows: returning it (or
 * anything spread from it) puts the session token itself, which the httpOnly
 * cookie keeps from scripts, into `GET /api/auth/session`, along with every
 * field of the user's row.
 *
 * `row` is the adapter's user row Auth.js passed in, read for this very check.
 * A raw row has no schema defaults, hence the fallbacks below
 * (`defaultCurrency` 'USD'; `image` is null by default; an account without
 * `currencyChosenAt` hasn't answered the prompt; one without `createdAt` or
 * `emailVerified` is new). Every account has a username (WIS-357), but the row
 * is still read defensively: a missing one is left out, never invented. `now`
 * is for tests.
 */
export function sessionPayload(
  row: Record<string, unknown> | null | undefined,
  expires: unknown,
  now: number = Date.now()
): Session {
  const id = text(row?.id);
  // Fail closed: a session without its user's id would still read as signed
  // in. Auth.js answers a session callback that throws with no session at all.
  if (!id) throw new Error('No user id for the session');
  // `satisfies` ties this literal to SESSION_USER_FIELDS: a field missing from
  // either, or added to only one, is a type error.
  const user = {
    id,
    email: text(row?.email) ?? '',
    username: text(row?.username),
    name: text(row?.name),
    image: text(row?.image),
    defaultCurrency: text(row?.defaultCurrency) ?? 'USD',
    currencyChosen: row?.currencyChosenAt instanceof Date,
    newAccount: isNewAccount(row ?? {}, now),
  } satisfies Record<(typeof SESSION_USER_FIELDS)[number], unknown>;
  return {
    user,
    expires: expires instanceof Date ? expires.toISOString() : (text(expires) ?? ''),
  };
}

/**
 * The session as a server component may hand it to the browser (the home
 * page's `SeededSession`): `auth()`'s answer, which is already the session
 * callback's allowlist, rebuilt once more from `SESSION_USER_FIELDS` and
 * `expires` alone. So whatever `auth()` ever returns, a raw row's session
 * token or any other field of it can't reach the page's HTML, where any script
 * could read it.
 */
export function clientSession(session: Session | null | undefined): Session | null {
  const raw = session?.user as Record<string, unknown> | undefined;
  if (!raw || typeof raw.id !== 'string' || !raw.id) return null;
  const user = Object.fromEntries(
    SESSION_USER_FIELDS.filter((field) => raw[field] !== undefined).map((field) => [
      field,
      raw[field],
    ])
  ) as Session['user'];
  return { user, expires: typeof session?.expires === 'string' ? session.expires : '' };
}
