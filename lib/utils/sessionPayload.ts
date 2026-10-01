import type { Session } from 'next-auth';
import type { IUser } from '@/models/User';

/**
 * Everything a session carries about its user, and so everything `auth()`
 * and `GET /api/auth/session` give out. Each one is read somewhere:
 * - `id`: every authorization check, and the client's "is this mine" checks;
 * - `email`: the user's own address, in their account menu (never to others);
 * - `username`: their public handle (header, invites, follows, profile links);
 * - `name`: the `publicDisplayName` fallback, set only by an identity provider;
 * - `image`: their avatar in the header;
 * - `defaultCurrency`: the default for new lists and for showing prices.
 * Add a field only together with what reads it.
 */
export const SESSION_USER_FIELDS = [
  'id',
  'email',
  'username',
  'name',
  'image',
  'defaultCurrency',
] as const;

/** A non-empty string from a raw row, or undefined. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** The fields of the Mongoose read the session takes, when that read worked. */
export type SessionDbUser = Pick<IUser, '_id' | 'username' | 'image' | 'defaultCurrency'>;

/**
 * The session callback's result (lib/auth.ts): an explicit allowlist, built
 * fresh, never the object Auth.js passes in. With database sessions that
 * object is `{ ...sessionRow, user: userRow }`, the raw rows: returning it (or
 * anything spread from it) puts the session token itself, which the httpOnly
 * cookie keeps from scripts, into `GET /api/auth/session`, along with every
 * field of the user's row.
 *
 * `row` is the adapter's user row Auth.js passed in; `dbUser` the callback's own
 * read of it (null when that read found nothing or failed, in which case the
 * row stands in, as it did before).
 */
export function sessionPayload(
  row: Record<string, unknown> | null | undefined,
  dbUser: SessionDbUser | null,
  expires: unknown
): Session {
  return {
    user: {
      id: dbUser ? dbUser._id.toString() : (text(row?.id) ?? ''),
      email: text(row?.email) ?? '',
      username: (dbUser ? dbUser.username : text(row?.username)) || undefined,
      name: text(row?.name),
      image: (dbUser ? dbUser.image : text(row?.image)) || undefined,
      defaultCurrency: (dbUser ? dbUser.defaultCurrency : text(row?.defaultCurrency)) || 'USD',
    },
    expires: expires instanceof Date ? expires.toISOString() : (text(expires) ?? ''),
  };
}
