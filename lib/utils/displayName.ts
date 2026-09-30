/** The fields a public name can come from, e.g. `session.user`. */
export interface NamedUser {
  username?: string | null;
  /** Only set when an identity provider supplied one. The magic-link sign-in never does. */
  name?: string | null;
}

/** A non-empty trimmed string, or null. `name` is read from the raw DB row, so check its type. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The name another user sees for someone who may have no username, e.g. the
 * inviter in an invite email: their username, else their `name`, else "Someone".
 *
 * Never derived from their email address. Even the part before the `@` often
 * identifies a person, and user emails are never shown to other users. A `name`
 * that contains an `@` is skipped for the same reason, since some identity
 * providers fill it with the address. A username can't contain one
 * (`USERNAME_REGEX`).
 */
export function publicDisplayName(user: NamedUser | null | undefined): string {
  const username = text(user?.username);
  if (username) return username;
  const name = text(user?.name);
  if (name && !name.includes('@')) return name;
  return 'Someone';
}
