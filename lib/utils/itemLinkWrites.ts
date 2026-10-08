import mongoose from 'mongoose';
import Item, { type IItem } from '@/models/Item';
import { errorKind } from '@/lib/utils/errorKind';
import {
  ITEM_LINKS_MAX,
  isLinkableStatus,
  linkedItemRefs,
  visiblePartnerStatuses,
  type ItemRef,
  type LinkChanges,
} from '@/lib/utils/itemLinks';

/**
 * Linked items' reads and writes (WIS-29; the rules are in `itemLinks.ts`).
 * Only an owner's item create (`POST /api/wishlists/[id]/items`) and edit
 * (`PATCH /api/items/[id]`) write links, through `checkItemLinks` then
 * `writeItemLinks`; a delete unlinks through `unlinkDeletedItem`.
 */

export const LINK_SELF_ERROR = "An item can't go with itself";
/** A partner that isn't a linkable item on the same list: missing, elsewhere, or a proposal. */
export const LINK_TARGET_ERROR = 'Pick items from this list';
export const LINK_PROPOSAL_ERROR = "A proposal can't go with other items";
export const LINK_CAP_ERROR = `An item can go with up to ${ITEM_LINKS_MAX} others`;
export const partnerCapError = (name: string) =>
  `“${name}” already goes with ${ITEM_LINKS_MAX} items`;

type LinkRefusal = { ok: false; status: 400 | 404 | 409; error: string };
export type LinkResult = { ok: true } | LinkRefusal;
/** A pre-check's answer: on success, the changes to write (`checkItemLinks`). */
export type LinkCheck = { ok: true; changes: LinkChanges } | LinkRefusal;

const OK: LinkResult = { ok: true };
const toIds = (ids: readonly string[] | undefined) =>
  [...new Set(ids ?? [])].map((id) => new mongoose.Types.ObjectId(id));

/** The partners as stored, ids as strings. */
const storedLinks = (item: Pick<IItem, 'relatedItems'> | null) =>
  (item?.relatedItems ?? []).map((id) => id.toString());

/** A filter for an item that can take `adding` more links without passing the cap. */
function roomFor(adding: mongoose.Types.ObjectId[]) {
  return {
    $expr: {
      $lte: [
        { $size: { $setUnion: [{ $ifNull: ['$relatedItems', []] }, adding] } },
        ITEM_LINKS_MAX,
      ],
    },
  };
}

/**
 * Whether `changes` can be made to `item` (null for an item about to be
 * created) on `wishlistId`, checked before anything is written so a refused
 * request writes nothing: no linking to itself, every partner an item on the
 * same list that isn't a proposal, and neither the item nor any partner pushed
 * past `ITEM_LINKS_MAX`. Only a pre-check: `writeItemLinks` enforces the same
 * with conditional writes, as other requests may link meanwhile.
 *
 * On success it hands back the changes to write: the ones asked for, plus the
 * item's one-sided links (a partner gone, or a half-written or half-removed
 * link) as removals. Nobody sees those (a link shows only where both sides
 * record it), so the owner could never untick them, and they'd hold places
 * under the cap.
 */
export async function checkItemLinks(
  wishlistId: string,
  item: Pick<IItem, '_id' | 'status' | 'relatedItems'> | null,
  changes: LinkChanges
): Promise<LinkCheck> {
  const link = [...new Set(changes.linkItems ?? [])];
  if (!link.length && !changes.unlinkItems?.length) return { ok: true, changes: {} };
  if (item && !isLinkableStatus(item.status)) {
    return { ok: false, status: 400, error: LINK_PROPOSAL_ERROR };
  }
  const itemId = item?._id.toString();
  if (itemId && link.includes(itemId)) return { ok: false, status: 400, error: LINK_SELF_ERROR };

  const unlink = new Set(changes.unlinkItems ?? []);
  const stored = storedLinks(item);
  if (item && stored.length) {
    const mutual = await Item.find({
      _id: { $in: toIds(stored) },
      wishlist: wishlistId,
      relatedItems: item._id,
    })
      .select('_id')
      .lean();
    const both = new Set(mutual.map((m) => m._id.toString()));
    for (const id of stored) if (!both.has(id) && !link.includes(id)) unlink.add(id);
  }
  const pruned: LinkChanges = {
    ...(link.length ? { linkItems: link } : {}),
    ...(unlink.size ? { unlinkItems: [...unlink] } : {}),
  };
  if (!link.length) return { ok: true, changes: pruned };

  const kept = stored.filter((id) => !unlink.has(id));
  if (new Set([...kept, ...link]).size > ITEM_LINKS_MAX) {
    return { ok: false, status: 400, error: LINK_CAP_ERROR };
  }

  const partners = await Item.find({
    _id: { $in: toIds(link) },
    wishlist: wishlistId,
    status: { $ne: 'proposed' },
  })
    .select('name relatedItems')
    .lean();
  if (partners.length !== link.length) return { ok: false, status: 400, error: LINK_TARGET_ERROR };
  for (const partner of partners) {
    const theirs = storedLinks(partner);
    if (itemId && theirs.includes(itemId)) continue;
    if (theirs.length >= ITEM_LINKS_MAX) {
      return { ok: false, status: 400, error: partnerCapError(partner.name) };
    }
  }
  return { ok: true, changes: pruned };
}

