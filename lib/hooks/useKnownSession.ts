'use client';

import type { Session } from 'next-auth';
import { useSession } from 'next-auth/react';

/**
 * `useSession` that reports `loading` only while no session is known yet
 * (WIS-301). next-auth's `update()` (the currency prompt, Settings, Welcome)
 * puts a known session back through `status === 'loading'` while it keeps
 * `data`, so a page branching on `status` swaps its content for a skeleton and
 * its `[status]` effects read everything again. A known session stays
 * `authenticated` through that, and anything else is passed through as is.
 * Use this instead of `useSession` wherever `status` is read.
 */
export function useKnownSession() {
  const result = useSession();
  if (result.status === 'loading') {
    const data = result.data as Session | null | undefined;
    if (data?.user) return { ...result, data, status: 'authenticated' as const };
  }
  return result;
}
