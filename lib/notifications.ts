import mongoose from 'mongoose';
import Notification, { NotificationType } from '@/models/Notification';
import Wishlist from '@/models/Wishlist';
import { errorKind } from '@/lib/utils/errorKind';

type Id = string | mongoose.Types.ObjectId;

interface CreateNotificationArgs {
  user: Id; // recipient
  type: NotificationType;
  actorUsername?: string | null;
  wishlist?: Id | null;
  wishlistName?: string | null;
  wishlistSlug?: string | null;
  itemName?: string | null;
}

/**
 * How far back a burst reaches: a new follow (or proposal) folds into an unread
 * row of the same kind written in this window, and a re-follow by someone
 * already in one, read or not, is dropped. Measured from the row's `createdAt`,
 * which every coalesced event bumps to now.
 */
export const COALESCE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How many actors a coalesced follow row names (the latest ones). */
export const MAX_ACTOR_USERNAMES = 3;

/**
 * Types that never name their actor, whatever a caller passes: owners must never
 * learn who proposed an item, and a role change never says which owner made it.
 */
const ANONYMOUS_TYPES: ReadonlySet<NotificationType> = new Set([
  'proposal',
  'role_changed',
  'removed_from_wishlist',
]);

/**
 * Create a notification. Best-effort: a notification is a side effect, so it
 * must never fail (or slow to a crawl) the action that triggered it — any error
 * is logged and swallowed. Assumes the caller has already connected to the DB.
 *
 * Bursts are coalesced at write time, so they take up one row of the feed:
 *  - `follow`: folds into the recipient's unread follow row from the last 24h,
 *    and is dropped if this actor already shows up in a follow row from the
 *    last 24h (follow → unfollow → follow notifies once).
 *  - `proposal`: folds into the recipient's unread proposal row for the same
 *    wishlist from the last 24h. Still anonymous: it never carries an actor.
 *  - Everything else (`wishlist_invite`, `invite_accepted`, `proposal_approved`,
 *    `role_changed`, `removed_from_wishlist`) is one row per event; an invite in
 *    particular is actionable on its own.
 *
 * A notification about a wishlist is taken back if the list turns out to be
 * gone once it's written: see `dropIfWishlistGone`.
 */
export async function createNotification(args: CreateNotificationArgs): Promise<void> {
  await createNotifications([args.user], args);
}

/**
 * Same notification to several recipients — used to fan an event out to every
 * owner of a co-owned wishlist, so no owner misses a proposal just because
 * someone else created the list. Duplicate ids are collapsed. The list is
 * re-checked once for the whole fan-out, after every row is written.
 */
export async function createNotifications(
  users: Id[],
  args: Omit<CreateNotificationArgs, 'user'>
): Promise<void> {
  // `String`, not `.toString()`: a missing recipient must fail in the guarded
  // write below, which logs it, not throw out of a best-effort side effect.
  const unique = Array.from(new Set(users.map(String)));
  const ids = await Promise.all(unique.map((user) => writeNotification({ ...args, user })));
  const written = ids.filter((id): id is mongoose.Types.ObjectId => id !== null);
  if (args.wishlist) await dropIfWishlistGone(args.wishlist, written);
}

/**
 * Write one notification (or fold it into a coalesced row), and return the id of
 * the row that now carries it. Null when there's no list notification to
 * re-check: a follow (which never carries a list) or a failed write, which is
 * logged and swallowed.
 */
async function writeNotification(
  args: CreateNotificationArgs
): Promise<mongoose.Types.ObjectId | null> {
  try {
    if (args.type === 'follow') {
      await notifyFollow(args);
      return null;
    }
    if (args.type === 'proposal' && args.wishlist) {
      return await notifyProposal({ ...args, wishlist: args.wishlist });
    }
    const row = await Notification.create({
      user: args.user,
      type: args.type,
      actorUsername: ANONYMOUS_TYPES.has(args.type) ? null : (args.actorUsername ?? null),
      wishlist: args.wishlist ?? null,
      wishlistName: args.wishlistName ?? null,
      wishlistSlug: args.wishlistSlug ?? null,
      itemName: args.itemName ?? null,
      read: false,
    });
    return row._id;
  } catch (err) {
    // By kind only: a validation error quotes the values it refused, the recipient's id included.
    console.error('Failed to create notification:', errorKind(err));
    return null;
  }
}

