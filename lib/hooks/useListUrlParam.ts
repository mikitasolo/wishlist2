'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Whether the browser is on the page at `path` (`/wishlists/<id or slug>`). */
function onPage(path: string): boolean {
  try {
    return decodeURIComponent(window.location.pathname) === path;
  } catch {
    return false;
  }
}

function readParam(param: string): string | null {
  return new URLSearchParams(window.location.search).get(param);
}

/** Puts `raw` in the URL's `?<param>=` (null takes it out), replacing the history entry. */
function writeParam(param: string, raw: string | null) {
  const url = new URL(window.location.href);
  if (raw === null) url.searchParams.delete(param);
  else url.searchParams.set(param, raw);
  // Next's router picks up a replaceState, and keeps its own state with it.
  if (url.href !== window.location.href) window.history.replaceState(null, '', url);
}

type Options<T> = {
  /** The list on screen (null until it has loaded). */
  list: { id: string; slug?: string | null } | null;
  /** The id or slug the page's URL names a list by (null in link mode). */
  urlId: string | null;
  /**
   * For a page that isn't a list's (`/items`): the pathname the value lives on.
   * It stands in for `/wishlists/<urlId>`: the id/slug check is skipped, so `list`
   * only scopes the value (pass a fixed id) and `urlId` is unused.
   */
  pagePath?: string;
  /** The URL query parameter, e.g. `show` or `q`. */
  param: string;
  /** What the value is kept with: another scope starts again from `parse(null)`. */
  scope: string | null;
  /** The URL's raw value (null: none) as a value; must accept anything. */
  parse: (raw: string | null) => T;
  /** The value as the URL carries it, or null for the default (nothing in the URL). */
  serialize: (value: T) => string | null;
};

/**
 * One list-scoped value kept in a URL query parameter with
 * `history.replaceState`, never saved: the shared core of `useListChip`
 * (`?show=`) and `useListSearch` (`?q=`). The value belongs to a scope (the
 * list, and what else resets it); another scope starts from the URL's value
 * if the URL names the list on screen, else from `parse(null)`. The URL is only
 * read or written while it names the list on screen, so the old list's value
 * never lands in the next one's URL; when the list's URL changes under it (a
 * new slug) a non-default value is put back in it; back and forward to another
 * history entry of the list re-read its URL.
 */
export function useListUrlParam<T>({
  list,
  urlId,
  param,
  pagePath,
  scope,
  parse,
  serialize,
}: Options<T>): [T, (value: T) => void] {
  const path = pagePath ?? (urlId ? `/wishlists/${urlId}` : null);
  // The URL is this list's page.
  const urlIsList =
    !!list && (pagePath ? true : !!urlId && (urlId === list.id || urlId === list.slug));
  const [state, setState] = useState<{ scope: string; value: T } | null>(null);
  // Read by the effects below without being their dependencies: a change of
  // value (which `choose` already writes to the URL) isn't written twice, and
  // callers may pass `parse` / `serialize` inline.
  const latest = useRef({ state, parse, serialize });
  useLayoutEffect(() => {
    latest.current = { state, parse, serialize };
  });

  // Before paint, so a list opened at such a URL never shows a frame of the default.
  useLayoutEffect(() => {
    if (!scope) return;
    const { state: current, parse: parseNow, serialize: serializeNow } = latest.current;
    const ours = urlIsList && !!path && onPage(path);
    if (current?.scope !== scope) {
      setState({ scope, value: parseNow(ours ? readParam(param) : null) });
    } else if (ours) {
      // The same list at a new URL, which doesn't carry the value.
      const raw = serializeNow(current.value);
      if (raw !== null) writeParam(param, raw);
    }
  }, [scope, path, urlIsList, param]);

  // Back or forward to another history entry of this list: its URL wins.
  useEffect(() => {
    if (!scope) return;
    const onPopState = () => {
      if (!urlIsList || !path || !onPage(path)) return;
      setState({ scope, value: latest.current.parse(readParam(param)) });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [scope, path, urlIsList, param]);

  const value = state && state.scope === scope ? state.value : parse(null);

  const choose = useCallback(
    (next: T) => {
      if (!scope) return;
      setState({ scope, value: next });
      if (urlIsList && path && onPage(path)) writeParam(param, latest.current.serialize(next));
    },
    [scope, path, urlIsList, param]
  );

  return [value, choose];
}
