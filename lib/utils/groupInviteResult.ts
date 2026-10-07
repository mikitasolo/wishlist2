/**
 * What inviting a group to a list (WIS-37, `POST /api/wishlists/[id]/members/group`)
 * answers, and the words the invite form shows for it. No database here, so the
 * browser can import it.
 */
import { plural } from '@/lib/utils/plural';

/** Someone from the caller's own group, named as everywhere else: never an email. */
export interface GroupInvitePerson {
  id: string;
  username: string;
  displayName: string;
}

export interface GroupInviteResult {
  /** People sent an invite, in the group's order. */
  invited: GroupInvitePerson[];
  /** People not sent one, each with the single invite's wording for why. */
  skipped: (GroupInvitePerson & { reason: string })[];
  /** How many weren't tried at all once the `invite` rate limit ran dry. */
  notInvited: number;
}

/** "@ann": everyone has a username (WIS-357). */
export function groupPersonLabel(person: GroupInvitePerson): string {
  return `@${person.username}`;
}

/** The headline of a group invite's result: how many were invited. */
export function groupInviteHeadline(result: GroupInviteResult): string {
  const { invited, skipped, notInvited } = result;
  if (invited.length === 0 && skipped.length === 0 && notInvited === 0) {
    return 'There’s no one in this group to invite.';
  }
  if (invited.length === 0) return 'No one was invited.';
  return `Invited ${plural(invited.length, 'person', 'people')}.`;
}

/** What's said when the rate limit cut the fan-out short, or null when it didn't. */
export function groupInviteCutShortNote(result: GroupInviteResult): string | null {
  const n = result.notInvited;
  if (n === 0) return null;
  return `${plural(n, 'more person', 'more people')} ${n === 1 ? 'wasn’t' : 'weren’t'} invited: you’ve sent a lot of invites. Try the group again later.`;
}
