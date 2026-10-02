/**
 * The part of a search query that's matched against usernames: trimmed,
 * lowercased (usernames are stored lowercase), and without one leading `@`.
 *
 * People are shown everywhere as `@username`, so that's how a handle gets
 * shared ("I'm @alice"), and a username can't contain an `@` (`USERNAME_REGEX`).
 * Only people are matched this way: a list name is matched as typed, so a list
 * called "@home" stays findable.
 *
 * Empty for a query that's only an `@`: search no people at all for it, since
 * an empty pattern would match every username.
 */
export function usernameQuery(q: string): string {
  return q.trim().toLowerCase().replace(/^@/, '').trim();
}
