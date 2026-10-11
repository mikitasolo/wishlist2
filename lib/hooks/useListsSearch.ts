'use client';

import { useListUrlParam } from '@/lib/hooks/useListUrlParam';
import { LIST_SEARCH_PARAM } from '@/lib/utils/listChips';

const SCOPE = { id: 'lists' };

/**
 * The text a See all page (`/wishlists/mine`, `/wishlists/shared`, WIS-427)
 * filters its lists by, kept in the URL's `?q=` like `/items`, never saved.
 */
export function useListsSearch(pagePath: string): [string, (query: string) => void] {
  return useListUrlParam<string>({
    list: SCOPE,
    urlId: null,
    pagePath,
    param: LIST_SEARCH_PARAM,
    scope: SCOPE.id,
    parse: (raw) => raw ?? '',
    serialize: (query) => (query.trim() === '' ? null : query),
  });
}
