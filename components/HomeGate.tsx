'use client';

import type { ReactNode } from 'react';
import { useSession } from 'next-auth/react';
import Dashboard from '@/components/Dashboard';
import Landing from '@/components/Landing';

/**
 * The home page's two faces: the landing for a signed-out visitor, the
 * dashboard for an account. While the session is unknown it's the dashboard,
 * which shows its skeleton; on the home page that's only when the server
 * couldn't read the session (`SeededSession`).
 *
 * `landing` is the one the server rendered, for a visitor. The server leaves
 * it out (null) for an account, so its page doesn't carry it, and if the
 * browser's session then reads as signed out (signed out in another tab, or a
 * failed read, which next-auth reports the same way) the landing is drawn here
 * instead: a page with Sign in on it, never a skeleton that waits for good.
 */
export default function HomeGate({ landing }: { landing: ReactNode | null }) {
  const { status } = useSession();
  if (status !== 'unauthenticated') return <Dashboard />;
  return landing ?? <Landing />;
}
