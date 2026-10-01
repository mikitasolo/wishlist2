'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Button from '@/components/Button';
import UsernameField from '@/components/UsernameField';
import { useToast } from '@/components/ToastProvider';
import { useUsernameAvailability } from '@/lib/hooks/useUsernameAvailability';
import { safeCallbackPath } from '@/lib/utils/callbackUrl';

const SAVE_FAILED = "Couldn't save your username";

function Loading() {
  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="spinner h-8 w-8 text-primary-600" />
      </div>
    </div>
  );
}

/**
 * The first page a brand-new account sees: Auth.js sends their first sign-in
 * here (`pages.newUser` in lib/auth.ts) with the URL they were headed to as
 * `callbackUrl`. It offers a username of their own in place of the generated
 * `user_…` one, through the same API and checks as the settings page. Saving
 * and keeping the generated one both continue to `callbackUrl`, if it's on
 * this site. Nothing makes them choose: Auth.js only sends the sign-in that
 * created the account here, and leaving the page any other way just keeps the
 * generated name.
 */
function Welcome() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  const current = session?.user?.username ?? '';
  // Null until edited, so the field starts on the current name once the session loads.
  const [draft, setDraft] = useState<string | null>(null);
  // While saving, the name being replaced: the session takes the new one before
  // the next page loads, and the copy shouldn't change under the user meanwhile.
  const [replacing, setReplacing] = useState<string | null>(null);
  const saving = replacing !== null;
  const shownCurrent = replacing ?? current;
  const username = draft ?? current;
  const availability = useUsernameAvailability(
    username,
    status === 'authenticated' ? current : null
  );
  const canSave = !saving && username !== current && availability === 'ok';

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  function continueOn() {
    router.replace(
      safeCallbackPath(searchParams.get('callbackUrl'), window.location.origin, '/welcome')
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setReplacing(current);
    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const result = await res.json();
      if (result.success) {
        // Refresh the session so the header shows the new name; a failure here
        // only delays that until the next session read, so it doesn't hold
        // up continuing.
        await update().catch(() => null);
        showToast('Username saved', 'success');
        // Stays "saving" (buttons disabled) while the next page loads.
        continueOn();
        return;
      }
      showToast(result.error || SAVE_FAILED, 'error');
    } catch {
      showToast(SAVE_FAILED, 'error');
    }
    setReplacing(null);
  }

  if (status !== 'authenticated') return <Loading />;

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <h1 className="mb-1 text-3xl font-semibold tracking-tight text-foreground">
          Welcome to Wishlist
        </h1>
        <p className="mb-8 text-muted-foreground">
          One quick thing before you start: how people will see you.
        </p>

        <form
          onSubmit={handleSave}
          className="rounded-2xl border border-border bg-surface p-6 shadow-md"
        >
          <h2 className="mb-1 text-lg font-semibold text-foreground">Pick a username</h2>
          <p className="mb-5 text-sm text-muted-foreground">
            {shownCurrent && (
              <>
                We&apos;ve given you <strong className="text-foreground">@{shownCurrent}</strong>{' '}
                for now.{' '}
              </>
            )}
            Your username is how other people find and see you. Your email stays private. You can
            change it any time in Settings.
          </p>

          <UsernameField
            value={username}
            onChange={setDraft}
            availability={availability}
            disabled={saving}
            autoFocus
          />

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={continueOn} disabled={saving}>
              {shownCurrent ? `Keep @${shownCurrent}` : 'Skip for now'}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {saving ? 'Saving…' : 'Save username'}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={<Loading />}>
      <Welcome />
    </Suspense>
  );
}
