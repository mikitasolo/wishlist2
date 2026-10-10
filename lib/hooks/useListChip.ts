'use client';

import type { ViewerRole } from '@/lib/utils/itemStatus';
import { useListUrlParam } from '@/lib/hooks/useListUrlParam';
import { LIST_CHIP_PARAM, listChipFor, type ListChip } from '@/lib/utils/listChips';

/**
 * The status chip a list is shown on (`lib/utils/listChips.ts`). It's kept with
 * the list (by id) and the viewer's role on it, so another list, or this one
 * once the role has changed, starts on All: nothing carries over. It's never
 * saved. It goes into the URL instead (`?show=`, replacing the history entry),
 * so back and refresh come back to it, and a list opened at such a URL starts
 * on that chip if the role has it. The URL rules (only while it names the list
 * on screen, put back under a new slug, re-read on back and forward) are
 * `useListUrlParam`'s, which `useListSearch` shares.
 *
 * `list` is the list on screen (null until it has loaded), and `urlId` the id
 * or slug the page's URL names a list by. Back or forward to another of this
 * list's history entries (an owner's tabs push one each, `useListTab`) takes
 * the chip that entry's URL says, as it would on a refresh.
 */
export function useListChip(
  list: { id: string; slug?: string | null } | null,
  urlId: string | null,
  role: ViewerRole
): [ListChip, (chip: ListChip) => void] {
  return useListUrlParam<ListChip>({
    list,
    urlId,
    param: LIST_CHIP_PARAM,
    scope: list ? `${list.id}:${role}` : null,
    parse: (raw) => listChipFor(raw, role),
    serialize: (chip) => (chip === 'all' ? null : chip),
  });
}