/**
 * Make `changes` to the links of item `itemId` on `wishlistId`, on both sides,
 * each side by a conditional write on its own item, so no item ever holds more
 * than `ITEM_LINKS_MAX` however many requests race:
 *
 * 1. The item itself, in one write: its removals out and its new partners in,
 *    only while that leaves it within the cap and it isn't a proposal. Refused,
 *    nothing at all is written.
 * 2. The removed partners let go of it.
 * 3. Each new partner takes it, only while it has room, is on the same list and
 *    isn't a proposal. One that refuses is pulled back off the item, and the
 *    request is answered 409 (`partnerCapError`, or `LINK_TARGET_ERROR` for one
 *    gone or no longer linkable); the rest of the change stands.
 *
 * Re-checked after the writes: an item deleted meanwhile, whose delete may have
 * unlinked it before a partner took it, is pulled from them.
 *
 * A half-done link (a request dying between its writes, or a link and an
 * unlink of the same pair crossing) is never shown: a link counts only where
 * both sides record it (`linkedItemRefs`), and the item's next link edit clears
 * it (`checkItemLinks`). Never touches status or bookings.
 */
export async function writeItemLinks(
  itemId: string,
  wishlistId: string,
  changes: LinkChanges
): Promise<LinkResult> {
  const self = new mongoose.Types.ObjectId(itemId);
  const list = new mongoose.Types.ObjectId(wishlistId);
  const remove = toIds(changes.unlinkItems);
  const add = toIds(changes.linkItems).filter((id) => !id.equals(self));
  if (!remove.length && !add.length) return OK;

  // Its links with the removals taken out and the new partners appended, in
  // the order they were added.
  const stored = { $ifNull: ['$relatedItems', []] };
  const without = (input: unknown, ids: unknown) => ({
    $filter: { input, cond: { $not: [{ $in: ['$$this', ids] }] } },
  });
  const next = { $concatArrays: [without(stored, remove), without(add, stored)] };
  const own = await Item.updateOne(
    {
      _id: self,
      wishlist: list,
      status: { $ne: 'proposed' },
      $expr: { $lte: [{ $size: next }, ITEM_LINKS_MAX] },
    },
    [{ $set: { relatedItems: next } }]
  );
  if (own.matchedCount === 0) {
    const now = await Item.findById(self).select('status').lean();
    if (!now) return { ok: false, status: 404, error: 'Item not found' };
    return {
      ok: false,
      status: 409,
      error: isLinkableStatus(now.status) ? LINK_CAP_ERROR : LINK_PROPOSAL_ERROR,
    };
  }

  if (remove.length) {
    await Item.updateMany(
      { _id: { $in: remove }, wishlist: list },
      { $pull: { relatedItems: self } }
    );
  }

  const taken = await Promise.all(
    add.map((partner) =>
      Item.updateOne(
        { _id: partner, wishlist: list, status: { $ne: 'proposed' }, ...roomFor([self]) },
        { $addToSet: { relatedItems: self } }
      )
    )
  );
  const refused = add.filter((_, i) => taken[i].matchedCount === 0);
  if (refused.length) {
    await Item.updateOne({ _id: self }, { $pull: { relatedItems: { $in: refused } } });
  }

  // Deleted while this ran: its delete's unlink may have come before a
  // partner took it, so it's taken off them here.
  if (!(await Item.exists({ _id: self }))) {
    await Item.updateMany(
      { wishlist: list, relatedItems: self },
      { $pull: { relatedItems: self } }
    );
    return { ok: false, status: 404, error: 'Item not found' };
  }

  if (!refused.length) return OK;
  const full = await Item.findOne({
    _id: { $in: refused },
    wishlist: list,
    status: { $ne: 'proposed' },
  })
    .select('name')
    .lean();
  return { ok: false, status: 409, error: full ? partnerCapError(full.name) : LINK_TARGET_ERROR };
}

/**
 * Take a deleted item off every partner it had on its list. Best-effort: the
 * item is gone either way, and a dangling id is ignored when read
 * (`linkedItemRefs` shows only partners that exist), so a failure is logged
 * rather than failing the delete.
 */
export async function unlinkDeletedItem(
  itemId: mongoose.Types.ObjectId,
  wishlistId: mongoose.Types.ObjectId | string
): Promise<void> {
  try {
    await Item.updateMany(
      { wishlist: wishlistId, relatedItems: itemId },
      { $pull: { relatedItems: itemId } }
    );
  } catch (err) {
    console.error('Failed to unlink a deleted item:', errorKind(err));
  }
}

/**
 * One item's partners as an owner (`isOwner`) or anyone else may see them, for
 * an item write's answer: one query for the partners it records that are on
 * its list, in a status the viewer sees, and record it back. The list read
 * works them out from the items it has (`linkedItemRefs`) instead.
 */
export async function readItemRefs(
  item: Pick<IItem, '_id' | 'wishlist' | 'name' | 'status' | 'relatedItems'>,
  isOwner: boolean
): Promise<ItemRef[]> {
  const stored = item.relatedItems ?? [];
  if (!stored.length || !isLinkableStatus(item.status)) return [];
  const partners = await Item.find({
    _id: { $in: stored },
    wishlist: item.wishlist,
    status: { $in: visiblePartnerStatuses(isOwner) },
    relatedItems: item._id,
  })
    .select('name status relatedItems')
    .lean();
  return linkedItemRefs([item, ...partners]).get(item._id.toString()) ?? [];
}
