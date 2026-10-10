'use client';

import { useListUrlParam } from '@/lib/hooks/useListUrlParam';
import { LIST_SEARCH_PARAM } from '@/lib/utils/listChips';

/**
 * The text a list's items are searched for (WIS-389), kept in the URL's `?q=`
 * with `history.replaceState` like the status chip's `?show=` (`useListChip`),
 * so typing adds no history entries and refresh, back and a shared link come
 * back to it. Never saved. It belongs to one list (by id): another list starts
 * empty. The URL rules are `useListUrlParam`'s: only read or written while it
 * names the list on screen, put back when the list's URL changes (a new slug),
 * re-read on back and forward.
 *
 * In link mode (`/l/<token>`) the URL never names the list, so the query stays
 * page state there and a share token's URL is never touched.
 */
export function useListSearch(
  list: { id: string; slug?: string | null } | null,
  urlId: string | null
): [string, (query: string) => void] {
  return useListUrlParam<string>({
    list,
    urlId,
    param: LIST_SEARCH_PARAM,
    scope: list ? list.id : null,
    parse: (raw) => raw ?? '',
    serialize: (query) => (query.trim() === '' ? null : query),
  });
}
