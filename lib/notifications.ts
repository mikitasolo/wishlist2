import mongoose from 'mongoose';
import Notification, { NotificationType } from '@/models/Notification';

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
 */
export async function createNotification(args: CreateNotificationArgs): Promise<void> {
  try {
    if (args.type === 'follow') {
      await notifyFollow(args);
    } else if (args.type === 'proposal' && args.wishlist) {
      await notifyProposal({ ...args, wishlist: args.wishlist });
    } else {
      await Notification.create({
        user: args.user,
        type: args.type,
        actorUsername: ANONYMOUS_TYPES.has(args.type) ? null : (args.actorUsername ?? null),
        wishlist: args.wishlist ?? null,
        wishlistName: args.wishlistName ?? null,
        wishlistSlug: args.wishlistSlug ?? null,
        itemName: args.itemName ?? null,
        read: false,
      });
    }
  } catch (err) {
    console.error('Failed to create notification:', err);
  }
}

/**
 * Same notification to several recipients — used to fan an event out to every
 * owner of a co-owned wishlist, so no owner misses a proposal just because
 * someone else created the list. Duplicate ids are collapsed.
 */
export async function createNotifications(
  users: Id[],
  args: Omit<CreateNotificationArgs, 'user'>
): Promise<void> {
  const unique = Array.from(new Set(users.map((u) => u.toString())));
  await Promise.all(unique.map((user) => createNotification({ ...args, user })));
}

// One conditional upsert: fold into the newest matching row, or insert a fresh
// one (count 1) when there's none. Not unique-indexed, so two events racing past
// an empty window can each insert — two rows now and then, which is acceptable.
// `createdAt` is bumped on purpose, so the row climbs back to the top of the
// feed; the timestamps plugin strips it from an update without this opt-in.
// Nothing reads the result, so it comes back lean and as just its id.
const UPSERT_OPTIONS = {
  upsert: true,
  sort: { createdAt: -1 },
  overwriteImmutable: true,
  projection: { _id: 1 },
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

async function notifyProposal(args: CreateNotificationArgs & { wishlist: Id }): Promise<void> {
  const now = new Date();
  const since = new Date(now.getTime() - COALESCE_WINDOW_MS);

  await Notification.findOneAndUpdate(
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
}