/**
 * Take back the notifications just written about a wishlist if it no longer
 * exists. Deleting a list (DELETE /api/wishlists/[id]) removes the list and only
 * then clears its notifications, so a request that was already past its own
 * checks can write one after that cleanup has run, which would outlive the list
 * as a link to a 404. Re-reading the list once the row is written closes that: a
 * list that's still there now can only be deleted later, and that delete's
 * cleanup takes the row.
 *
 * Best-effort, like the write: a failed check or delete is logged by its kind
 * only, and leaves the notification in place.
 */
async function dropIfWishlistGone(wishlist: Id, ids: mongoose.Types.ObjectId[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    if (await Wishlist.exists({ _id: wishlist })) return;
    await Notification.deleteMany({ _id: { $in: ids }, wishlist });
  } catch (err) {
    console.error('Failed to re-check the wishlist of a new notification:', errorKind(err));
  }
}

// One conditional upsert: fold into the newest matching row, or insert a fresh
// one (count 1) when there's none. Not unique-indexed, so two events racing past
// an empty window can each insert — two rows now and then, which is acceptable.
// `createdAt` is bumped on purpose, so the row climbs back to the top of the
// feed; the timestamps plugin strips it from an update without this opt-in.
// Only the id of the row written is read (a proposal's, to re-check its list),
// so it comes back lean, as just its id, and as it is after the write.
const UPSERT_OPTIONS = {
  upsert: true,
  sort: { createdAt: -1 },
  overwriteImmutable: true,
  projection: { _id: 1 },
  returnDocument: 'after',
  lean: true,
} as const;

async function notifyFollow(args: CreateNotificationArgs): Promise<void> {
  const actor = args.actorUsername ?? null;
  const now = new Date();
  const since = new Date(now.getTime() - COALESCE_WINDOW_MS);

  // Follow churn: this actor already notified this recipient recently (read or
  // unread), so a re-follow after an unfollow says nothing new.
  if (actor) {
    const seen = await Notification.exists({
      user: args.user,
      type: 'follow',
      createdAt: { $gte: since },
      $or: [{ actorUsername: actor }, { actorUsernames: actor }],
    });
    if (seen) return;
  }

  await Notification.findOneAndUpdate(
    { user: args.user, type: 'follow', read: false, createdAt: { $gte: since } },
    {
      $set: { actorUsername: actor, createdAt: now },
      $inc: { count: 1 },
      ...(actor
        ? { $push: { actorUsernames: { $each: [actor], $slice: -MAX_ACTOR_USERNAMES } } }
        : {}),
    },
    UPSERT_OPTIONS
  );
}

async function notifyProposal(
  args: CreateNotificationArgs & { wishlist: Id }
): Promise<mongoose.Types.ObjectId | null> {
  const now = new Date();
  const since = new Date(now.getTime() - COALESCE_WINDOW_MS);

  const row = await Notification.findOneAndUpdate(
    {
      user: args.user,
      type: 'proposal',
      wishlist: args.wishlist,
      read: false,
      createdAt: { $gte: since },
    },
    {
      $set: {
        // Anonymous, always: no actor and no actor list, whatever a caller passes.
        actorUsername: null,
        createdAt: now,
        // Latest snapshot, so a renamed list reads right.
        wishlistName: args.wishlistName ?? null,
        wishlistSlug: args.wishlistSlug ?? null,
        itemName: args.itemName ?? null,
      },
      $inc: { count: 1 },
    },
    UPSERT_OPTIONS
  );
  return row?._id ?? null;
}
