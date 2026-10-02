/**
 * Merging a re-read of a list into a page's copy of it, for a page that also
 * changes that copy itself. The Booked page loads its reservations and gift
 * history once, then updates its copies as its own actions land (a gifted or
 * dismissed reservation comes off, the gift's new history entry goes on), and
 * reads both again when the user comes back to the tab or an action finds its
 * record gone. A re-read the server answered before one of those actions was
 * saved can land after it, so replacing the copy with it would undo the
 * action: bring a dismissed card back, or drop the entry a gift just added.
 * The re-read is merged instead: it decides every entry the page hasn't
 * touched since sending it.
 */

// Every log's default clock: a sequence rather than the wall clock, as in
// `createMutationTracker`, so a change made right after a read was sent always
// counts as after it (no same-millisecond tie).
let lastStamp = 0;
function nextStamp(): number {
  lastStamp += 1;
  return lastStamp;
}

/** What the page did to its copy of a list after a re-read of it was sent. */
export interface ListChanges {
  /** Entries the page put on its copy (ones an action returned). */
  added: ReadonlySet<string>;
  /** Entries the page took off its copy. */
  removed: ReadonlySet<string>;
}

/**
 * A page's own changes to its lists, stamped, so a re-read can be merged with
 * the ones made after it was sent; and the reads that have landed, so a read
 * landing after a newer one is ignored.
 *
 * Record a change only once the server has made it (the action's success, or
 * its 404 for a record that's already gone), as the page applies it: a read
 * sent after that is answered with the change already in, so only changes made
 * after a read was sent need merging with it. One log can serve several lists
 * whose entries' ids never clash (a page's reservations and gift history).
 */
export interface ListChangeLog {
  /** A stamp for a read, taken right before its request is sent. */
  stamp(): number;
  /** The page put this entry on its copy. */
  added(id: string): void;
  /** The page took this entry off its copy. */
  removed(id: string): void;
  /**
   * Whether a read sent at `sentAt` is outdated: a read sent after it has
   * already landed, or the log was reset after it was sent. The page's copy is
   * newer than what such a read has, or belongs to another account.
   */
  outdated(sentAt: number): boolean;
  /**
   * Lands a read sent at `sentAt`, which came back fine: returns the changes
   * the page has made since it was sent, to merge it with
   * (`mergeRefreshedList`), or `null` if it's `outdated` and is to be ignored.
   * Changes made before `sentAt` are forgotten, since every read that can still
   * land was sent after them.
   */
  land(sentAt: number): ListChanges | null;
  /**
   * Starts over, for another account's lists: every read sent so far is
   * outdated, and every change recorded is dropped.
   */
  reset(): void;
}

export function createListChangeLog(now: () => number = nextStamp): ListChangeLog {
  let changes: { id: string; kind: 'added' | 'removed'; at: number }[] = [];
  // Reads sent at or before this stamp are outdated.
  let outdatedUpTo = 0;
  return {
    stamp: () => now(),
    added(id) {
      changes.push({ id, kind: 'added', at: now() });
    },
    removed(id) {
      changes.push({ id, kind: 'removed', at: now() });
    },
    outdated: (sentAt) => sentAt <= outdatedUpTo,
    land(sentAt) {
      if (sentAt <= outdatedUpTo) return null;
      outdatedUpTo = sentAt;
      changes = changes.filter((change) => change.at > sentAt);
      const added = new Set<string>();
      const removed = new Set<string>();
      for (const { id, kind } of changes) {
        (kind === 'added' ? added : removed).add(id);
      }
      return { added, removed };
    },
    reset() {
      outdatedUpTo = now();
      changes = [];
    },
  };
}

export interface MergeOptions<T> {
  /**
   * Entries whose own action is still in flight. Each is left exactly as the
   * page has it, kept if the read lacks it and not replaced by the read's copy,
   * so a refresh never takes a busy card off the page or changes it under the
   * pointer. Its action's answer decides it.
   */
  held?: (id: string) => boolean;
  /** The list's order. Without it, entries keep the read's order. */
  compare?: (a: T, b: T) => number;
}

/**
 * `current`, the page's copy of a list, brought up to date with `read`, a
 * re-read of it, without undoing what the page did to its copy after sending
 * the read (`changes`, from `ListChangeLog.land`):
 * - the read decides every other entry, so one added elsewhere appears, one
 *   removed elsewhere goes, and one changed elsewhere takes the read's copy;
 * - an entry the page took off stays off, even if the read still has it;
 * - an entry the page put on stays on, even if the read lacks it;
 * - a `held` entry is left as the page has it.
 *
 * An entry kept from `current` that the read lacks goes right after the entry
 * it follows in `current` (at the top if none), then `compare` sorts the list.
 */
export function mergeRefreshedList<T extends { _id: string }>(
  current: readonly T[],
  read: readonly T[],
  changes: ListChanges,
  { held = () => false, compare }: MergeOptions<T> = {}
): T[] {
  const local = new Map(current.map((entry) => [entry._id, entry]));
  const fromRead: T[] = [];
  const readIds = new Set<string>();
  for (const entry of read) {
    if (changes.removed.has(entry._id) || readIds.has(entry._id)) continue;
    readIds.add(entry._id);
    fromRead.push(held(entry._id) ? (local.get(entry._id) ?? entry) : entry);
  }

  // The entries kept from `current` that the read lacks, by the read's entry
  // they follow in `current` (`top` if none).
  const top: T[] = [];
  const following = new Map<string, T[]>();
  const keptIds = new Set<string>();
  let anchor: T[] = top;
  for (const entry of current) {
    if (readIds.has(entry._id)) {
      anchor = following.get(entry._id) ?? [];
      following.set(entry._id, anchor);
      continue;
    }
    if (keptIds.has(entry._id) || changes.removed.has(entry._id)) continue;
    if (!changes.added.has(entry._id) && !held(entry._id)) continue;
    keptIds.add(entry._id);
    anchor.push(entry);
  }

  const merged = [...top];
  for (const entry of fromRead) merged.push(entry, ...(following.get(entry._id) ?? []));
  return compare ? merged.sort(compare) : merged;
}
