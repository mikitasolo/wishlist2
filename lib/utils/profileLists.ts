/**
 * What a profile says about its lists (WIS-272). Pure, so the wording is
 * tested without rendering the page.
 */

import { plural } from '@/lib/utils/plural';
import { rowOwnerLabel, type RowMetaList } from '@/lib/utils/listRows';

/**
 * The line over your own profile's lists: how many of them a signed-out
 * visitor could open (`visitorCount` from `GET /api/users/[id]/wishlists`,
 * which only your own profile gets) out of the `total` shown to you.
 * "Visitors see 3 of your 5 lists". Nothing when you have none, since the
 * empty state says so, or when the count wasn't sent.
 */
export function visitorLine(visible: number | null | undefined, total: number): string | null {
  if (visible == null || total <= 0) return null;
  const shown = Math.min(Math.max(visible, 0), total);
  if (shown === total) {
    return total === 1 ? 'Visitors see your list' : `Visitors see all ${total} of your lists`;
  }
  if (shown === 0) {
    return total === 1
      ? 'Visitors don’t see your list'
      : `Visitors see none of your ${total} lists`;
  }
  return `Visitors see ${shown} of your ${plural(total, 'list')}`;
}

/**
 * Who else owns a list shown on `profileUserId`'s profile, on a co-owned list
 * only ("with @chloe_r", "with @chloe_r +1"), and `null` on a list that's
 * theirs alone: the profile already says whose lists these are. Named by
 * username, or `publicDisplayName` ("Someone"), never an email.
 */
export function profileCoOwnerLabel(list: RowMetaList, profileUserId: string): string | null {
  return rowOwnerLabel(list, { shared: false, viewerId: profileUserId });
}
