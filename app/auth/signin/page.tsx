import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { auth } from '@/lib/auth';
import { getEnvVars, getTurnstileKeys } from '@/lib/env';
import { safeCallbackPath } from '@/lib/utils/callbackUrl';
import { signInDestination } from '@/lib/utils/signInForm';
import Spinner from '@/components/Spinner';
import SignInForm from './SignInForm';

interface SignInProps {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}

export default async function SignIn({ searchParams }: SignInProps) {
  // Rendered per request, so the widget is shown from the same reading of the
  // environment the server action checks its token against: never a widget
  // nothing checks, never a check with no widget to pass it.
  await connection();
  const turnstileSiteKey = getTurnstileKeys()?.siteKey;

  // Already signed in (an invitee opening an older invite email, whose button
  // came through here, or any link with sign-in in front): there's nothing to
  // sign in to, so go straight on to where the link was headed. Only ever to a
  // path on this site: `safeCallbackPath` gives `/` for anything else (an
  // absolute URL counts only on NEXTAUTH_URL's origin, the one emails link to
  // and Auth.js builds its callback URLs on), and for an auth page, which
  // would loop. Signing in as someone else means signing out first. Without a
  // session cookie this reads nothing from the database.
  const { callbackUrl } = await searchParams;
  const raw = Array.isArray(callbackUrl) ? callbackUrl[0] : callbackUrl;
  const origin = new URL(getEnvVars().NEXTAUTH_URL).origin;
  const session = await auth();
  if (session?.user?.id) {
    redirect(safeCallbackPath(raw, origin, '/auth'));
  }

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background px-4">
          <div className="max-w-md w-full bg-surface rounded-2xl border border-border shadow-lg p-8 text-center">
            <Spinner size="lg" />
          </div>
        </div>
      }
    >
      {/* From the callback's path alone: never a read of the list or profile,
          so the page can't name a private list or say whether it exists. */}
      <SignInForm
        turnstileSiteKey={turnstileSiteKey}
        destination={signInDestination(raw, origin)}
      />
    </Suspense>
  );
}
