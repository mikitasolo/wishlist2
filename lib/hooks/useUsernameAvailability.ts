'use client';

import { useEffect, useState } from 'react';
import { USERNAME_REGEX } from '@/lib/validations';

export type UsernameAvailability = 'idle' | 'checking' | 'ok' | 'taken' | 'invalid';

/** How long typing has to pause before the availability check goes out. */
export const USERNAME_CHECK_DEBOUNCE_MS = 400;

/**
 * Live availability of `username` as someone edits theirs (the settings page,
 * the welcome page). `current` is their saved username, or null while it's
 * still loading; matching it is `idle`, since keeping your own name needs no
 * check. A malformed one is `invalid` straight away (the same `USERNAME_REGEX`
 * the API validates with); anything else is checked against
 * `/api/users/check-username` once typing pauses, and a reserved name counts
 * as `taken`. A failed check falls back to `idle`, and an answer for a value
 * that has since been edited is dropped, so it can't mark the newer one
 * available. The API re-checks on save either way.
 */
export function useUsernameAvailability(
  username: string,
  current: string | null
): UsernameAvailability {
  const [availability, setAvailability] = useState<UsernameAvailability>('idle');

  useEffect(() => {
    const u = username.toLowerCase();
    if (current === null || u === current) {
      setAvailability('idle');
      return;
    }
    if (!USERNAME_REGEX.test(u)) {
      setAvailability('invalid');
      return;
    }
    setAvailability('checking');
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/check-username?username=${encodeURIComponent(u)}`, {
          cache: 'no-store',
        });
        const result = await res.json();
        if (stale) return;
        setAvailability(
          result.available ? 'ok' : result.reason === 'invalid' ? 'invalid' : 'taken'
        );
      } catch {
        if (!stale) setAvailability('idle');
      }
    }, USERNAME_CHECK_DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [username, current]);

  return availability;
}
