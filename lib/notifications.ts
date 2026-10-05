import mongoose from 'mongoose';
import Notification, { NotificationType } from '@/models/Notification';
import Wishlist from '@/models/Wishlist';
import type { IWishlistInvite } from '@/models/WishlistInvite';
import { showsActor, type InviteAnswer, type InviteRole } from '@/lib/utils/notifications';
import { errorKind } from '@/lib/utils/errorKind';
import WishlistMember from '@/models/WishlistMember';
import User from '@/models/User';
import { isDuplicateKeyError } from '@/lib/utils/mongoErrors';
import {
  notificationDefault,
  notificationEventOf,
  notificationOptInFilter,
  notificationPrefPath,
  type NotificationChannel,
  type NotificationEvent,
} from '@/lib/utils/notificationPrefs';
import { nextOccurrence, type OccasionKind } from '@/lib/utils/occasion';

type Id = string | mongoose.Types.ObjectId;

interface CreateNotificationArgs {
  user: Id; // recipient
  type: NotificationType;
  actorUsername?: string | null;
  /** The actor's account, kept only on the types that show who did it (`showsActor`). */
  actor?: Id | null;
  wishlist?: Id | null;
  wishlistName?: string | null;
  wishlistSlug?: string | null;
  itemName?: string | null;
  /** `wishlist_invite` only: the role it offers. */
  inviteRole?: InviteRole | null;
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
export async function createNotification(
  args: CreateNotificationArgs
): Promise<mongoose.Types.ObjectId | null> {
  const [id] = await createNotifications([args.user], args);
  return id ?? null;
}

/**
 * Same notification to several recipients — used to fan an event out to every
 * owner of a co-owned wishlist, so no owner misses a proposal just because
 * someone else created the list. Duplicate ids are collapsed, and anyone who
 * turned the event's in-app setting off is skipped (`recipientsWanting`). The
 * list is re-checked once for the whole fan-out, after every row is written.
 *
 * Returns the ids of the rows that carry it (a follow and a failed write have
 * none), so a caller can take back exactly what it wrote: see
 * `issueWishlistInvite`.
 */
export async function createNotifications(
  users: Id[],
  args: Omit<CreateNotificationArgs, 'user'>
): Promise<mongoose.Types.ObjectId[]> {
  // `String`, not `.toString()`: a missing recipient must fail in the guarded
  // write below, which logs it, not throw out of a best-effort side effect.
  const unique = await recipientsWanting(
    Array.from(new Set(users.map(String))),
    notificationEventOf(args.type),
    'inApp'
  );
  const ids = await Promise.all(unique.map((user) => writeNotification({ ...args, user })));
  const written = ids.filter((id): id is mongoose.Types.ObjectId => id !== null);
  if (args.wishlist) await dropIfWishlistGone(args.wishlist, written);
  return written;
}

/**
 * Of `users`, those who get `event` on `channel` (Settings → Notifications), in
 * the order given. A setting on by default drops only those who turned it off,
 * so an id with no account behind it is kept (a later write fails on it, or
 * nothing reads it); one off by default keeps only those who turned it on.
 * Nobody, on a channel the event isn't offered on.
 *
 * Read when the notification is written, not when the action began, so a
 * setting changed a moment before is honoured. A failed read keeps the
 * default's answer (everyone for one on by default, nobody otherwise), logged
 * by its kind: a preference is a side effect's side effect, never a reason to
 * fail or lose what the default would send.
 */
export async function recipientsWanting(
  users: Id[],
  event: NotificationEvent,
  channel: NotificationChannel
): Promise<string[]> {
  const ids = users.map(String);
  const fallback = notificationDefault(event, channel);
  if (ids.length === 0 || fallback === undefined) return [];
  const path = notificationPrefPath(event, channel);
  try {
    if (fallback) {
      const off = await User.find({ _id: { $in: ids }, [path]: false })
        .select('_id')
        .lean();
      const offSet = new Set(off.map((u) => String(u._id)));
      return ids.filter((id) => !offSet.has(id));
    }
    const on = await User.find({ _id: { $in: ids }, ...notificationOptInFilter(event, channel) })
      .select('_id')
      .lean();
    const onSet = new Set(on.map((u) => String(u._id)));
    return ids.filter((id) => onSet.has(id));
  } catch (err) {
    console.error('Failed to read notification settings:', errorKind(err));
    return fallback ? ids : [];
  }
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
      ...(showsActor(args.type) && args.actor ? { actor: args.actor } : {}),
      wishlist: args.wishlist ?? null,
      wishlistName: args.wishlistName ?? null,
      wishlistSlug: args.wishlistSlug ?? null,
      itemName: args.itemName ?? null,
      ...(args.type === 'wishlist_invite' && args.inviteRole
        ? { inviteRole: args.inviteRole }
        : {}),
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

interface RecordInviteAnswerArgs {
  /** The invite just answered, as the answer read it. */
  invite: Pick<IWishlistInvite, 'wishlist' | 'invitedUser' | 'createdAt'>;
  answer: InviteAnswer;
  /** Taken before the write that claimed the invite for this answer. */
  answeredAt: Date;
}

/**
 * Record an invitee's answer on their own notification for that invite, and mark
 * it read, in one write. It then reads "You joined …" or "You declined the invite
 * to …" instead of an invite that is still waiting (when its card is gone from
 * Activity), and Activity's badge stops counting it. Call it only once
 * the answer has landed: for an accept, once the role is granted.
 *
 * Notifications carry no invite id, so the row is told apart by its time: the
 * invitee's `wishlist_invite` rows for that list written between the invite and
 * the answer. Issuing an invite writes its notification right after the invite,
 * so that row is no older than the invite. An earlier invite to the list had
 * been answered or cancelled before this one could be issued (one pending invite
 * per person per list), so its row is older. A re-invite can only be issued once
 * this answer has claimed the invite, so its row is newer than `answeredAt`.
 * Nobody else's notification can match: the filter is on the invitee.
 *
 * Best-effort, like every notification write: a failure is logged by its kind
 * only and swallowed, so it never fails the answer, and leaves the row as it was.
 */
export async function recordInviteAnswer({
  invite,
  answer,
  answeredAt,
}: RecordInviteAnswerArgs): Promise<void> {
  try {
    await Notification.updateMany(inviteNotificationFilter(invite, answeredAt), {
      $set: { read: true, inviteAnswer: answer },
    });
  } catch (err) {
    console.error('Failed to record an invite answer on its notification:', errorKind(err));
  }
}

/**
 * Delete the invitee's own notification for an invite that an accept had
 * claimed and then dropped, because a newer pending invite for them on the list
 * took its place while it was claimed (WIS-294). There's no answer to record on
 * it (they neither joined nor declined) and nothing left to accept, so it goes,
 * as a cancelled invite's does. The newer invite keeps its own: it could only be
 * issued once the claim had landed, so its row is newer than `answeredAt`, outside
 * the window `recordInviteAnswer` uses, which this shares.
 *
 * Best-effort: a failure is logged by its kind only and swallowed.
 */
export async function clearSupersededInviteNotification({
  invite,
  answeredAt,
}: Omit<RecordInviteAnswerArgs, 'answer'>): Promise<void> {
  try {
    await Notification.deleteMany(inviteNotificationFilter(invite, answeredAt));
  } catch (err) {
    console.error('Failed to clear a superseded invite notification:', errorKind(err));
  }
}

/** The invitee's notification for one invite, told apart by its time (see above). */
function inviteNotificationFilter(invite: RecordInviteAnswerArgs['invite'], answeredAt: Date) {
  return {
    user: invite.invitedUser,
    type: 'wishlist_invite' as const,
    wishlist: invite.wishlist,
    createdAt: { $gte: invite.createdAt, $lte: answeredAt },
  };
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
      // The row's avatar and Follow back are the latest follower's.
      $set: { actorUsername: actor, actor: args.actor ?? null, createdAt: now },
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

interface OccasionReminderArgs {
  wishlist: { _id: mongoose.Types.ObjectId; name: string; slug?: string | null };
  occasion: { kind: OccasionKind };
  /** The occurrence it's about: a real `YYYY-MM-DD` (a yearly one's next one). */
  occasionDate: string;
  users: mongoose.Types.ObjectId[];
}

/**
 * Write an occasion reminder for each of `users` about one occurrence of a
 * list's occasion (WIS-193), and return how many new ones stand. Each is an
 * upsert on the reminder's unique key (`user`, `wishlist`, `occasionDate`), so
 * one already there is left as it is (read or not) and a concurrent run's
 * duplicate is refused by the index: nobody is reminded twice about one day.
 *
 * Then, as `dropIfWishlistGone` does for every list notification, the rows just
 * written are re-checked against the list and its people as they are now, and
 * taken back unless they still hold: the list is gone, archived, or its occasion
 * no longer falls on `occasionDate` (all of them), or a recipient is no longer
 * a member, is an owner now, or has turned reminders off (theirs).
 *
 * The row says which list, its occasion's kind and the day: no actor, and
 * nothing about bookings or what's left to give.
 *
 * Best-effort: a failure is logged by its kind only and counts as nothing sent.
 */
export async function createOccasionReminders({
  wishlist,
  occasion,
  occasionDate,
  users,
}: OccasionReminderArgs): Promise<number> {
  if (users.length === 0) return 0;
  let written: mongoose.Types.ObjectId[];
  try {
    const result = await Notification.bulkWrite(
      users.map((user) => ({
        updateOne: {
          filter: {
            user,
            wishlist: wishlist._id,
            type: 'occasion_reminder' as const,
            occasionDate,
          },
          update: {
            $setOnInsert: {
              actorUsername: null,
              count: 1,
              wishlistName: wishlist.name,
              wishlistSlug: wishlist.slug ?? null,
              itemName: null,
              occasionKind: occasion.kind,
              read: false,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    written = Object.values(result.upsertedIds);
  } catch (err) {
    // A concurrent run inserted some of the same reminders first: the index
    // refuses ours, and the rest of the batch still lands (`ordered: false`).
    const upserted = onlyDuplicateKeyErrors(err);
    if (!upserted) {
      console.error('Failed to write occasion reminders:', errorKind(err));
      return 0;
    }
    written = upserted;
  }
  if (written.length === 0) return 0;
  return written.length - (await dropStaleOccasionReminders(wishlist._id, occasionDate, written));
}

/**
 * The ids a bulk write still upserted, when everything it refused was a
 * duplicate key; `null` for any other failure.
 */
function onlyDuplicateKeyErrors(err: unknown): mongoose.Types.ObjectId[] | null {
  if (typeof err !== 'object' || err === null) return null;
  const { writeErrors, result } = err as {
    writeErrors?: unknown;
    result?: { upsertedIds?: Record<number, mongoose.Types.ObjectId> };
  };
  const errors = Array.isArray(writeErrors) ? writeErrors : writeErrors ? [writeErrors] : [];
  if (errors.length === 0 || !errors.every(isDuplicateKeyError)) return null;
  return Object.values(result?.upsertedIds ?? {});
}

/**
 * The re-check after `createOccasionReminders`' write: deletes those of `ids`
 * that no longer hold (see there), and returns how many it deleted.
 */
async function dropStaleOccasionReminders(
  wishlistId: mongoose.Types.ObjectId,
  occasionDate: string,
  ids: mongoose.Types.ObjectId[]
): Promise<number> {
  try {
    const list = await Wishlist.findById(wishlistId).select('owners archived occasion').lean();
    const occasion = list?.occasion;
    const stillDue =
      !!list &&
      !list.archived &&
      !!occasion &&
      nextOccurrence(occasion.date, occasion.recurrence ?? null, occasionDate) === occasionDate;
    if (!stillDue) {
      const { deletedCount } = await Notification.deleteMany({ _id: { $in: ids } });
      return deletedCount;
    }

    const rows = await Notification.find({ _id: { $in: ids } })
      .select('user')
      .lean();
    const recipients = rows.map((r) => r.user);
    const [members, wanting] = await Promise.all([
      WishlistMember.find({ wishlist: wishlistId, user: { $in: recipients } })
        .select('user')
        .lean(),
      User.find({
        _id: { $in: recipients },
        ...notificationOptInFilter('occasion_reminder', 'inApp'),
      })
        .select('_id')
        .lean(),
    ]);
    const owners = new Set(list.owners.map(String));
    const memberSet = new Set(members.map((m) => String(m.user)));
    const wantSet = new Set(wanting.map((u) => String(u._id)));
    const stale = rows
      .filter((r) => {
        const user = String(r.user);
        return owners.has(user) || !memberSet.has(user) || !wantSet.has(user);
      })
      .map((r) => r._id);
    if (stale.length === 0) return 0;
    const { deletedCount } = await Notification.deleteMany({ _id: { $in: stale } });
    return deletedCount;
  } catch (err) {
    console.error('Failed to re-check new occasion reminders:', errorKind(err));
    return 0;
  }
}
