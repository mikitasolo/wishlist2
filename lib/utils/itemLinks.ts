/**
 * Linked items (WIS-29): an owner says which items on a list go together (a
 * drill and its bits), and everyone who can see an item sees "Goes with"
 * chips for its partners. The pure rules, shared by the server and the page;
 * the writes are in `itemLinkWrites.ts`.
 *
 * - A link is **soft and symmetric**: stored on both items (`Item.relatedItems`),
 *   and a link counts only while both sides record it (`linkedItemRefs`), so a
 *   half-written or half-removed one never shows, and a dangling id (an item
 *   deleted since) is ignored.
 * - **Same list only**, never a proposal; drafts may be linked (an owner may
 *   draft a set before publishing it), but a non-owner never sees a draft, so
 *   never a chip for one.
 * - **At most `ITEM_LINKS_MAX` per item**, each side, enforced by the write.
 * - **Booking stays independent**: nothing here reads or writes a booking, and
 *   a chip is only `{ id, name }`, never a partner's status.
 */

/** The most items one item can go with. */
export const ITEM_LINKS_MAX = 10;

/** A partner as an item answer carries it: never its status or anything else. */
export interface ItemRef {
  id: string;
  name: string;
}

/** Whether an item in `status` can be linked: anything but a proposal. */
export function isLinkableStatus(status: string): boolean {
  return status !== 'proposed';
}

/** The statuses a partner can have and still be shown to an owner, or to anyone else. */
export function visiblePartnerStatuses(isOwner: boolean): string[] {
  return isOwner
    ? ['draft', 'available', 'booked', 'completed']
    : ['available', 'booked', 'completed'];
}

/** What an edit sends to change an item's links: only the ones added and removed. */
export interface LinkChanges {
  linkItems?: string[];
  unlinkItems?: string[];
}

/**
 * The links added and removed going from `before` to `after` (item ids), as an
 * edit sends them, so a co-owner's change to other links meanwhile isn't
 * undone. Empty (`{}`) when nothing changed.
 */
export function linkChanges(before: readonly string[], after: readonly string[]): LinkChanges {
  const was = new Set(before);
  const now = new Set(after);
  const linkItems = [...now].filter((id) => !was.has(id));
  const unlinkItems = [...was].filter((id) => !now.has(id));
  return {
    ...(linkItems.length ? { linkItems } : {}),
    ...(unlinkItems.length ? { unlinkItems } : {}),
  };
}

/**
 * `current` partners after applying `changes`: removed ones dropped, added ones
 * appended (named from `names`, skipped if it has no name for one), with no
 * repeats. What the page shows while an edit is in flight.
 */
export function applyLinkChanges(
  current: readonly ItemRef[],
  changes: LinkChanges,
  names: ReadonlyMap<string, string>
): ItemRef[] {
  const unlink = new Set(changes.unlinkItems ?? []);
  const next = current.filter((ref) => !unlink.has(ref.id));
  for (const id of changes.linkItems ?? []) {
    const name = names.get(id);
    if (name !== undefined && !next.some((ref) => ref.id === id)) next.push({ id, name });
  }
  return next;
}

/** An item as the link rules read it. */
export interface LinkSource {
  _id: { toString(): string };
  name: string;
  status: string;
  relatedItems?: ReadonlyArray<{ toString(): string }> | null;
}

/**
 * Each item's partners as the viewer may see them, given every item the viewer
 * was given on the list (`visible`, already filtered for them: no drafts for a
 * non-owner, nobody else's proposal). A partner shows only when it's in
 * `visible`, can be linked (never a proposal), isn't the item itself, and
 * records the link back. Keyed by item id, in the order the item records them,
 * at most `ITEM_LINKS_MAX`. Reads nothing: the list read has every item already.
 */
export function linkedItemRefs(visible: readonly LinkSource[]): Map<string, ItemRef[]> {
  const byId = new Map<string, LinkSource>();
  for (const item of visible) {
    if (isLinkableStatus(item.status)) byId.set(item._id.toString(), item);
  }
  const refs = new Map<string, ItemRef[]>();
  for (const item of visible) {
    const id = item._id.toString();
    refs.set(id, isLinkableStatus(item.status) ? partnersOf(id, item, byId) : []);
  }
  return refs;
}

function partnersOf(id: string, item: LinkSource, byId: ReadonlyMap<string, LinkSource>) {
  return mutualPartners(id, item, byId).map((partner) => ({
    id: partner._id.toString(),
    name: partner.name,
  }));
}

/**
 * The partners of `item` (id `id`) among `byId` that record the link back, in
 * the order the item records them: never itself, never twice, at most
 * `ITEM_LINKS_MAX`. The one rule of what a link is, for reads and copies alike.
 */
function mutualPartners<T extends Pick<LinkSource, '_id' | 'relatedItems'>>(
  id: string,
  item: Pick<LinkSource, 'relatedItems'>,
  byId: ReadonlyMap<string, T>
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const raw of item.relatedItems ?? []) {
    const partnerId = raw.toString();
    if (partnerId === id || seen.has(partnerId)) continue;
    const partner = byId.get(partnerId);
    if (!partner || !recordsLink(partner, id)) continue;
    seen.add(partnerId);
    out.push(partner);
    if (out.length === ITEM_LINKS_MAX) break;
  }
  return out;
}

/** Whether `item` records a link to `partnerId`. */
export function recordsLink(item: Pick<LinkSource, 'relatedItems'>, partnerId: string): boolean {
  return (item.relatedItems ?? []).some((raw) => raw.toString() === partnerId);
}

/**
 * The links between copied items, remapped onto their copies (WIS-325's
 * `/copy`): a link stays only when both items are copied and both record it;
 * one to an item left out is dropped. `copyIds` maps each copied item's id to
 * its copy's. Keyed by the source item's id.
 */
export function remapLinks<T>(
  items: readonly Pick<LinkSource, '_id' | 'relatedItems'>[],
  copyIds: ReadonlyMap<string, T>
): Map<string, T[]> {
  const copied = items.filter((item) => copyIds.has(item._id.toString()));
  const byId = new Map(copied.map((item) => [item._id.toString(), item]));
  const out = new Map<string, T[]>();
  for (const item of items) {
    const id = item._id.toString();
    out.set(
      id,
      mutualPartners(id, item, byId).map((partner) => copyIds.get(partner._id.toString())!)
    );
  }
  return out;
}

/**
 * The page's items once `edited` is saved, as the server answered it: every
 * other item's chip for it added, renamed or removed so it matches `edited`'s
 * own partners (links are symmetric), without waiting for the next read. An
 * item whose chips don't change is kept as it is.
 */
export function syncPartnerChips<T extends { _id: string; relatedItems?: ItemRef[] }>(
  items: readonly T[],
  edited: { _id: string; name: string; relatedItems?: readonly ItemRef[] }
): T[] {
  const partners = new Set((edited.relatedItems ?? []).map((ref) => ref.id));
  return items.map((item) => {
    if (item._id === edited._id) return item;
    const refs = item.relatedItems ?? [];
    const at = refs.findIndex((ref) => ref.id === edited._id);
    if (partners.has(item._id)) {
      if (at === -1) {
        return { ...item, relatedItems: [...refs, { id: edited._id, name: edited.name }] };
      }
      if (refs[at].name === edited.name) return item;
      const renamed = refs.slice();
      renamed[at] = { id: edited._id, name: edited.name };
      return { ...item, relatedItems: renamed };
    }
    if (at === -1) return item;
    return { ...item, relatedItems: refs.filter((ref) => ref.id !== edited._id) };
  });
}
