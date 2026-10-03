'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { SelectOption } from '@/components/Select';
import { currencySelectOptions } from '@/lib/utils/currencies';
import {
  defaultPricesChoice,
  needsPricesControl,
  ORIGINAL_PRICES,
  pricesChoiceKey,
  rememberPricesChoice,
  savedPricesChoice,
  viewerPriceCurrency,
  type PricesContext,
} from '@/lib/utils/listPrices';

interface ListPricesInput {
  /** The signed-in viewer's id; signed out, there's no Prices control. */
  viewerId: string | null;
  /** Their `defaultCurrency`, in whatever case the session has it. */
  defaultCurrency: string | null | undefined;
  /** Whether the viewer owns the list. */
  ownList: boolean;
  items: readonly { price?: { currency: string } | null }[];
}

export interface ListPrices {
  /** Whether to offer the Prices control (see `needsPricesControl`), once the rates are in. */
  shown: boolean;
  /** The currency to show prices in, or `ORIGINAL_PRICES`. */
  value: string;
  options: SelectOption[];
  /** What the control's trigger says: the code, or "Original". */
  valueLabel: string;
  /** The viewer picks a currency: shown at once, and remembered (`rememberPricesChoice`). */
  choose: (value: string) => void;
  /** Exchange rates (lowercase code → units per USD), once they've loaded; only read when Prices could show. */
  rates: Record<string, number> | null;
}

/**
 * The Prices control on a list, by the rules in `lib/utils/listPrices.ts` (D9):
 * where it starts, whether it's offered, and the viewer's remembered pick,
 * which is read from this browser's storage before the page paints, and
 * ignored if storage can't be read. The exchange rates are only read once
 * the control could show (a signed-in viewer, some price in another currency).
 */
export function useListPrices({
  viewerId,
  defaultCurrency,
  ownList,
  items,
}: ListPricesInput): ListPrices {
  const viewerCurrency = viewerPriceCurrency(defaultCurrency);
  const context: PricesContext = ownList ? 'own' : 'others';
  const key = viewerId ? pricesChoiceKey(viewerId, context) : null;

  // The pick for `key` (none: null). Kept with its key, so a pick for another
  // context or account is never applied here.
  const [picked, setPicked] = useState<{ key: string; value: string | null } | null>(null);
  // Before paint, so a remembered pick doesn't flash the default first.
  useLayoutEffect(() => {
    if (!viewerId || !key) return;
    let value: string | null = null;
    try {
      value = savedPricesChoice(localStorage, viewerId, context, viewerCurrency);
    } catch {
      /* storage blocked: the default */
    }
    setPicked({ key, value });
  }, [viewerId, context, key, viewerCurrency]);

  const needed = !!viewerId && needsPricesControl(items, viewerCurrency);
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  // Read once, the first time they're needed.
  const ratesWanted = needed || rates !== null;
  useEffect(() => {
    if (!ratesWanted) return;
    let cancelled = false;
    fetch('/api/currency-rates', { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (!cancelled && res.success) setRates(res.data.rates as Record<string, number>);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ratesWanted]);

  const shown = needed && rates !== null;
  const choice = picked && picked.key === key ? picked.value : null;
  // Hidden, every price is in the viewer's currency already, or none can be
  // converted yet, so each is shown as it is.
  const value = shown ? (choice ?? defaultPricesChoice(context, viewerCurrency)) : ORIGINAL_PRICES;

  const choose = useCallback(
    (next: string) => {
      if (!viewerId || !key) return;
      setPicked({ key, value: next });
      try {
        rememberPricesChoice(localStorage, viewerId, context, next, viewerCurrency);
      } catch {
        /* storage blocked: kept for this visit only */
      }
    },
    [viewerId, key, context, viewerCurrency]
  );

  // Each item's own currency, then the viewer's, then the rest.
  const options = useMemo(() => {
    const opts: SelectOption[] = [{ value: ORIGINAL_PRICES, label: 'Each item’s currency' }];
    const mine = currencySelectOptions.find((o) => o.value === viewerCurrency);
    opts.push({ value: viewerCurrency, label: `${mine?.label ?? viewerCurrency} · your default` });
    for (const o of currencySelectOptions) {
      if (o.value !== viewerCurrency) opts.push(o);
    }
    return opts;
  }, [viewerCurrency]);

  const valueLabel = value === ORIGINAL_PRICES ? 'Original' : value;

  return { shown, value, options, valueLabel, choose, rates };
}
