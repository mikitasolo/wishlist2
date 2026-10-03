'use client';

import { useId, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Button from './Button';
import Icon from './Icon';
import { ACTION_CARD_CLASSES } from './InviteCard';
import { useToast } from './ToastProvider';
import { CURRENCY_OPTIONS, SETTINGS_CURRENCY_PATH } from '@/lib/utils/currencies';
import { browserCurrencySuggestion, currencyToOffer } from '@/lib/utils/currencySuggestion';

const SAVE_ERROR = 'Failed to save your currency choice';

// The suggestion only changes with the browser's time zone or language, which
// nothing here has to follow, so there's nothing to subscribe to.
const subscribe = () => () => {};
const getServerSnapshot = () => null;

/** The currency on offer, and the two answers to it (`useCurrencyOffer`). */
export interface CurrencyOffer {
  /** The suggested currency's code ("PLN") and name ("Polish Zloty"). */
  code: string;
  name: string;
  /** "Choose another currency" is saving its answer: both buttons are held. */
  busy: boolean;
  /** "Use PLN": saves it as their currency, with the answer. */
  accept: () => void;
  /** "Choose another currency": records the answer, then opens the currency picker in Settings. */
  chooseAnother: () => void;
}

/**
 * The dashboard's one-time offer of a currency for someone still on the USD
 * every account starts on: "Show prices in PLN? [Use PLN] [Choose another currency]",
 * or `null` when there's nothing to offer. The suggestion is worked out in the
 * browser, from its time zone and language (`suggestCurrency`), and is null in
 * a server render and in the render that hydrates it, so the server, which
 * can't know it, never renders the prompt.
 *
 * Either answer records that they've answered (`currencyChosen`, which the
 * server stamps as `User.currencyChosenAt`), so it never shows again: "Use X"
 * saves X as their currency too, and "Choose another currency" takes them to the
 * currency picker in Settings. The offer goes once the answer is sent ("Use
 * X") or saved ("Choose another currency", which then leaves the page), and comes back,
 * with an error, if saving it fails. Who sees it is `currencyToOffer`.
 *
 * A hook, so the dashboard's "Needs you" knows whether the prompt is one of its
 * rows before it renders any; `CurrencyPrompt` draws it.
 */
export function useCurrencyOffer(): CurrencyOffer | null {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const { showToast } = useToast();
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

  return {
    code,
    name,
    busy,
    accept: () => void acceptSuggestion(code),
    chooseAnother: () => void chooseAnother(),
  };
}

/**
 * The currency offer (`useCurrencyOffer`) as one of the dashboard's "Needs you"
 * rows: a region named by its question, with Use X and Choose another currency.
 */
export default function CurrencyPrompt({
  offer,
  className = '',
}: {
  offer: CurrencyOffer;
  className?: string;
}) {
  const headingId = useId();
  const { code, name, busy } = offer;
  return (
    <section
      aria-labelledby={headingId}
      className={`${ACTION_CARD_CLASSES} sm:flex-col sm:items-stretch md:flex-row md:items-center md:justify-between ${className}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary-500/12 text-accent">
          <Icon name="globe" size={18} />
        </span>
        <div className="min-w-0">
          <h3 id={headingId} className="text-body font-semibold text-foreground">
            Show prices in {code}?
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {name} would be the default for your new wishlists, and other people&apos;s prices would
            show in it. You can change it any time in Settings.
          </p>
        </div>
      </div>
      {/* Stacked and full width on a phone, side by side under the text from
          `sm`, and next to it from `md`. A label never wraps: the buttons have
          a fixed height, so a second line would spill out of them. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end md:flex-shrink-0">
        <Button size="sm" onClick={offer.accept} disabled={busy} className="whitespace-nowrap">
          Use {code}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={offer.chooseAnother}
          disabled={busy}
          className="whitespace-nowrap"
        >
          Choose another currency
        </Button>
      </div>
    </section>
  );
}
