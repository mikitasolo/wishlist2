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
  type BulkItemUpdateAction,
} from '@/lib/utils/bulkItems';
import { applyBulkMove, settleDeadMove } from '@/lib/utils/bulkItemMove';

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

/**
 * How long an unfinished batch may run before a retry takes it as dead: past
 * the route's `maxDuration` (60 s).
 */
export const ITEM_BATCH_STALE_MS = 90_000;

/** How many items a batch changes at once. */
const BULK_CONCURRENCY = 4;

/** How long a batch's key keeps answering retries. */
const ITEM_BATCH_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long a move's row is kept (WIS-443): long enough that the daily sweep
 * (`settleAllDeadMoves`, from the gift reminders cron) reaches a dead one even
 * after a few missed runs (Hobby crons are never retried), since once the row
 * expires nothing can settle what its attempt left.
 */
export const ITEM_BATCH_MOVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How many dead moves one run of the sweep settles at most. */
export const DEAD_MOVE_SWEEP_MAX_ROWS = 50;

/**
 * How long one run of the sweep works for: it starts no copy's take-back
 * after it, so the gift reminders after it keep most of the cron's 60 s.
 */
export const DEAD_MOVE_SWEEP_BUDGET_MS = 10_000;

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
  action: BulkItemUpdateAction | 'delete';
  itemIds: readonly string[];
}): Promise<BulkItemAnswer> {
  const result: BulkItemAnswer = { done: [], skipped: [], gone: [], failed: [], items: [] };
  // Only the list's own items: an id from another list is answered as gone,
  // exactly as a deleted one, so the answer says nothing about other lists.
  const found = await Item.find({ _id: { $in: itemIds }, wishlist: wishlist._id });
  const byId = new Map(found.map((item) => [item._id.toString(), item]));
  const rates = await readRates();
  const applies = BULK_ACTION_STATUSES[action];

  type Outcome = { kind: 'done' | 'skipped' | 'gone' | 'failed'; item?: SerializedItem };
  const changeOne = async (id: string): Promise<Outcome> => {
    const item = byId.get(id);
    if (!item) return { kind: 'gone' };
    // A proposal (a review, never a bulk change), or a status the action isn't
    // for, is left as it is and answered as it is now.
    if (!applies.includes(item.status)) {
      return { kind: 'skipped', item: await serializeForOwner(item, rates) };
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
        if (deleted.ok) return { kind: 'done' };
        return { kind: deleted.status === 404 ? 'gone' : 'failed' };
      }
      const updated = await updateItem({
        item,
        wishlist,
        actor: { userId, isOwner: true, isMember: false, isProposer: false },
        data: bulkItemUpdate(action),
        purgeShareCard: false,
        rates,
      });
      if (updated.ok) return { kind: 'done', item: updated.data };
      return { kind: updated.status === 404 ? 'gone' : 'failed' };
    } catch (err) {
      console.error('A bulk item change failed:', errorKind(err));
      return { kind: 'failed' };
    }
  };

  // A few at a time (each item is its own change, independent of the others),
  // answered in the order the ids were sent.
  const outcomes: Outcome[] = new Array(itemIds.length);
  let next = 0;
  const runNext = async () => {
    while (next < itemIds.length) {
      const at = next++;
      outcomes[at] = await changeOne(itemIds[at]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, itemIds.length) }, runNext));
  itemIds.forEach((id, at) => {
    const { kind, item } = outcomes[at];
    result[kind].push(id);
    if (item) result.items.push(item);
  });

  // The share card's count changes with a status change or a delete; purged
  // once for the batch rather than once per item.
  if (result.done.length && action !== 'mostWanted' && action !== 'notMostWanted') {
    await purgeShareCards({ wishlistIds: [wishlist._id.toString()] });
  }
  return result;
}

/**
 * Move `itemIds` from `wishlist` to the list `targetId` (WIS-434, see
 * `lib/utils/bulkItemMove.ts`), answered as a delete is: the ids it moved as
 * done, and only the items it left as they were. A refusal from the re-check
 * after the copies were written is handed back for the route to answer.
 */
