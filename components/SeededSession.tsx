'use client';

import { useContext, useMemo, type ReactNode } from 'react';
import type { Session } from 'next-auth';
import { SessionContext } from 'next-auth/react';

/**
 * Hands the session a server component read (`auth()`, through
 * `clientSession`) to everything under it while the app's own
 * `SessionProvider` (root layout) is still on its first read. That's what lets
 * the home page render on the server as it will look: the landing for a
 * visitor, and the signed-in header (no placeholders) and the dashboard's
 * skeleton for an account, with no `useSession` loading state in between.
 *
 * It only stands in for a session that has never been read: once the
 * provider's own read lands, or once it has ever had one (an `update()` puts it
 * back through `loading` with the session it had), its answer passes through
 * unchanged, so the live session always wins. `session` undefined (the server
 * couldn't tell) passes it through too.
 *
 * Not a second `SessionProvider`: next-auth keeps its state in one module-wide
 * object, so a nested provider would leave the outer one loading for good and
 * the inner one deaf to focus and sign-out events. This only overrides the
 * context's value. The root layout can't pass the session itself without
 * reading it on every page, which would make them all dynamic (see
 * `lib/utils/sessionHint.ts`); the home page is dynamic anyway.
 */
export default function SeededSession({
  session,
  children,
}: {
  session: Session | null | undefined;
  children: ReactNode;
}) {
  const live = useContext(SessionContext);
  const value = useMemo((): typeof live => {
    if (!live || session === undefined) return live;
    // Never read yet: next-auth's provider starts with `data` undefined (its
    // type says null), and only a read sets it.
    const data: Session | null | undefined = live.data;
    if (live.status !== 'loading' || data !== undefined) return live;
    const { update } = live;
    return session
      ? { data: session, status: 'authenticated', update }
      : { data: null, status: 'unauthenticated', update };
  }, [live, session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
