'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/Button';
import Callout from '@/components/Callout';
import {
  hasWelcomeMarker,
  memberWelcomeText,
  WELCOME_PARAM,
  welcomeDismissedKey,
} from '@/lib/utils/memberWelcome';

function wasDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

/**
 * The one-time note a new member sees on a list after accepting a member
 * invite (WIS-262). Accepting opens the list with `?welcome=1`, which is read
 * once here and taken out of the URL (other parameters stay). The note shows
 * only to a member who followed that link, and until they press Got it, which
 * is remembered for that user and list in this browser. Owners, and anyone
 * who opens the marked URL without being a member, see nothing. It says
 * nothing of what is reserved.
 */
export default function MemberWelcome({
  wishlistId,
  userId,
  isMember,
  isOwner,
  ownerUsernames,
  ownerCount,
}: {
  wishlistId: string;
  userId: string | null;
  isMember: boolean;
  isOwner: boolean;
  ownerUsernames: readonly string[];
  ownerCount: number;
}) {
  const [marked, setMarked] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!hasWelcomeMarker(window.location.search)) return;
    setMarked(true);
    const url = new URL(window.location.href);
    url.searchParams.delete(WELCOME_PARAM);
    window.history.replaceState(null, '', url);
  }, []);

  if (!marked || dismissed || !isMember || isOwner || !userId) return null;
  const key = welcomeDismissedKey(userId, wishlistId);
  if (wasDismissed(key)) return null;

  return (
    <Callout tone="info" className="mb-6">
      <p>{memberWelcomeText(ownerUsernames, ownerCount)}</p>
      <Button
        size="sm"
        variant="soft"
        className="mt-2"
        onClick={() => {
          try {
            window.localStorage.setItem(key, '1');
          } catch {
            /* no storage: hidden for this visit only */
          }
          setDismissed(true);
        }}
      >
        Got it
      </Button>
    </Callout>
  );
}
