import type { Session } from 'next-auth';
import { unstable_rethrow } from 'next/navigation';
import HomeGate from '@/components/HomeGate';
import Landing from '@/components/Landing';
import SeededSession from '@/components/SeededSession';
import { auth } from '@/lib/auth';
import { clientSession } from '@/lib/utils/sessionPayload';

/**
 * Home: the landing for a visitor, the dashboard for an account (WIS-269).
 * The session is read here, on the server, so the HTML is already the right
 * page: the landing complete (no spinner while the browser asks who's there),
 * or the signed-in header over the dashboard's skeleton. That makes `/`
 * dynamic, which only this page is: the root layout doesn't read the session.
 */
export default async function Home() {
  const session = await readSession();
  return (
    <SeededSession session={session}>
      {/* Not sent to an account: `HomeGate` asks for it again if it's needed. */}
      <HomeGate landing={session ? null : <Landing />} />
    </SeededSession>
  );
}

/**
 * The session for the browser, through `clientSession`'s allowlist; undefined
 * when it couldn't be read, so the page waits for the browser's own read as it
 * used to, rather than showing an account the landing. (No cookie needs no
 * database read, so a visitor always gets the landing.)
 */
async function readSession(): Promise<Session | null | undefined> {
  try {
    return clientSession(await auth());
  } catch (error) {
    // Next's own signals (this page reading cookies is what makes it dynamic)
    // go on up, or the build would prerender it without a session.
    unstable_rethrow(error);
    // Its kind only: a database error can quote what it was looking up.
    console.error(
      'Error reading the session for the home page:',
      error instanceof Error ? error.name : 'unknown'
    );
    return undefined;
  }
}
