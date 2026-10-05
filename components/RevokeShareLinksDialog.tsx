'use client';

import { useId } from 'react';
import BaseModal from '@/components/BaseModal';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import { SHARE_LINK_LEVEL_LABELS } from '@/components/ShareLinkDialog';
import { useBusyIds } from '@/lib/hooks/useBusyIds';
import { isLinkLive, type ShareLinkRow } from '@/lib/hooks/useShareLinks';
import { plural } from '@/lib/utils/plural';

export const REVOKE_LINKS_TITLE = 'Revoke any share links?';

/** "@bob could copy this list's share links." */
export function revokeLinksMessage(username: string | null): string {
  return `@${username || 'user'} could copy this list's share links.`;
}

export const NO_LINKS_LEFT_TEXT = 'No share links left to revoke.';

const linkName = (link: ShareLinkRow) => link.label || 'Untitled link';

interface RevokeShareLinksDialogProps {
  /** The owner just taken off the list (removed, or made a member). */
  username: string | null;
  /** The list's links, as `useShareLinks` holds them: only the live ones are offered. */
  links: readonly ShareLinkRow[];
  /** Revokes one (`useShareLinks().revoke`), which takes it off `links` and toasts. */
  onRevoke: (id: string) => Promise<boolean>;
  onDone: () => void;
  /** The moment links count expiry from (tests); now by default. */
  now?: Date;
}

/**
 * The follow-up after an owner removes or demotes a co-owner (WIS-338). Links
 * stay when an owner goes (printed QR codes keep working), but the ex-owner
 * may have copied them, so the owner who did it is offered each live link
 * (label, level, how many joined through it) with Revoke, and Done. Revoking
 * here needs no second confirmation: this dialog is the question. It's shown
 * only after the removal landed, and only when the list has live links.
 */
export default function RevokeShareLinksDialog({
  username,
  links,
  onRevoke,
  onDone,
  now = new Date(),
}: RevokeShareLinksDialogProps) {
  const titleId = useId();
  const { busy, run } = useBusyIds();
  const live = links.filter((link) => isLinkLive(link, now));

  return (
    <BaseModal
      isOpen
      onClose={onDone}
      title={REVOKE_LINKS_TITLE}
      titleId={titleId}
      size="md"
      footer={<Button onClick={onDone}>Done</Button>}
    >
      <p className="text-sm text-muted-foreground">{revokeLinksMessage(username)}</p>
      {live.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{NO_LINKS_LEFT_TEXT}</p>
      ) : (
        <ul
          aria-label="Share links"
          className="mt-4 divide-y divide-border rounded-xl border border-border"
        >
          {live.map((link) => (
            <li key={link._id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{linkName(link)}</p>
                <div className="mt-1 flex min-w-0 items-center gap-2">
                  <Badge size="sm" tone={link.level === 'join' ? 'info' : 'neutral'}>
                    {SHARE_LINK_LEVEL_LABELS[link.level]}
                  </Badge>
                  {link.level === 'join' && (
                    <p className="truncate text-xs text-muted-foreground">
                      {plural(link.joinedCount, 'person', 'people')} joined
                    </p>
                  )}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy(link._id)}
                onClick={() => run(link._id, () => onRevoke(link._id))}
                aria-label={`Revoke ${linkName(link)}`}
              >
                {busy(link._id) ? 'Revoking…' : 'Revoke'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </BaseModal>
  );
}
