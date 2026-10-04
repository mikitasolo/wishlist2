/** The one-time welcome a new member sees on a list after accepting its invite (WIS-262). */

/** The one-shot marker an accepted member invite puts on the list's URL. */
export const WELCOME_PARAM = 'welcome';

/** `path` with the welcome marker added (the list's URL after a member accept). */
export function withWelcomeMarker(path: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}${WELCOME_PARAM}=1`;
}

/** Whether `search` (a `location.search`) carries the marker. */
export function hasWelcomeMarker(search: string): boolean {
  return new URLSearchParams(search).get(WELCOME_PARAM) === '1';
}

/** The localStorage key under which this user has dismissed the welcome for this list. */
export function welcomeDismissedKey(userId: string, wishlistId: string): string {
  return `memberWelcomeDismissed:${userId}:${wishlistId}`;
}

/**
 * The note's copy. One owner is named by their public username; with several
 * (or one we can't name) it's "the owners". It says nothing of what is or
 * isn't reserved.
 */
export function memberWelcomeText(ownerUsernames: readonly string[], ownerCount: number): string {
  const names = ownerUsernames.filter(Boolean);
  const who = ownerCount <= 1 && names.length === 1 ? `@${names[0]}` : 'the owners';
  return `You're in. Reserve a gift so nobody else buys it. ${who} won't see who reserved what.`;
}
