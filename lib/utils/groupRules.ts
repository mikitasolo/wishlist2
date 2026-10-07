/**
 * The rules of groups (WIS-27) that the browser shares with the server: the
 * limits and how names compare. No database here, so client code can import it;
 * the reads and writes are `lib/utils/peopleGroups.ts`.
 */

/** How many groups one person can have. */
export const GROUP_LIMIT = 20;
/** How many people one group can hold. */
export const GROUP_MEMBER_LIMIT = 100;

/** A group as its owner sees it. People are named with `publicDisplayName`, never an email. */
export interface GroupPerson {
  id: string;
  username: string | null;
  displayName: string;
  image: string | null;
}
export interface GroupView {
  id: string;
  name: string;
  members: GroupPerson[];
}

/** The answer when a name is already one of the caller's groups, whatever its case. */
export const DUPLICATE_GROUP_NAME = 'You already have a group with that name.';

/** A name folded for the one-name-per-owner check: "Family" and " family " are the same group. */
export function groupNameKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** What New group says once no more can be made, or null while one can. */
export function groupLimitNote(count: number): string | null {
  return count >= GROUP_LIMIT ? `You have ${GROUP_LIMIT} groups, the most you can have.` : null;
}
