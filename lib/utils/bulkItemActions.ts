import { createHash } from 'crypto';
import Item, { type IItem } from '@/models/Item';
import ItemBatch, { type IItemBatch } from '@/models/ItemBatch';
import { ensureCurrencyRatesUpToDate } from '@/lib/utils/currencyRates';
import { serializeItem, type SerializedItem } from '@/lib/utils/itemSerializer';
import { readItemRefs } from '@/lib/utils/itemLinkWrites';
import { deleteItem, updateItem, type ItemActionWishlist } from '@/lib/utils/itemActions';
import { purgeShareCards } from '@/lib/og/purge';
import { errorKind } from '@/lib/utils/errorKind';
import {
  BULK_ACTION_STATUSES,
  bulkItemUpdate,
  type BulkItemAction,
  type BulkItemResult,
} from '@/lib/utils/bulkItems';

/**
 * An owner's bulk item action (WIS-386), behind
 * `POST /api/wishlists/[id]/items/bulk`. The route authenticates the caller,
 * checks they own the list (`getOwnerAccess`), rate-limits, parses, and
 * claims the request's `Idempotency-Key` (`claimItemBatch`); this applies the
 * action to each item through the very helpers a single item's `PATCH` /
 * `DELETE` uses (`updateItem`, `deleteItem`), so each is held to the same
 * rules and has the same side effects: a delete ends its group gifts, unlinks
 * its partners and frees its image, and leaves every gifter's `Reservation`
 * (and gift history) in place; a draft or received unassigns a booking and
 * ends a group gift; a publish never touches a booked item.
 *
 * Owners are booking-blind, and so is every answer here: which items an
 * action applies to is decided by status with `booked` counted as
 * `available`, every item answered is shaped for an owner, and a failure is
 * just an id, never a reason.
 */

export type BulkItemAnswer = BulkItemResult<SerializedItem>;

/** How long an unfinished batch may run before a retry takes it as dead. */
export const ITEM_BATCH_STALE_MS = 60_000;

/** How long a batch's key keeps answering retries. */
const ITEM_BATCH_TTL_MS = 24 * 60 * 60 * 1000;

/** The answer while the first attempt with this key is still being applied. */
export const ITEM_BATCH_IN_PROGRESS_ERROR = 'These changes are still being saved. Try again.';

/** The answer to a key sent again with a different change. */
export const ITEM_BATCH_KEY_REUSED_ERROR =
  'This Idempotency-Key was already used for another change';

const owner = { role: 'owner' } as const;

async function serializeForOwner(item: IItem, rates: Map<string, number>): Promise<SerializedItem> {
  return serializeItem(item, owner, rates, await readItemRefs(item, true));
}

async function readRates(): Promise<Map<string, number>> {
  const currencyRate = await ensureCurrencyRatesUpToDate();
  return currencyRate?.rates || new Map<string, number>();
}

/**
 * Apply `action` to each of `itemIds` on `wishlist`, in order, each as its own
 * single-item change. Never throws for one item: an item whose change fails is
 * answered `failed` (and logged with no ids), and the rest go on.
 */
export async function applyBulkItemAction({
  wishlist,
  userId,
  action,
  itemIds,
}: {
  wishlist: ItemActionWishlist;
  /** The caller, already known to own `wishlist`. */
  userId: string;
  action: BulkItemAction;
  itemIds: readonly string[];
}): Promise<BulkItemAnswer> {
  const result: BulkItemAnswer = { done: [], skipped: [], gone: [], failed: [], items: [] };
  // Only the list's own items: an id from another list is answered as gone,
  // exactly as a deleted one, so the answer says nothing about other lists.
  const found = await Item.find({ _id: { $in: itemIds }, wishlist: wishlist._id });
  const byId = new Map(found.map((item) => [item._id.toString(), item]));
  const rates = await readRates();
  const applies = BULK_ACTION_STATUSES[action];

  for (const id of itemIds) {
    const item = byId.get(id);
    if (!item) {
      result.gone.push(id);
      continue;
    }
    // A proposal (a review, never a bulk change), or a status the action isn't
    // for, is left as it is and answered as it is now.
    if (!applies.includes(item.status)) {
      result.skipped.push(id);
      result.items.push(await serializeForOwner(item, rates));
      continue;
    }
    try {
      if (action === 'delete') {
        const deleted = await deleteItem({
          item,
          wishlist,
          isOwner: true,
          userId,
          expectsProposal: false,
          purgeShareCard: false,
        });
        if (deleted.ok) result.done.push(id);
        else if (deleted.status === 404) result.gone.push(id);
        else result.failed.push(id);
      } else {
        const updated = await updateItem({
          item,
          wishlist,
          actor: { userId, isOwner: true, isMember: false, isProposer: false },
          data: bulkItemUpdate(action),
          purgeShareCard: false,
        });
        if (updated.ok) {
          result.done.push(id);
          result.items.push(updated.data);
        } else if (updated.status === 404) {
          result.gone.push(id);
        } else {
          result.failed.push(id);
        }
      }
    } catch (err) {
      console.error('A bulk item change failed:', errorKind(err));
      result.failed.push(id);
    }
  }

  // The share card's count changes with a status change or a delete; purged
  // once for the batch rather than once per item.
  if (result.done.length && action !== 'mostWanted' && action !== 'notMostWanted') {
    await purgeShareCards({ wishlistIds: [wishlist._id.toString()] });
  }
  return result;
}

