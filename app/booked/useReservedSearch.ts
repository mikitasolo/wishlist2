'use client';

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { LIST_SEARCH_PARAM } from '@/lib/utils/listChips';

const readQuery = () => new URLSearchParams(window.location.search).get(LIST_SEARCH_PARAM) ?? '';

/**
 * The text the Reserved page is searched for (WIS-424), kept in the URL's `?q=`
 * with `history.replaceState` like a list's item search (`useListSearch`): no
 * history entries while typing, and refresh, back and a shared link come back to
 * it. Never saved. `useListUrlParam` is bound to `/wishlists/<id>` URLs, so this
 * page keeps its one value here with the same rules (read before paint, back and
 * forward re-read it).
 */
export function useReservedSearch(): [string, (query: string) => void] {
  const [query, setQuery] = useState('');

  // Before paint, so a `?q=` link never shows a frame of the unfiltered page.
  useLayoutEffect(() => {
    setQuery(readQuery());
  }, []);

  useEffect(() => {
    const onPopState = () => setQuery(readQuery());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const choose = useCallback((next: string) => {
    setQuery(next);
    const url = new URL(window.location.href);
    if (next.trim() === '') url.searchParams.delete(LIST_SEARCH_PARAM);
    else url.searchParams.set(LIST_SEARCH_PARAM, next);
    if (url.href !== window.location.href) window.history.replaceState(null, '', url);
  }, []);

  return [query, choose];
}
