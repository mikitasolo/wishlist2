'use client';

import { useCallback, useLayoutEffect, useState } from 'react';
import type { ViewerRole } from '@/lib/utils/itemStatus';
import { LIST_CHIP_PARAM, listChipFor, type ListChip } from '@/lib/utils/listChips';

/** Whether the browser is on the page at `path` (`/wishlists/<id or slug>`). */
function onPage(path: string): boolean {
  try {
    return decodeURIComponent(window.location.pathname) === path;
  } catch {
    return false;
  }
}

/** Puts `chip` in the URL's `?show=` (All: takes it out), replacing the history entry. */
function writeChipToUrl(chip: ListChip) {
  const url = new URL(window.location.href);
  if (chip === 'all') url.searchParams.delete(LIST_CHIP_PARAM);
  else url.searchParams.set(LIST_CHIP_PARAM, chip);
  // Next's router picks up a replaceState, and keeps its own state with it.
  if (url.href !== window.location.href) window.history.replaceState(null, '', url);
}

/**
 * The status chip a list is shown on (`lib/utils/listChips.ts`). It's kept with
 * the list (by id) and the viewer's role on it, so another list, or this one
 * once the role has changed, starts on All: nothing carries over. It's never
 * saved. It goes into the URL instead (`?show=`, replacing the history entry),
 * so back and refresh come back to it, and a list opened at such a URL starts
 * on that chip if the role has it.
 *
 * `list` is the list on screen (null until it has loaded), and `urlId` the id
 * or slug the page's URL names a list by. The URL is only read or written
 * while it names the list on screen: while the page moves on to another list,
 * the old list's chip must not land in the new one's URL. When the list's URL
 * changes under it (an owner gave it a new slug), the chip is put back in it.
 */
export function useListChip(
  list: { id: string; slug?: string | null } | null,
  urlId: string | null,
  role: ViewerRole
): [ListChip, (chip: ListChip) => void] {
  const scope = list ? `${list.id}:${role}` : null;
  const path = urlId ? `/wishlists/${urlId}` : null;
  // The URL is this list's page.
  const urlIsList = !!list && !!urlId && (urlId === list.id || urlId === list.slug);
  const [choice, setChoice] = useState<{ scope: string; chip: ListChip } | null>(null);

  // Before paint, so a list opened at ?show= never shows a frame of All.
  useLayoutEffect(() => {
    if (!scope) return;
    const ours = urlIsList && !!path && onPage(path);
    if (choice?.scope !== scope) {
      // A list (or role) the page hasn't shown yet starts on the URL's chip,
      // if it's one of the role's, else on All.
      const fromUrl = ours
        ? new URLSearchParams(window.location.search).get(LIST_CHIP_PARAM)
        : null;
      setChoice({ scope, chip: listChipFor(fromUrl, role) });
    } else if (ours && choice.chip !== 'all') {
      // The same list at a new URL, which doesn't carry the chip.
      writeChipToUrl(choice.chip);
    }
  }, [scope, path, role, urlIsList, choice]);

  const chip = choice?.scope === scope ? choice.chip : 'all';

  const choose = useCallback(
    (next: ListChip) => {
      if (!scope) return;
      setChoice({ scope, chip: next });
      if (urlIsList && path && onPage(path)) writeChipToUrl(next);
    },
    [scope, path, urlIsList]
  );

  return [chip, choose];
}
