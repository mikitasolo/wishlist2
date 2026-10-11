import type mongoose from 'mongoose';
import Item from '@/models/Item';
import { countListTags, fitTagsToList, LIST_TAGS_MAX } from '@/lib/utils/itemTags';

/**
 * The reads and writes behind an owner's tags on an item (WIS-385). Callers
 * have already decided the caller is an owner of the list: tags are never a
 * member's, a proposer's or a copy's to set.
 *
 * The list's cap (`LIST_TAGS_MAX` different tags) is checked before the write
 * (`fitItemTags`) and, when the write brought in a tag new to the list, again
 * once it has landed (`listTagsOverCap`): two co-owners each adding the list's
 * last free tag at once both pass the first check, and the second catches
 * them. A write found over the cap is taken back (`revertItemTags`).
 */

type Id = mongoose.Types.ObjectId | string;

/**
 * `tags` fitted to the list `wishlistId` (`fitTagsToList`), against the tags
 * its other items carry (all of them but `itemId`, the one being written).
 */
export async function fitItemTags(wishlistId: Id, itemId: Id | null, tags: readonly string[]) {
  const existing: string[] = await Item.distinct('tags', {
    wishlist: wishlistId,
    ...(itemId && { _id: { $ne: itemId } }),
  });
  return fitTagsToList(existing, tags);
}

/** Whether the list's items carry more than `LIST_TAGS_MAX` different tags between them. */
export async function listTagsOverCap(wishlistId: Id): Promise<boolean> {
  const all: string[] = await Item.distinct('tags', { wishlist: wishlistId });
  return countListTags(all) > LIST_TAGS_MAX;
}

/**
 * Take back a tag write found over the cap: the item gets `previous` again,
 * but only while it still carries exactly what was `written`, so a co-owner's
 * tag change landing since is never undone.
 */
export async function revertItemTags(
  itemId: Id,
  written: readonly string[],
  previous: readonly string[] | null | undefined
): Promise<void> {
  await Item.updateOne(
    { _id: itemId, tags: [...written] },
    { $set: { tags: [...(previous ?? [])] } }
  );
}
