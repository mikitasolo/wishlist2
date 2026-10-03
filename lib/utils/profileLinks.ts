/**
 * The query parameter that opens a profile (`app/users/[username]/page.tsx`)
 * with its followers list showing. Its value doesn't matter, only its presence.
 */
export const FOLLOWERS_PARAM = 'followers';

/** A profile's URL. Usernames are URL-safe (`USERNAME_REGEX`), so no encoding. */
export function profileHref(username: string): string {
  return `/users/${username}`;
}

/** A profile's URL with its followers list open. */
export function followersHref(username: string): string {
  return `${profileHref(username)}?${FOLLOWERS_PARAM}=1`;
}
