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
 * with every pinned item in its slot: the position it had in `anchor` (the
 * order on screen when it was pinned), with everything else filling the other
 * slots in `fresh`'s order. A slot is a position, not a neighbour, so a poll
 * that moves or drops the card beside a pinned one doesn't take it along. A
 * pinned item past the end goes last, one gone from `all` (deleted, declined)
 * is left out, and one missing from `anchor` is placed as `fresh` places it.
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
  const sticky = pinned
    .filter((id, i) => byId.has(id) && anchorIndex.has(id) && pinned.indexOf(id) === i)
    .sort((a, b) => anchorIndex.get(a)! - anchorIndex.get(b)!);
  const stickySet = new Set(sticky);
  const rest = fresh.filter((item) => !stickySet.has(item._id));

  const result: T[] = [];
  let r = 0;
  let p = 0;
  while (r < rest.length || p < sticky.length) {
    if (p < sticky.length && (anchorIndex.get(sticky[p])! <= result.length || r >= rest.length)) {
      result.push(byId.get(sticky[p++])!);
    } else {
      result.push(rest[r++]);
    }
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
