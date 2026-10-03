import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
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
  /** When it was issued: its notification is no older (`withInviteAnswers`). */
  createdAt?: string;
}

interface InviteCardProps {
  invite: PendingInvite;
  /** Its answer is in flight (`usePendingInvites`' `busy`): both buttons are held. */
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  className?: string;
}

/**
 * An action card: what it's about on the left, its buttons on the right from
 * `sm` (stacked under it on a phone). An invite, and each of the dashboard's
 * other "Needs you" rows, so they read as one list.
 */
export const ACTION_CARD_CLASSES =
  'flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5';
const CARD = ACTION_CARD_CLASSES;

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

/** An invite card's shape while the invitations load: avatar, two lines, two buttons. */
export function InviteCardSkeleton() {
  return (
    <div className={CARD}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Skeleton className="h-10 w-10 flex-shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40 max-w-full" />
          <Skeleton className="h-3.5 w-32 max-w-full" />
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-3">
        <Skeleton className="h-9 w-20 rounded-xl" />
        <Skeleton className="h-9 w-20 rounded-xl" />
      </div>
    </div>
  );
}
