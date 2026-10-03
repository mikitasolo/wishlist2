'use client';

import { useSyncExternalStore } from 'react';
import { PRICE_FALLBACK_LOCALE } from '@/lib/utils/currency';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('languagechange', onChange);
  return () => window.removeEventListener('languagechange', onChange);
}

const getSnapshot = () => navigator.language || PRICE_FALLBACK_LOCALE;
const getServerSnapshot = () => PRICE_FALLBACK_LOCALE;

/**
 * The locale to format prices in: the browser's language (`navigator.language`,
 * which dates shown with `toLocaleDateString(undefined)` follow too), or the
 * fixed `PRICE_FALLBACK_LOCALE` in a server render and in the client render
 * that hydrates it. The server can't know the viewer's locale, so a price
 * formatted there in one locale and in the browser in another would be a
 * hydration mismatch, which React refuses. A component that first renders in
 * the browser gets the viewer's locale straight away.
 */
export function useViewerLocale(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
