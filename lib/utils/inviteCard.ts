import { formatItemCount } from '@/lib/utils/itemCounts';
import { formatOccasionLabel, occasionKindLabel, type Occasion } from '@/lib/utils/occasion';
import { plural } from '@/lib/utils/plural';

/** What a pending invitation shows of its list, as `GET /api/users/me/invites` answers. */
export interface InvitePreview {
  bannerUrl: string | null;
  occasion: Occasion | null;
  /** The list's published items ("N items" everywhere). */
  itemCount: number;
}

interface InviteCopyInput {
  role: 'owner' | 'member';
  invitedByUsername: string | null;
  /** Null (or absent) when the invitee can't open the list yet: then nothing of it is shown. */
  preview?: InvitePreview | null;
  /** Owner invites only: the invitee's own reservations on the list. */
  yourReservations?: number;
}

/** The chip on an invitation: what accepting it makes you. */
export function inviteRoleLabel(role: 'owner' | 'member'): string {
  return role === 'owner' ? 'Co-owner' : 'Member';
}

const inviterName = (username: string | null) => (username ? `@${username}` : 'Someone');

/**
 * The line under an invitation's list name: "from @chloe_r · Holiday · in 83
 * days · 12 items". The occasion and the count only when the invitee could
 * already open the list (`preview`), and the occasion only once the viewer's
 * local date is known (`today`, from `useLocalToday`): until then its kind alone.
 */
export function inviteMetaLine(
  invite: Pick<InviteCopyInput, 'invitedByUsername' | 'preview'>,
  today: string | null
): string {
  const parts = [`from ${inviterName(invite.invitedByUsername)}`];
  const { preview } = invite;
  if (preview) {
    if (preview.occasion) {
      parts.push(
        today
          ? formatOccasionLabel(preview.occasion, today)
          : occasionKindLabel(preview.occasion.kind)
      );
    }
    parts.push(formatItemCount(preview.itemCount));
  }
  return parts.join(' · ');
}

/** What the role means, in one line. A member's names the inviter, an owner of the list. */
export function inviteRoleLine(
  invite: Pick<InviteCopyInput, 'role' | 'invitedByUsername'>
): string {
  if (invite.role === 'owner') return 'You’ll edit the list and manage who’s on it.';
  const owner = invite.invitedByUsername ? `@${invite.invitedByUsername}` : 'The owners';
  return `You can reserve gifts and suggest items. ${owner} won’t see who reserved what.`;
}

/**
 * The consent warning on an owner invite whose invitee holds reservations on
 * the list, which accepting ends (owners never see reservations). Null when
 * there's nothing of theirs to release, and always on a member invite. The
 * count is the invitee's own, shown only to them.
 */
export function inviteReleaseWarning(
  invite: Pick<InviteCopyInput, 'role' | 'yourReservations'>
): string | null {
  const count = invite.yourReservations ?? 0;
  if (invite.role !== 'owner' || count <= 0) return null;
  return `You’ve reserved ${plural(count, 'gift')} here. Co-owners can’t see reservations, so accepting releases ${
    count === 1 ? 'it' : 'them'
  }.`;
}
