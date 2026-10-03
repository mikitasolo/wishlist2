/**
 * How every screen counts a list's items, so the same list never shows two
 * different numbers (a card, a dashboard tile, a profile, a share card).
 *
 * "N items" always means the list's **published** items: available, booked and
 * completed. Booked folds into it for everyone, so no count ever tells an owner
 * how much of their list has been reserved, and there is no "N booked" anywhere.
 *
 * Drafts and proposals awaiting review are counted separately, and only on a
 * surface for the list's owners ("· 2 drafts · 2 to review"): a member or
 * visitor never sees a draft counted, nor anyone's proposal.
 *
 * Pure, so the browser can count what it has loaded the same way the server
 * counts (`countWishlistItems`, `lib/utils/wishlistItemCounts.ts`).
 */

import { plural } from '@/lib/utils/plural';

/** The statuses an "N items" count includes. */
export const PUBLISHED_ITEM_STATUSES = ['available', 'booked', 'completed'] as const;

/** Whether an item in this status counts towards "N items". */
export function isPublishedItem(status: string): boolean {
  return (PUBLISHED_ITEM_STATUSES as readonly string[]).includes(status);
}

/** A list's (or several lists') item counts. */
export interface ItemCounts {
  /** Published items: what "N items" says. */
  items: number;
  /** Drafts. Owner surfaces only. */
  drafts: number;
  /** Proposals awaiting review. Owner surfaces only. */
  proposals: number;
}

export const NO_ITEMS: Readonly<ItemCounts> = Object.freeze({ items: 0, drafts: 0, proposals: 0 });

/** Counts a set of items by the rule above. */
export function tallyItems(items: Iterable<{ status: string }>): ItemCounts {
  const counts = { ...NO_ITEMS };
  for (const { status } of items) {
    if (isPublishedItem(status)) counts.items++;
    else if (status === 'draft') counts.drafts++;
    else if (status === 'proposed') counts.proposals++;
  }
  return counts;
}

/** Adds several lists' counts together (a missing count is zero). */
export function sumItemCounts(all: Iterable<Partial<ItemCounts> | null | undefined>): ItemCounts {
  const total = { ...NO_ITEMS };
  for (const c of all) {
    total.items += c?.items ?? 0;
    total.drafts += c?.drafts ?? 0;
    total.proposals += c?.proposals ?? 0;
  }
  return total;
}

/** "1 item", "12 items". */
export function formatItemCount(n: number): string {
  return plural(n, 'item');
}

/**
 * The owner-only extras that go next to "N items": "2 drafts · 1 to review".
 * Null when there are none, so a list without any shows nothing extra.
 */
export function formatOwnerExtras(
  counts: Partial<Pick<ItemCounts, 'drafts' | 'proposals'>>
): string | null {
  const drafts = counts.drafts ?? 0;
  const proposals = counts.proposals ?? 0;
  const parts = [
    drafts > 0 ? plural(drafts, 'draft') : null,
    proposals > 0 ? `${proposals} to review` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** "12 items · 2 drafts · 1 to review" for an owner, or just "12 items". */
export function formatOwnerItemSummary(counts: ItemCounts): string {
  const extras = formatOwnerExtras(counts);
  return extras ? `${formatItemCount(counts.items)} · ${extras}` : formatItemCount(counts.items);
}
