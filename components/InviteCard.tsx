'use client';

import Link from 'next/link';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Cover from '@/components/Cover';
import { Skeleton } from '@/components/Skeleton';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import {
  inviteMetaLine,
  inviteReleaseWarning,
  inviteRoleLabel,
  inviteRoleLine,
  type InvitePreview,
} from '@/lib/utils/inviteCard';
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
  /**
   * The list's banner, occasion and item count, only when the invitee could
   * already open it; null (or absent, from an older server) otherwise.
   */
  preview?: InvitePreview | null;
  /** Owner invites only: how many reservations of the invitee's accepting ends. */
  yourReservations?: number;
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
/** An action card's surface alone, for one that lays out its content differently (the currency prompt). */
export const ACTION_CARD_SURFACE =
  'rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5';

/**
 * One pending invitation with Accept and Decline: which list (its cover, and
 * its occasion and size when the invitee could already open it, the name then
 * a link to it), who invited them, the role as a chip and what it means, and,
 * on a co-owner invite, what accepting it releases of theirs before it's
 * accepted (the consent step: owners never see reservations), shown only when
 * they hold some there. Pair it with `usePendingInvites`, which reads the
 * invites and answers them.
 */
export default function InviteCard({
  invite,
  busy,
  onAccept,
  onDecline,
  className = '',
}: InviteCardProps) {
  const today = useLocalToday();
  const preview = invite.preview ?? null;
  const warning = inviteReleaseWarning(invite);
  return (
    <div className={`${ACTION_CARD_CLASSES} ${className}`}>
      <div className="flex min-w-0 items-start gap-3">
        <Cover
          src={preview?.bannerUrl}
          seed={invite.wishlistId}
          sizes="56px"
          className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-surface-2"
        />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            {preview ? (
              <Link
                href={`/wishlists/${invite.wishlistSlug ?? invite.wishlistId}`}
                className="truncate text-body font-semibold text-foreground hover:underline"
              >
                {invite.wishlistName}
              </Link>
            ) : (
              <p className="truncate text-body font-semibold text-foreground">
                {invite.wishlistName}
              </p>
            )}
            <Badge size="sm" tone={invite.role === 'owner' ? 'info' : 'neutral'}>
              {inviteRoleLabel(invite.role)}
            </Badge>
          </div>
          <p className="text-meta text-muted-foreground">
            {inviteMetaLine(invite, today)}
          </p>
          <p className="mt-1 text-sm text-foreground">{inviteRoleLine(invite)}</p>
          {/* Accepting co-ownership releases the invitee's reservations here:
              say so before they tap Accept, not after, and only when it does. */}
          {warning && <p className={`mt-1 text-xs ${TONE_CLASSES.warning.text}`}>{warning}</p>}
        </div>
      </div>
      <div className="grid flex-shrink-0 grid-cols-2 gap-3 sm:flex sm:items-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={onDecline}
          disabled={busy}
          className="w-full sm:w-auto"
        >
          Decline
        </Button>
        <Button size="sm" onClick={onAccept} disabled={busy} className="w-full sm:w-auto">
          Accept
        </Button>
      </div>
    </div>
  );
}

/** An invite card's shape while the invitations load: cover, three lines, two buttons. */
export function InviteCardSkeleton() {
  return (
    <div className={ACTION_CARD_CLASSES}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Skeleton className="h-14 w-14 flex-shrink-0 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40 max-w-full" />
          <Skeleton className="h-3.5 w-32 max-w-full" />
          <Skeleton className="h-3.5 w-56 max-w-full" />
        </div>
      </div>
      <div className="grid flex-shrink-0 grid-cols-2 gap-3 sm:flex sm:items-center">
        <Skeleton className="h-9 rounded-xl sm:w-20" />
        <Skeleton className="h-9 rounded-xl sm:w-20" />
      </div>
    </div>
  );
}