export async function applyBulkMoveAction({
  wishlist,
  userId,
  itemIds,
  targetId,
  batchId,
}: {
  wishlist: ItemActionWishlist;
  /** The caller, already known to own `wishlist` and `targetId`. */
  userId: string;
  itemIds: readonly string[];
  targetId: string;
  batchId: IItemBatch['_id'];
}): Promise<BulkItemAnswer | { refused: 'source gone' | 'not owner' | 'target' }> {
  // Any earlier move of theirs that died is settled first, so it doesn't
  // leave items on two lists.
  try {
    await settleDeadMoves(userId);
  } catch (err) {
    console.error(`Settling dead item moves failed (${errorKind(err)})`);
  }
  try {
    const outcome = await applyBulkMove({ source: wishlist, targetId, userId, itemIds, batchId });
    if ('refused' in outcome) return outcome;
    const result: BulkItemAnswer = { done: [], skipped: [], gone: [], failed: [], items: [] };
    const rates = outcome.skipped.size ? await readRates() : new Map<string, number>();
    for (const id of itemIds) {
      const kind = outcome.kinds.get(id) ?? 'failed';
      result[kind].push(id);
      const item = outcome.skipped.get(id);
      if (item) result.items.push(await serializeForOwner(item, rates));
    }
    if (result.done.length) {
      await purgeShareCards({ wishlistIds: [wishlist._id.toString(), targetId] });
    }
    return result;
  } catch (err) {
    // The route lets go of the batch on a throw, and its record with it, so
    // whatever the attempt wrote is settled first: no item left on both lists.
    try {
      const row = await ItemBatch.findById(batchId).select('moves copiedUrls').lean();
      if (row) await settleDeadMove(row, userId);
    } catch (settleErr) {
      console.error(`Settling a failed item move failed (${errorKind(settleErr)})`);
    }
    throw err;
  }
}

/**
 * Settle the caller's moves whose attempts died unfinished (past
 * `ITEM_BATCH_STALE_MS`) and that nobody retried: their copies taken back
 * where the item is still on its list, their images freed (`settleDeadMove`).
 */
export async function settleDeadMoves(userId: string): Promise<void> {
  const dead = await ItemBatch.find({
    user: userId,
    done: false,
    createdAt: { $lt: new Date(Date.now() - ITEM_BATCH_STALE_MS) },
  })
    .select('moves copiedUrls')
    .lean();
  for (const row of dead) {
    if (!row.moves?.length && !row.copiedUrls?.length) continue;
    await settleDeadMoveRow(row, userId);
  }
}

/**
 * Settle one dead move's row and drop it, only if it's still the same
 * unfinished row: a retry of its key that took it over meanwhile wrote a new
 * one, which this leaves alone. Settling is safe to run twice, so a retry or
 * the caller's next move settling the same row at once does no harm.
 */
async function settleDeadMoveRow(
  row: Pick<IItemBatch, '_id' | 'moves' | 'copiedUrls'>,
  userId: string,
  deadline?: number
): Promise<boolean> {
  if (!(await settleDeadMove(row, userId, deadline))) return false;
  await ItemBatch.deleteOne({ _id: row._id, done: false });
  return true;
}

export type DeadMoveSweep = {
  /** Rows settled and dropped. */
  settled: number;
  /** Rows whose settling failed: left for the next run. */
  failed: number;
  /** Whether the cap or the time budget stopped the run with rows left. */
  capped: boolean;
};

