'use client';

import { useCallback, useEffect, useState } from 'react';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import { withRequestTimeout } from '@/lib/utils/requestTimeout';
import { birthdayNudge, type BirthdayRuleList } from '@/lib/utils/birthdayNudge';

const PROFILE_TIMEOUT_MS = 10_000;

/** Where a dismissal is kept: per account, holding the birthday it was dismissed for. */
const dismissedKey = (userId: string) => `birthday-nudge-dismissed:${userId}`;

/** The nudge as Needs you shows it (`useBirthdayNudge`). */
export interface BirthdayNudgeOffer {
  /** Days until the birthday: 0 on the day. */
  days: number;
  /** Hide it until next year's birthday. */
  dismiss: () => void;
}

/**
 * The dashboard's nudge to make a list before your own birthday (WIS-344), or
 * `null` when there's none to show: from `BIRTHDAY_NUDGE_LEAD_DAYS` before the
 * birthday on your profile until the day itself, by your local date, unless
 * one of `ownLists` (your own lists, co-owned included) is a Birthday list
 * coming (`birthdayNudge`).
 *
 * Your birthday is read from your own profile (`GET /api/users/me`); until that
 * read and your lists have answered (`ownLists` is `null` while they load or
 * when they failed), nothing shows, never a nudge that a list may already
 * answer. Dismissing it hides it for this birthday, remembered per account in
 * this browser (storage that can't be read shows it again); next year's
 * birthday brings it back.
 */
export function useBirthdayNudge(
  ownLists: readonly BirthdayRuleList[] | null
): BirthdayNudgeOffer | null {
  const { data: session, status } = useKnownSession();
  const userId = status === 'authenticated' ? (session?.user?.id ?? null) : null;
  const today = useLocalToday();
  const [read, setRead] = useState<{ userId: string; birthday: string | null } | null>(null);
  // The birthday it was last dismissed for, from storage; `null` until read.
  const [dismissed, setDismissed] = useState<{ userId: string; value: string | null } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let current = true;
    withRequestTimeout(async (signal) => {
      const res = await fetch('/api/users/me', { cache: 'no-store', signal });
      return res.json();
    }, PROFILE_TIMEOUT_MS)
      .then((result) => {
        if (!current || !result?.success) return;
        const birthday = result.data?.birthday;
        setRead({ userId, birthday: typeof birthday === 'string' ? birthday : null });
      })
      // No nudge rather than a guess: it just isn't shown.
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let value: string | null = null;
    try {
      value = localStorage.getItem(dismissedKey(userId));
    } catch {
      // Storage unavailable: not dismissed.
    }
    setDismissed({ userId, value });
  }, [userId]);

  const birthday = read && read.userId === userId ? read.birthday : null;
  const due = ownLists ? birthdayNudge(birthday, ownLists, today) : null;
  const occurrence = due?.occurrence ?? null;

  const dismiss = useCallback(() => {
    if (!userId || !occurrence) return;
    setDismissed({ userId, value: occurrence });
    try {
      localStorage.setItem(dismissedKey(userId), occurrence);
    } catch {
      // Not remembered: it comes back next visit.
    }
  }, [userId, occurrence]);

  if (!due || !dismissed || dismissed.userId !== userId) return null;
  if (dismissed.value === due.occurrence) return null;
  return { days: due.days, dismiss };
}
