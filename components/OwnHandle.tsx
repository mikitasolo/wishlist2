'use client';

import Button from '@/components/Button';
import { useCopyProfileLink } from '@/lib/hooks/useCopyProfileLink';

/**
 * "@maria_nowak" with a Copy button for the profile link: how friends invite
 * you, since invites go by username. Shows only the signed-in user's own handle,
 * never an email.
 */
export default function OwnHandle({
  username,
  className = '',
}: {
  username: string;
  className?: string;
}) {
  const { copied, copy } = useCopyProfileLink(username);
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      <strong className="break-all font-semibold text-foreground">@{username}</strong>
      <Button
        variant="secondary"
        size="sm"
        icon={copied ? 'check' : 'link'}
        onClick={copy}
        aria-label={copied ? 'Copied your profile link' : 'Copy your profile link'}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </span>
  );
}
