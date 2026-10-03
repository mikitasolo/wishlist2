import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import { TONE_CLASSES } from '@/lib/utils/statusTones';

/** A pending invitation, as `GET /api/users/me/invites` answers. */
export interface PendingInvite {
  _id: string;
  role: 'owner' | 'member';
  wishlistId: string;
  wishlistName: string;
  wishlistSlug: string | null;
  invitedByUsername: string | null;
  invitedByImage: string | null;
}

interface InviteCardProps {
  invite: PendingInvite;
  /** Its answer is in flight (`usePendingInvites`' `busy`): both buttons are held. */
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  className?: string;
}

const CARD =
  'flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5';

/**
 * One pending invitation with Accept and Decline: who invited you to which list,
 * and, for a co-owner invite, what accepting it means before it's accepted (the
 * consent step: owners never see reservations, so yours there are released).
 * Pair it with `usePendingInvites`, which reads the invites and answers them.
 */
export default function InviteCard({
  invite,
  busy,
  onAccept,
  onDecline,
  className = '',
}: InviteCardProps) {
  return (
    <div className={`${CARD} ${className}`}>
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={invite.invitedByUsername || 'user'} src={invite.invitedByImage} size="md" />
        <div className="min-w-0">
          <p className="truncate text-body font-semibold text-foreground">{invite.wishlistName}</p>
          <p className="truncate text-sm text-muted-foreground">
            {invite.invitedByUsername ? `@${invite.invitedByUsername}` : 'Someone'} invited you
            {invite.role === 'owner' ? ' as a co-owner' : ''}
          </p>
          {/* Accepting co-ownership is destructive on the gifting side: say so
              before they tap Accept, not after. */}
          {invite.role === 'owner' && (
            <p className={`mt-1 text-xs ${TONE_CLASSES.warning.text}`}>
              You’ll get full control and the list will show on your profile. Owners never see
              reservations, so anything you’ve reserved here will be released.
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onDecline} disabled={busy}>
          Decline
        </Button>
        <Button size="sm" onClick={onAccept} disabled={busy}>
          Accept
        </Button>
      </div>
    </div>
  );
}