/**
 * Settle everyone's moves whose attempts died unfinished (WIS-443), from the
 * daily gift reminders cron, so a dead move nobody retried (and whose owner
 * never moves again) doesn't leave items on two lists until its row expires.
 * Only rows a move wrote to (`moves` / `copiedUrls`), unfinished, and older
 * than `ITEM_BATCH_STALE_MS` (past the route's `maxDuration`, so their attempt
 * is over), oldest first, at most `maxRows` a run, no copy taken back after
 * `budgetMs` (a row cut short is kept, and finished by a later run: settling
 * is safe to repeat). One that fails is logged (its kind only) and left for
 * the next run. Settled as the caller's own next move would
 * (`settleDeadMove`, as the row's user). Answers counts only.
 */
export async function settleAllDeadMoves({
  maxRows = DEAD_MOVE_SWEEP_MAX_ROWS,
  budgetMs = DEAD_MOVE_SWEEP_BUDGET_MS,
}: { maxRows?: number; budgetMs?: number } = {}): Promise<DeadMoveSweep> {
  const deadline = Date.now() + budgetMs;
  const dead = await ItemBatch.find({
    done: false,
    createdAt: { $lt: new Date(Date.now() - ITEM_BATCH_STALE_MS) },
    $or: [{ 'moves.0': { $exists: true } }, { 'copiedUrls.0': { $exists: true } }],
  })
    .sort({ createdAt: 1 })
    .limit(maxRows + 1)
    .select('user moves copiedUrls')
    .lean();
  const result: DeadMoveSweep = { settled: 0, failed: 0, capped: dead.length > maxRows };
  for (const row of dead.slice(0, maxRows)) {
    if (Date.now() >= deadline) {
      result.capped = true;
      break;
    }
    try {
      if (!(await settleDeadMoveRow(row, row.user.toString(), deadline))) {
        result.capped = true;
        break;
      }
      result.settled++;
    } catch (err) {
      result.failed++;
      console.error('Settling a dead item move failed:', errorKind(err));
    }
  }
  return result;
}

/**
 * What a batch's key is bound to: its list, its action and its ids (and a
 * move's target).
 */
export function itemBatchPayload(
  wishlistId: string,
  action: BulkItemAction,
  itemIds: readonly string[],
  targetId?: string
): string {
  const ids = [...itemIds].sort().join(',');
  const target = targetId ? `:${targetId}` : '';
  return createHash('sha256').update(`${wishlistId}:${action}:${ids}${target}`).digest('hex');
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
  const removes = action === 'delete' || action === 'move';
  const shown = removes ? skipped : [...done, ...skipped];
  const found = shown.length
    ? await Item.find({ _id: { $in: shown }, wishlist: row.wishlist })
    : [];
  const byId = new Map(found.map((item) => [item._id.toString(), item]));
  const rates = found.length ? await readRates() : new Map<string, number>();
  const items: SerializedItem[] = [];
  const stillDone: string[] = [];
  const stillSkipped: string[] = [];
  for (const id of done) {
    if (removes || byId.has(id)) stillDone.push(id);
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
 * is dropped: every bulk action is safe to apply twice, a move once what the
 * dead attempt left is settled.
 */
export async function claimItemBatch({
  userId,
  scopedKey,
  wishlistId,
  action,
  itemIds,
  targetId,
}: {
  userId: string;
  scopedKey: string;
  wishlistId: string;
  action: BulkItemAction;
  itemIds: readonly string[];
  /** A move's target list. */
  targetId?: string;
}): Promise<ItemBatchClaim> {
  const payload = itemBatchPayload(wishlistId, action, itemIds, targetId);
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
      // Dead: a move's copies settled (each taken back where its item is still
      // on its list), then dropped only if still the same unfinished row, so
      // two retries can't both take it over.
      if (row.moves?.length || row.copiedUrls?.length) await settleDeadMove(row, userId);
      await ItemBatch.deleteOne({ _id: row._id, done: false });
    }
    try {
      const created = await ItemBatch.create({
        user: userId,
        key: scopedKey,
        wishlist: wishlistId,
        payload,
        expiresAt: new Date(
          Date.now() + (action === 'move' ? ITEM_BATCH_MOVE_TTL_MS : ITEM_BATCH_TTL_MS)
        ),
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
