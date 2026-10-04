'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Button from '@/components/Button';
import Panel from '@/components/Panel';
import { Skeleton } from '@/components/Skeleton';
import Field from '@/components/Field';
import Select from '@/components/Select';
import UsernameField from '@/components/UsernameField';
import { useToast } from '@/components/ToastProvider';
import { useUsernameAvailability } from '@/lib/hooks/useUsernameAvailability';
import { useCurrencySuggestion } from '@/lib/hooks/useCurrencySuggestion';
import { safeCallbackPath } from '@/lib/utils/callbackUrl';
import { currencySelectOptions } from '@/lib/utils/currencies';
import { currencyToOffer } from '@/lib/utils/currencySuggestion';

const SAVE_FAILED = "Couldn't save your username";

/** The page's skeleton: its heading, then the username panel, while the session is read. */
function Loading() {
  return (
    <div className="min-h-screen">
      <AppHeader minimal actions={<AuthButton />} />
      <main aria-hidden="true" className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Skeleton className="mb-2 h-9 w-72 max-w-full" />
        <Skeleton className="mb-8 h-5 w-96 max-w-full" />
        <Panel>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-1.5 h-4 w-2/3" />
          <div className="mt-5">
            <Skeleton className="mb-1.5 h-4 w-20" />
            <Skeleton className="h-11 w-full rounded-xl" />
            <Skeleton className="mt-1.5 h-3 w-1/2" />
          </div>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Skeleton className="h-11 w-full rounded-xl sm:w-40" />
            <Skeleton className="h-11 w-full rounded-xl sm:w-36" />
          </div>
        </Panel>
      </main>
    </div>
  );
}

/**
 * The first page a brand-new account sees: Auth.js sends their first sign-in
 * here (`pages.newUser` in lib/auth.ts) with the URL they were headed to as
 * `callbackUrl`. It offers a username of their own in place of the generated
 * `user_…` one, through the same API and checks as the settings page, and,
 * when the dashboard would otherwise ask (`currencyToOffer`), their currency,
 * set to what the browser suggests, so that question is answered here and
 * never turns up as a prompt on Home. The username field starts empty (the
 * generated handle is only in the Keep button), and saving and keeping the
 * generated one both continue to `callbackUrl`, if it's on this site. Nothing
 * makes them choose a username: Auth.js only sends the sign-in that created
 * the account here, and leaving the page any other way just keeps the
 * generated name (and leaves the currency question for Home).
 */
function Welcome() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  const current = session?.user?.username ?? '';
  const [username, setUsername] = useState('');
  // While saving, the name being replaced: the session takes the new one before
  // the next page loads, and the copy shouldn't change under the user meanwhile.
  const [replacing, setReplacing] = useState<string | null>(null);
  const saving = replacing !== null;
  const shownCurrent = replacing ?? current;
  const availability = useUsernameAvailability(
    username,
    status === 'authenticated' ? current : null
  );
  const canSave = !saving && username !== '' && username !== current && availability === 'ok';

  // The currency question, only if Home would ask it. Null until the browser's
  // suggestion is known; the row's own pick, once made, replaces the suggestion.
  const suggestion = useCurrencySuggestion();
  const offered = currencyToOffer(session?.user, suggestion);
  const [pickedCurrency, setPickedCurrency] = useState<string | null>(null);
  const currency = offered ? (pickedCurrency ?? offered) : null;
  const currentCurrency = (session?.user?.defaultCurrency ?? 'USD').toUpperCase();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace('/');
  }, [status, router]);

  function continueOn() {
    router.replace(
      safeCallbackPath(searchParams.get('callbackUrl'), window.location.origin, '/welcome')
    );
  }

  /** Save what the page asks for, then continue; `withUsername` is false for Keep. */
  async function submit(withUsername: boolean) {
    if (saving || (withUsername && !canSave)) return;
    setReplacing(current);
    const body: Record<string, unknown> = {};
    if (withUsername) body.username = username;
    if (currency) {
      // Answering the question is what keeps Home from asking it again.
      body.currencyChosen = true;
      if (currency !== currentCurrency) body.defaultCurrency = currency;
    }
    try {
      if (Object.keys(body).length > 0) {
        const res = await fetch('/api/users/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const result = await res.json();
        if (!result.success) {
          showToast(result.error || SAVE_FAILED, 'error');
          setReplacing(null);
          return;
        }
        // Refresh the session so the header shows the new name and the currency
        // answer; a failure here only delays that until the next session read,
        // so it doesn't hold up continuing.
        await update().catch(() => null);
        if (withUsername) showToast('Username saved', 'success');
      }
      // Stays "saving" (buttons disabled) while the next page loads.
      continueOn();
      return;
    } catch {
      showToast(SAVE_FAILED, 'error');
    }
    setReplacing(null);
  }

  if (status !== 'authenticated') return <Loading />;

  return (
    <div className="min-h-screen">
      <AppHeader minimal actions={<AuthButton />} />
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <h1 className="mb-1 text-3xl font-semibold tracking-tight text-foreground">
          Welcome to Wishlist
        </h1>
        <p className="mb-8 text-muted-foreground">
          One quick thing before you start: how people will see you.
        </p>

        <Panel
          as="form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(true);
          }}
          title="Pick a username"
          description="Your username is how other people find and see you, and how they invite you to their lists. Your email stays private. You can change it any time in Settings."
        >
          <UsernameField
            value={username}
            onChange={setUsername}
            availability={username === '' ? 'idle' : availability}
            disabled={saving}
            placeholder="e.g. maria_nowak"
            autoFocus
          />

          {currency && (
            <div className="mt-4">
              <Field
                label="Currency"
                id="welcome-currency"
                helper="The default for your new lists, and the currency other people’s prices show in. Change it any time in Settings."
              >
                <Select
                  value={currency}
                  onChange={setPickedCurrency}
                  options={currencySelectOptions}
                  disabled={saving}
                  ariaLabel="Currency"
                  size="md"
                  triggerClassName="w-full sm:w-80"
                />
              </Field>
            </div>
          )}

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void submit(false)}
              disabled={saving}
            >
              {shownCurrent ? `Keep @${shownCurrent}` : 'Skip for now'}
            </Button>
            <Button type="submit" disabled={!canSave}>
              {saving ? 'Saving…' : 'Save username'}
            </Button>
          </div>
        </Panel>
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