/** What a batch's key is bound to: its list, its action and its ids. */
export function itemBatchPayload(
  wishlistId: string,
  action: BulkItemAction,
  itemIds: readonly string[]
): string {
  const ids = [...itemIds].sort().join(',');
  return createHash('sha256').update(`${wishlistId}:${action}:${ids}`).digest('hex');
}

function isBatchKeyClash(err: unknown): boolean {
  const { code, keyPattern } = (err ?? {}) as {
    code?: unknown;
    keyPattern?: Record<string, unknown>;
  };
  return code === 11000 && !!keyPattern && 'key' in keyPattern;
}

export type ItemBatchClaim =
  | { kind: 'claimed'; batchId: IItemBatch['_id'] }
  | { kind: 'replay'; answer: BulkItemAnswer }
  | { kind: 'refused'; status: 409 | 422; error: string };

/**
 * The answer a finished batch gave, again: the ids as it sorted them, and the
 * items it answered with as they are now (any deleted since counted as gone).
 */
async function replayBatch(
  row: Pick<IItemBatch, 'wishlist' | 'result'>,
  action: BulkItemAction
): Promise<BulkItemAnswer> {
  const stored = row.result ?? {};
  const done = stored.done ?? [];
  const skipped = stored.skipped ?? [];
  const gone = [...(stored.gone ?? [])];
  const failed = stored.failed ?? [];
  const shown = action === 'delete' ? skipped : [...done, ...skipped];
  const found = shown.length
    ? await Item.find({ _id: { $in: shown }, wishlist: row.wishlist })
    : [];
  const byId = new Map(found.map((item) => [item._id.toString(), item]));
  const rates = found.length ? await readRates() : new Map<string, number>();
  const items: SerializedItem[] = [];
  const stillDone: string[] = [];
  const stillSkipped: string[] = [];
  for (const id of done) {
    if (action === 'delete' || byId.has(id)) stillDone.push(id);
    else gone.push(id);
  }
  for (const id of skipped) {
    if (byId.has(id)) stillSkipped.push(id);
    else gone.push(id);
  }
  for (const id of shown) {
    const item = byId.get(id);
    if (item) items.push(await serializeForOwner(item, rates));
  }
  return { done: stillDone, skipped: stillSkipped, gone, failed, items };
}

/**
 * Claim a bulk request's key before anything is applied: `claimed` when this
 * attempt goes ahead (finish it with `finishItemBatch`), `replay` with the
 * answer an earlier attempt with the same key gave, or `refused` while that
 * attempt is still running (409) or when the key was used for another change
 * (422). An attempt unfinished past `ITEM_BATCH_STALE_MS` must have died, and
 * is dropped: every bulk action is safe to apply twice.
 */
export async function claimItemBatch({
  userId,
  scopedKey,
  wishlistId,
  action,
  itemIds,
}: {
  userId: string;
  scopedKey: string;
  wishlistId: string;
  action: BulkItemAction;
  itemIds: readonly string[];
}): Promise<ItemBatchClaim> {
  const payload = itemBatchPayload(wishlistId, action, itemIds);
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await ItemBatch.findOne({ key: scopedKey, user: userId }).lean();
    if (row) {
      if (row.payload !== payload) {
        return { kind: 'refused', status: 422, error: ITEM_BATCH_KEY_REUSED_ERROR };
      }
      if (row.done) return { kind: 'replay', answer: await replayBatch(row, action) };
      if (Date.now() - row.createdAt.getTime() < ITEM_BATCH_STALE_MS) {
        return { kind: 'refused', status: 409, error: ITEM_BATCH_IN_PROGRESS_ERROR };
      }
      // Dead: dropped only if still the same unfinished row, so two retries
      // can't both take it over.
      await ItemBatch.deleteOne({ _id: row._id, done: false });
    }
    try {
      const created = await ItemBatch.create({
        user: userId,
        key: scopedKey,
        wishlist: wishlistId,
        payload,
        expiresAt: new Date(Date.now() + ITEM_BATCH_TTL_MS),
      });
      return { kind: 'claimed', batchId: created._id };
    } catch (err) {
      // Another attempt with this key got there first: answer as it says.
      if (!isBatchKeyClash(err)) throw err;
    }
  }
  return { kind: 'refused', status: 409, error: ITEM_BATCH_IN_PROGRESS_ERROR };
}

/** Record a claimed batch's answer, for its retries. */
export async function finishItemBatch(
  batchId: IItemBatch['_id'],
  answer: BulkItemAnswer
): Promise<void> {
  const { done, skipped, gone, failed } = answer;
  await ItemBatch.updateOne(
    { _id: batchId },
    { $set: { done: true, result: { done, skipped, gone, failed } } }
  );
}

/**
 * Let go of a claimed batch whose attempt failed as a whole, so a retry with
 * its key applies it rather than waiting out `ITEM_BATCH_STALE_MS`.
 */
export async function releaseItemBatch(batchId: IItemBatch['_id']): Promise<void> {
  await ItemBatch.deleteOne({ _id: batchId, done: false });
}
