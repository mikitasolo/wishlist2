/**
 * Keeps the cards a viewer has just changed where they were (WIS-297).
 *
 * A list's chips, search and sort place each item by its status, so a card
 * whose status the viewer changes would otherwise jump: a member who reserves
 * on Available would see it vanish (its Release with it), and under All it
 * would move to another group mid-tap. Instead, each card the viewer changes is
 * pinned to the slot it had, and stays in view, until the viewer changes the
 * chip, the search or the sort, or reloads.
 *
 * Pinning only decides where a card goes and whether it's shown. The card is
 * always the item as last read (a poll's content lands on it in place), so it
 * shows its own status, folded for an owner as everywhere else.
 */

interface Identified {
  _id: string;
}

/**
 * Lays `fresh` (the items the chip, search and sort would show, in order) out
 * with every pinned item in its slot from `anchor` (the order on screen when
 * it was pinned). A pinned item goes right after the nearest card before it in
 * `anchor` that is still shown and not pinned, or first when there's none. A
 * pinned item that's gone from `all` (deleted, declined) is left out, and one
 * missing from `anchor` is placed as `fresh` places it.
 */
export function keepPinnedInPlace<T extends Identified>(
  fresh: readonly T[],
  all: readonly T[],
  pinned: readonly string[],
  anchor: readonly string[]
): T[] {
  if (pinned.length === 0) return [...fresh];
  const byId = new Map(all.map((item) => [item._id, item]));
  const anchorIndex = new Map(anchor.map((id, index) => [id, index]));
  const sticky = new Set(pinned.filter((id) => byId.has(id) && anchorIndex.has(id)));

  const rest = fresh.filter((item) => !sticky.has(item._id));
  const restIds = new Set(rest.map((item) => item._id));

  // Each pinned item's place in `rest`: after the card it followed, or first.
  const after = new Map<string | null, T[]>();
  for (const id of anchor) {
    if (!sticky.has(id)) continue;
    let predecessor: string | null = null;
    for (let i = anchorIndex.get(id)! - 1; i >= 0; i--) {
      const candidate = anchor[i];
      if (!sticky.has(candidate) && restIds.has(candidate)) {
        predecessor = candidate;
        break;
      }
    }
    const group = after.get(predecessor) ?? [];
    group.push(byId.get(id)!);
    after.set(predecessor, group);
  }

  const result: T[] = [...(after.get(null) ?? [])];
  for (const item of rest) {
    result.push(item, ...(after.get(item._id) ?? []));
  }
  return result;
}

/** Pins `id` too, with the order now on screen as the anchor for every pin. */
export function addPin(
  pinned: readonly string[],
  id: string,
  shown: readonly string[]
): { pinned: string[]; anchor: string[] } {
  return {
    pinned: pinned.includes(id) ? [...pinned] : [...pinned, id],
    anchor: [...shown],
  };
}
