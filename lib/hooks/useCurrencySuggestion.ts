'use client';

import { useSyncExternalStore } from 'react';
import { browserCurrencySuggestion } from '@/lib/utils/currencySuggestion';

// The suggestion only changes with the browser's time zone or language, which
// nothing here has to follow, so there's nothing to subscribe to.
const subscribe = () => () => {};
const getServerSnapshot = () => null;

/**
 * The currency of where this browser is (`suggestCurrency`), or null: always
 * null in a server render and in the render that hydrates it, so the server,
 * which can't know it, never renders anything built on it.
 */
export function useCurrencySuggestion(): string | null {
  return useSyncExternalStore(subscribe, browserCurrencySuggestion, getServerSnapshot);
}
