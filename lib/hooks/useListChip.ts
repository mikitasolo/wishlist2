'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ViewerRole } from '@/lib/utils/itemStatus';
import { LIST_CHIP_PARAM, listChipFor, type ListChip } from '@/lib/utils/listChips';

/** Whether the browser is on this list's page (`/wishlists/<id or slug>`). */
function onListPage(path: string): boolean {
  try {
    return decodeURIComponent(window.location.pathname) === path;
  } catch {
    return false;
  }
}

/**
 * The status chip a list is shown on (`lib/utils/listChips.ts`). It's kept with
 * the list (by id) and the viewer's role on it, so another list, or this one
 * once the role has changed, starts on All: nothing carries over. It's never
 * saved. It goes into the URL instead (`?show=`, replacing the history entry),
 * so back and refresh come back to it, and a list opened at such a URL starts
 * on that chip if the role has it.
 *
 * `listId` is null until the list has loaded; `urlId` is the id or slug the
 * page's URL names the list by.
 */
export function useListChip(
  listId: string | null,
  urlId: string | null,
  role: ViewerRole
): [ListChip, (chip: ListChip) => void] {
  const scope = listId ? `${listId}:${role}` : null;
  const path = urlId ? `/wishlists/${urlId}` : null;
  const [choice, setChoice] = useState<{ scope: string; chip: ListChip } | null>(null);

  // A list (or role) the page hasn't shown yet starts on the URL's chip, if
  // the URL is this list's and names one of the role's chips, else on All.
  useEffect(() => {
    if (!scope || !path) return;
    const fromUrl = onListPage(path)
      ? new URLSearchParams(window.location.search).get(LIST_CHIP_PARAM)
      : null;
    setChoice((c) => (c?.scope === scope ? c : { scope, chip: listChipFor(fromUrl, role) }));
  }, [scope, path, role]);

  const chip = choice?.scope === scope ? choice.chip : 'all';

  const choose = useCallback(
    (next: ListChip) => {
      if (!scope) return;
      setChoice({ scope, chip: next });
      if (!path || !onListPage(path)) return;
      const url = new URL(window.location.href);
      if (next === 'all') url.searchParams.delete(LIST_CHIP_PARAM);
      else url.searchParams.set(LIST_CHIP_PARAM, next);
      // Next's router picks up a replaceState, and keeps its own state with it.
      if (url.href !== window.location.href) window.history.replaceState(null, '', url);
    },
    [scope, path]
  );

  return [chip, choose];
}
