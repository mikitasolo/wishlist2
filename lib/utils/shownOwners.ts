import { createListChangeLog } from '@/lib/utils/listRefresh';

/**
 * The owners the wishlist page counts and credits. They come from its reads of
 * the list, and an owner its own demotion (Make member) or removal took off goes
 * at once, before the list is read again, so the count, the byline and who may
 * leave follow straight away: the sole remaining owner isn't offered Leave,
 * which the server refuses (a list always keeps an owner).
 */
export interface ShownOwners {
  /** Every owner's user id. Their count decides who may leave or be stepped down. */
  ids: string[];
  /** The owners' usernames, for the byline. An owner without one isn't in it. */
  usernames: string[];
}

/** The owners named by a read of the list (`GET /api/wishlists/[id]`). */
export function shownOwnersOf(list: {
  owners?: readonly unknown[] | null;
  ownerUsernames?: readonly string[] | null;
  ownerUsername?: string | null;
}): ShownOwners {
  return {
    ids: (list.owners ?? []).map(String),
    usernames: [...(list.ownerUsernames ?? (list.ownerUsername ? [list.ownerUsername] : []))],
  };
}

/** An owner the page has taken off the list. */
export interface RemovedOwner {
  id: string;
  /** Their username as the page showed it, or `null` if they have none. */
  username: string | null;
}

/** `owners` without `removed`. Usernames are unique, so theirs is the only one dropped. */
export function withoutOwner(owners: ShownOwners, removed: RemovedOwner): ShownOwners {
  return {
    ids: owners.ids.filter((id) => id !== removed.id),
    usernames:
      removed.username === null
        ? owners.usernames
        : owners.usernames.filter((name) => name !== removed.username),
  };
}

/**
 * The owners the page has taken off the list, stamped, so a read of the list
 * the server answered before one of those landed can't put them back: say the
 * read that opening Manage sent is still out when a co-owner is made a member,
 * and comes back after the demotion has landed, still listing them.
 */
export interface OwnerRemovalLog {
  /** A stamp for a read of the list, taken right before its request is sent. */
  stamp(): number;
  /** The page took this owner off, once the server has. */
  removed(owner: RemovedOwner): void;
  /**
   * The owners a read sent at `sentAt` came back with, less every one the page
   * has taken off since it was sent; or `null` if a read sent after it has
   * landed already, so the page's owners are newer than this read's.
   */
  land(sentAt: number, read: ShownOwners): ShownOwners | null;
}

export function createOwnerRemovalLog(): OwnerRemovalLog {
  const log = createListChangeLog();
  // The username to take off the byline with each removed id.
  const usernames = new Map<string, string | null>();
  return {
    stamp: () => log.stamp(),
    removed(owner) {
      usernames.set(owner.id, owner.username);
      log.removed(owner.id);
    },
    land(sentAt, read) {
      const changes = log.land(sentAt);
      if (!changes) return null;
      let owners = read;
      for (const id of changes.removed) {
        owners = withoutOwner(owners, { id, username: usernames.get(id) ?? null });
      }
      return owners;
    },
  };
}
