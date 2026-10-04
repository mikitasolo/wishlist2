'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Dashboard from '@/components/Dashboard';

/**
 * The home page's two faces: the landing (rendered on the server, and handed
 * in) for a signed-out visitor, the dashboard for an account. While the
 * session is unknown it's the dashboard, which shows its skeleton; on the home
 * page that's only when the server couldn't read the session
 * (`SeededSession`).
 *
 * The server leaves the landing out (`landing` null) for an account, so its
 * page doesn't carry it. If the session then ends without a reload (signed
 * out in another tab), the page is rendered again on the server, which now
 * sends the landing; the dashboard's skeleton holds the place meanwhile.
 */
export default function HomeGate({ landing }: { landing: ReactNode | null }) {
  const { status } = useSession();
  const router = useRouter();
  const landingMissing = status === 'unauthenticated' && landing == null;
  useEffect(() => {
    if (landingMissing) router.refresh();
  }, [landingMissing, router]);
  return status === 'unauthenticated' && landing != null ? landing : <Dashboard />;
}
