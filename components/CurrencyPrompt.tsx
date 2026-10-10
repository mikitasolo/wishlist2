'use client';

import { useId, useRef, useState } from 'react';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import Button from './Button';
import Icon from './Icon';
import Select from './Select';
import { useToast } from './ToastProvider';
import { useCurrencySuggestion } from '@/lib/hooks/useCurrencySuggestion';
import { CURRENCY_OPTIONS, currencySelectOptions } from '@/lib/utils/currencies';
import { currencyToOffer } from '@/lib/utils/currencySuggestion';

const SAVE_ERROR = 'Failed to save your currency choice';

/** The currency on offer, and the three answers to it (`useCurrencyOffer`). */
export interface CurrencyOffer {
  /** The suggested currency's code ("PLN") and name ("Polish Zloty"). */
  code: string;
  name: string;
  /** An answer is being saved: every answer is held. */
  busy: boolean;
  /** "Use PLN": saves it as their currency, with the answer. */
  accept: () => void;
  /** The other currency picked from the menu: saves it, with the answer. */
  pick: (code: string) => void;
  /** "Keep USD": records the answer and leaves the currency as it is. */
  keep: () => void;
}

/**
 * The dashboard's one-time offer of a currency for someone still on the USD
 * every account starts on: "Show prices in PLN? [Use PLN] [Other currency ▾] [Keep USD]",
 * or `null` when there's nothing to offer. The suggestion is worked out in the
 * browser, from its time zone and language (`suggestCurrency`), and is null in
 * a server render and in the render that hydrates it, so the server, which
 * can't know it, never renders the prompt.
 *
 * Each answer records that they've answered (`currencyChosen`, which the
 * server stamps as `User.currencyChosenAt`), so it never shows again, and none
 * of them navigates: "Use X" saves X as their currency, picking another one
 * from the menu saves that, and "Keep USD" saves nothing but the answer. The
 * offer goes once the answer is sent, and comes back, with an error, if saving
 * it fails. Who sees it is `currencyToOffer`.
 *
 * A hook, so the dashboard's "Needs you" knows whether the prompt is one of its
 * rows before it renders any; `CurrencyPrompt` draws it.
 */
export function useCurrencyOffer(): CurrencyOffer | null {
  const { data: session, status, update } = useKnownSession();
  const { showToast } = useToast();
  const suggestion = useCurrencySuggestion();
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

  /** Answer with `changes`: the offer goes at once, and comes back if it isn't saved. */
  async function answer(changes: { defaultCurrency?: string }, message: string) {
    if (sending.current) return;
    sending.current = true;
    setAnswered(true);
    setBusy(true);
    const saved = await saveAnswer(changes);
    sending.current = false;
    setBusy(false);
    if (!saved) {
      setAnswered(false);
      return;
    }
    showToast(message, 'success');
    // The session carries their currency (new lists, others' prices) and the
    // answer, so it's read again.
    void update();
  }

  const saveCurrency = (currency: string) =>
    void answer({ defaultCurrency: currency }, `Prices will show in ${currency}`);

  return {
    code,
    name,
    busy,
    accept: () => saveCurrency(code),
    pick: (other) => saveCurrency(other),
    keep: () => void answer({}, 'Prices will stay in USD'),
  };
}

/**
 * The currency offer (`useCurrencyOffer`) as a slim banner under the
 * dashboard's "Needs you": a region named by its question, with Use X, a menu
 * of other currencies and Keep USD. A phone gets the question and one row of
 * compact controls (no paragraph); from `sm` the explanation sits beside them.
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
  const otherCurrencies = currencySelectOptions.filter((o) => o.value !== code);
  return (
    <section
      aria-labelledby={headingId}
      className={`flex flex-col gap-2 rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm md:flex-row md:items-center md:justify-between md:gap-4 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="hidden h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary-500/12 text-accent sm:inline-flex">
          <Icon name="globe" size={16} />
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-semibold text-foreground">
            Show prices in {code}?
          </h2>
          <p className="hidden text-xs text-muted-foreground sm:block">
            {name} would be your default; change it any time in Settings.
          </p>
        </div>
      </div>
      {/* One row, even on a phone. A label never wraps: the controls have a
          fixed height, so a second line would spill out of them. */}
      <div className="flex flex-wrap items-center gap-2 md:flex-shrink-0">
        <Button size="sm" onClick={offer.accept} disabled={busy} className="whitespace-nowrap">
          Use {code}
        </Button>
        <Select
          size="sm"
          value=""
          onChange={offer.pick}
          options={otherCurrencies}
          disabled={busy}
          ariaLabel="Other currency"
          placeholder="Other"
          triggerClassName="w-24 sm:w-40"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={offer.keep}
          disabled={busy}
          className="whitespace-nowrap"
        >
          Keep USD
        </Button>
      </div>
    </section>
  );
}
