'use client';

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { LIST_SEARCH_PARAM } from '@/lib/utils/listChips';

/** Whether the browser is on the page at `path` (`/wishlists/<id or slug>`). */
function onPage(path: string): boolean {
  try {
    return decodeURIComponent(window.location.pathname) === path;
  } catch {
    return false;
  }
}

function readQuery(): string {
  return new URLSearchParams(window.location.search).get(LIST_SEARCH_PARAM) ?? '';
}

/** Puts `query` in the URL's `?q=` (blank: takes it out), replacing the history entry. */
function writeQueryToUrl(query: string) {
  const url = new URL(window.location.href);
  if (query.trim() === '') url.searchParams.delete(LIST_SEARCH_PARAM);
  else url.searchParams.set(LIST_SEARCH_PARAM, query);
  if (url.href !== window.location.href) window.history.replaceState(null, '', url);
}

/**
 * The text a list's items are searched for (WIS-389), kept in the URL's `?q=`
 * with `history.replaceState` like the status chip's `?show=` (`useListChip`),
 * so typing adds no history entries and refresh, back and a shared link come
 * back to it. Never saved. It belongs to one list (by id): another list starts
 * empty. The URL is only read or written while it names the list on screen, so
 * the old list's query never lands in the next one's URL; when the list's URL
 * changes under it (a new slug) the query is put back in it.
 */
export function useListSearch(
  list: { id: string; slug?: string | null } | null,
  urlId: string | null
): [string, (query: string) => void] {
  const scope = list ? list.id : null;
  const path = urlId ? `/wishlists/${urlId}` : null;
  const urlIsList = !!list && !!urlId && (urlId === list.id || urlId === list.slug);
  const [state, setState] = useState<{ scope: string; query: string } | null>(null);

  // Before paint, so a list opened at ?q= never shows a frame of everything.
  useLayoutEffect(() => {
    if (!scope) return;
    const ours = urlIsList && !!path && onPage(path);
    if (state?.scope !== scope) {
      setState({ scope, query: ours ? readQuery() : '' });
    } else if (ours && state.query.trim() !== '') {
      writeQueryToUrl(state.query);
    }
  }, [scope, path, urlIsList, state]);

  // Back or forward to another history entry of this list: its URL wins.
  useEffect(() => {
    if (!scope) return;
    const onPopState = () => {
      if (!urlIsList || !path || !onPage(path)) return;
      setState({ scope, query: readQuery() });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [scope, path, urlIsList]);

  const query = state?.scope === scope ? state.query : '';

  const choose = useCallback(
    (next: string) => {
      if (!scope) return;
      setState({ scope, query: next });
      if (urlIsList && path && onPage(path)) writeQueryToUrl(next);
    },
    [scope, path, urlIsList]
  );

  return [query, choose];
}
