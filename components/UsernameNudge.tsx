'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Callout from '@/components/Callout';
import { isGeneratedUsername } from '@/lib/utils/generatedUsername';

const key = (userId: string) => `username-nudge-dismissed:${userId}`;

/**
 * A one-time, dismissible nudge for someone still on the handle we generated
 * for them: friends invite by username, so they need one they'd recognise.
 * Dismissal is remembered per account in this browser only; storage that can't
 * be read just shows it again.
 */
export default function UsernameNudge({
  userId,
  username,
}: {
  userId: string;
  username: string | null;
}) {
  // Hidden until the browser's storage has been read, so a dismissed nudge never flashes.
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    let was = false;
    try {
      was = localStorage.getItem(key(userId)) === '1';
    } catch {
      // Storage unavailable: show it.
    }
    setDismissed(was);
  }, [userId]);

  if (dismissed || !isGeneratedUsername(username)) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(key(userId), '1');
    } catch {
      // Not remembered: it comes back next visit.
    }
  }

  return (
    <Callout tone="info">
      <p className="font-medium text-foreground">
        Pick a username friends will recognise. They need it to invite you.
      </p>
      <p className="mt-1">
        <Link href="/settings" className="font-medium text-accent hover:underline">
          Choose a username
        </Link>
        <span className="mx-2" aria-hidden="true">
          ·
        </span>
        <button type="button" onClick={dismiss} className="font-medium text-accent hover:underline">
          Dismiss
        </button>
      </p>
    </Callout>
  );
}
