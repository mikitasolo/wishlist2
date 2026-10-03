/**
 * Who a username suggestion in the invite form already is on this list, worked
 * out in the browser from what the owner's Manage view has loaded (its owners,
 * members and pending invites), so the form needs no API of its own for it.
 *
 * Someone already on the list can't be invited again (the server refuses it),
 * so their suggestion is shown with its status and can't be picked. A member's
 * offers promotion instead, the one way to make a member a co-owner.
 */

/** A suggestion only reaches the search once it's this long. */
export const INVITE_SEARCH_MIN_CHARS = 3;

export type ListStatus = 'owner' | 'member' | 'invited';

export const LIST_STATUS_LABEL: Record<ListStatus, string> = {
  owner: 'Owner',
  member: 'Member',
  invited: 'Invited',
};

export interface ListPerson {
  status: ListStatus;
  /** A member's user id, which promotion (`POST /owners/[userId]`) takes. */
  userId?: string;
}

type Username = string | null | undefined;

export interface ListPeople {
  owners: readonly Username[];
  members: readonly { userId: string; username: Username }[];
  /** The usernames of everyone with an invite still pending on the list. */
  invited: readonly Username[];
}

/** What the field holds, as the search and the invite take it: trimmed, without a leading `@`. */
export function inviteSearchTerm(value: string): string {
  return value.trim().replace(/^@/, '');
}

const key = (username: string) => username.toLowerCase();

/**
 * Each person on the list by lower-cased username. An owner is an owner
 * whatever else they have. A member with an invite pending (only a promotion
 * can be: a member can't be invited as one again) is `invited`, since another
 * promotion would only be refused as already pending. Anyone without a
 * username can't come up in a username search, so they're left out.
 */
export function listStatusByUsername(people: ListPeople): Map<string, ListPerson> {
  const byName = new Map<string, ListPerson>();
  for (const m of people.members) {
    if (m.username) byName.set(key(m.username), { status: 'member', userId: m.userId });
  }
  for (const username of people.invited) {
    if (username) byName.set(key(username), { status: 'invited' });
  }
  for (const username of people.owners) {
    if (username) byName.set(key(username), { status: 'owner' });
  }
  return byName;
}
