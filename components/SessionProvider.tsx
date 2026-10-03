'use client';

import { SessionProvider as NextAuthSessionProvider, useSession } from 'next-auth/react';
import { ReactNode, useEffect } from 'react';
import { rememberSessionHint } from '@/lib/utils/sessionHint';

/** Keeps the session hint (`lib/utils/sessionHint.ts`) in step with the session, once it's known. */
function SessionHint() {
  const { status } = useSession();
  useEffect(() => {
    if (status === 'loading') return;
    rememberSessionHint(status === 'authenticated');
  }, [status]);
  return null;
}

export default function SessionProvider({ children }: { children: ReactNode }) {
  return (
    <NextAuthSessionProvider>
      <SessionHint />
      {children}
    </NextAuthSessionProvider>
  );
}
