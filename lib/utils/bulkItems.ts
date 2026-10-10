import { plural } from '@/lib/utils/plural';

/**
 * Bulk item actions (WIS-386): an owner's Select mode on their list, and the
 * one request (`POST /api/wishlists/[id]/items/bulk`) that applies an action
 * to every picked item, each held to the rules a single item's change is.
 * Framework-free and client-safe: the page, the route and the tests share it.
 *
 * Owners are booking-blind, and nothing here takes a booking: an owner's read
 * folds `booked` into `available`, so the statuses an action applies to treat
 * the two alike, and the route does the same, so an item left out never says
 * it was reserved.
 */

export const BULK_ITEM_ACTIONS = [
  'publish',
  'draft',
  'received',
  'mostWanted',
  'notMostWanted',
  'delete',
] as const;

export type BulkItemAction = (typeof BULK_ITEM_ACTIONS)[number];

/** The most items one request takes (Select all on a longer list sends the first ones). */
export const BULK_ITEMS_MAX = 100;

/**
 * Which stored statuses each action applies to. An item in any other is left
 * as it is (`skipped`): Publish is for drafts, Move to draft and Mark as
 * received for live items, as a card's own menu offers them, and nothing ever
 * touches a proposal (that's a review, never a bulk change). `booked` sits
 * with `available` wherever it appears, since an owner can't tell them apart.
 */
export const BULK_ACTION_STATUSES: Record<BulkItemAction, readonly string[]> = {
  publish: ['draft'],
  draft: ['available', 'booked'],
  received: ['available', 'booked'],
  mostWanted: ['draft', 'available', 'booked', 'completed'],
  notMostWanted: ['draft', 'available', 'booked', 'completed'],
  delete: ['draft', 'available', 'booked', 'completed'],
};

/** Whether an owner may pick an item in Select mode: anything but a proposal. */
export function isSelectableItem(item: { status: string }): boolean {
  return item.status !== 'proposed';
}

/** Whether `action` would change `item` (as the route decides, see `BULK_ACTION_STATUSES`). */
export function bulkActionApplies(
  action: BulkItemAction,
  item: { status: string; mostWanted?: boolean }
): boolean {
  if (!BULK_ACTION_STATUSES[action].includes(item.status)) return false;
  if (action === 'mostWanted') return item.mostWanted !== true;
  if (action === 'notMostWanted') return item.mostWanted === true;
  return true;
}

/** The picked items `action` would change, in the order given. */
export function bulkTargets<T extends { _id: string; status: string; mostWanted?: boolean }>(
  action: BulkItemAction,
  items: readonly T[]
): T[] {
  return items.filter((item) => bulkActionApplies(action, item));
}

/** The status each status change sets. */
const STATUS_SET: Partial<Record<BulkItemAction, 'available' | 'draft' | 'completed'>> = {
  publish: 'available',
  draft: 'draft',
  received: 'completed',
};

/** The single-item change each action stands for (a `PATCH /api/items/[id]` body). */
export function bulkItemUpdate(
  action: Exclude<BulkItemAction, 'delete'>
): { status: 'available' | 'draft' | 'completed' } | { mostWanted: boolean } {
  const status = STATUS_SET[action];
  if (status) return { status };
  return { mostWanted: action === 'mostWanted' };
}

/**
 * The item as an owner sees it once `action` has landed, before the server
 * has answered. Owners never see a booking, so there is none to clear.
 */
export function applyBulkAction<T extends { status: string; mostWanted?: boolean }>(
  action: Exclude<BulkItemAction, 'delete'>,
  item: T
): T {
  return { ...item, ...bulkItemUpdate(action) };
}

/** The toast once `count` items have had `action` (Undo's line, for a delete). */
export function bulkDoneMessage(action: BulkItemAction, count: number): string {
  const items = plural(count, 'item');
  switch (action) {
    case 'publish':
      return `${items} published`;
    case 'draft':
      return `${items} moved to draft`;
    case 'received':
      return `${items} marked as received`;
    case 'mostWanted':
      return `${items} marked as most wanted`;
    case 'notMostWanted':
      return `${items} no longer most wanted`;
    case 'delete':
      return `${items} deleted`;
  }
}

/**
 * The toast when some of a batch didn't land: a count and nothing more, the
 * same whatever kept them (never a reason, which could hint at a reservation).
 */
export function bulkFailedMessage(count: number): string {
  return `${plural(count, 'item')} couldn’t be changed. Try again.`;
}

/** What `POST /api/wishlists/[id]/items/bulk` answers with. */
export interface BulkItemResult<Item> {
  /** Ids the action landed on. */
  done: string[];
  /** Ids it left as they were: not in a status it applies to (see above). */
  skipped: string[];
  /** Ids that aren't on the list (deleted since, or never its own). */
  gone: string[];
  /** Ids whose change failed on the server. */
  failed: string[];
  /**
   * Every changed or skipped item that's still on the list, as it is now,
   * shaped for an owner (`serializeItem`): a delete's skipped ones only.
   */
  items: Item[];
}
