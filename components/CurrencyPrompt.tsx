'use client';

import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Button from './Button';
import Icon from './Icon';
import Panel from './Panel';
import { useToast } from './ToastProvider';
import { CURRENCY_OPTIONS, SETTINGS_CURRENCY_PATH } from '@/lib/utils/currencies';
import { browserCurrencySuggestion, currencyToOffer } from '@/lib/utils/currencySuggestion';

const SAVE_ERROR = 'Failed to save your currency choice';

// The suggestion only changes with the browser's time zone or language, which
// nothing here has to follow, so there's nothing to subscribe to.
const subscribe = () => () => {};
const getServerSnapshot = () => null;

/**
 * The dashboard's one-time offer of a currency for someone still on the USD
 * every account starts on: "Show prices in PLN? [Use PLN] [Choose another currency]".
 * The suggestion is worked out in the browser, from its time zone and language
 * (`suggestCurrency`), and is null in a server render and in the render that
 * hydrates it, so the server, which can't know it, never renders the prompt.
 *
 * Either answer records that they've answered (`currencyChosen`, which the
 * server stamps as `User.currencyChosenAt`), so it never shows again: "Use X"
 * saves X as their currency too, and "Choose another currency" takes them to the
 * currency picker in Settings. The prompt goes once the answer is sent ("Use
 * X") or saved ("Choose another currency", which then leaves the page), and comes back,
 * with an error, if saving it fails. Who sees it is `currencyToOffer`.
 */
export default function CurrencyPrompt() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const headingId = useId();
  const suggestion = useSyncExternalStore(subscribe, browserCurrencySuggestion, getServerSnapshot);
  const [answered, setAnswered] = useState(false);
  const [busy, setBusy] = useState(false);
  // Set as the click lands, so a second click before the re-render is ignored.
  const sending = useRef(false);

  const code =
    status === 'authenticated' && !answered ? currencyToOffer(session?.user, suggestion) : null;
  if (!code) return null;
  const name = CURRENCY_OPTIONS.find((c) => c.code === code)?.name ?? code;

  /** Send the answer, plus `changes`; resolves whether it was saved. */
  async function saveAnswer(changes: { defaultCurrency?: string }): Promise<boolean> {
    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...changes, currencyChosen: true }),
      });
      const result = await res.json();
      if (result.success) return true;
      showToast(result.error || SAVE_ERROR, 'error');
    } catch {
      showToast(SAVE_ERROR, 'error');
    }
    return false;
  }

  async function acceptSuggestion(currency: string) {
    if (sending.current) return;
    sending.current = true;
    setAnswered(true);
    const saved = await saveAnswer({ defaultCurrency: currency });
    sending.current = false;
    if (!saved) {
      setAnswered(false);
      return;
    }
    showToast(`Prices will show in ${currency}`, 'success');
    // The session carries their currency (new lists, others' prices) and the
    // answer, so it's read again.
    void update();
  }

  async function chooseAnother() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    const saved = await saveAnswer({});
    sending.current = false;
    setBusy(false);
    if (!saved) return;
    setAnswered(true);
    void update();
    router.push(SETTINGS_CURRENCY_PATH);
  }

  return (
    <Panel
      aria-labelledby={headingId}
      className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/12 text-accent dark:text-primary-300">
          <Icon name="globe" size={20} />
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="font-semibold text-foreground">
            Show prices in {code}?
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {name} would be the default for your new wishlists, and other people&apos;s prices would
            show in it. You can change it any time in Settings.
          </p>
        </div>
      </div>
      {/* Stacked and full width on a phone, side by side under the text from
          `sm`, and next to it from `md`. A label never wraps: the buttons have
          a fixed height, so a second line would spill out of them. */}
      <div className="flex flex-col gap-2 sm:flex-row md:shrink-0">
        <Button
          onClick={() => acceptSuggestion(code)}
          disabled={busy}
          className="whitespace-nowrap"
        >
          Use {code}
        </Button>
        <Button
          variant="secondary"
          onClick={chooseAnother}
          disabled={busy}
          className="whitespace-nowrap"
        >
          Choose another currency
        </Button>
      </div>
    </Panel>
  );
}
