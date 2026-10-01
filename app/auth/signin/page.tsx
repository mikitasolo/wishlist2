import { Suspense } from 'react';
import { connection } from 'next/server';
import { getTurnstileKeys } from '@/lib/env';
import SignInForm from './SignInForm';

export default async function SignIn() {
  // Rendered per request, so the widget is shown from the same reading of the
  // environment the server action checks its token against: never a widget
  // nothing checks, never a check with no widget to pass it.
  await connection();
  const turnstileSiteKey = getTurnstileKeys()?.siteKey;

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background px-4">
          <div className="max-w-md w-full bg-surface rounded-2xl border border-border shadow-lg p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
          </div>
        </div>
      }
    >
      <SignInForm turnstileSiteKey={turnstileSiteKey} />
    </Suspense>
  );
}
