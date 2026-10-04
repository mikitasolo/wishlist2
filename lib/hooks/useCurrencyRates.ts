'use client';

import { useEffect, useState } from 'react';

/**
 * The exchange rates (lowercase code → units per USD) from
 * `/api/currency-rates`, read once, the first time `wanted` is true, and kept
 * from then on. `null` until they've loaded, and if they couldn't be.
 */
export function useCurrencyRates(wanted: boolean): Record<string, number> | null {
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const read = wanted || rates !== null;
  useEffect(() => {
    if (!read) return;
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
  }, [read]);
  return rates;
}
