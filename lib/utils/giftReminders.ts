import mongoose, { type FilterQuery } from 'mongoose';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import User from '@/models/User';
import Item from '@/models/Item';
import GroupGift from '@/models/GroupGift';
import Reservation, { type IReservation } from '@/models/Reservation';
import Notification from '@/models/Notification';
import NotificationEmailClaim from '@/models/NotificationEmailClaim';
import { onlyDuplicateKeyErrors } from '@/lib/notifications';
import { claimOccurrenceEmail, sendOne } from '@/lib/notificationEmails';
import { notificationOptInFilter } from '@/lib/utils/notificationPrefs';
import { isWishlistOwner } from '@/lib/utils/wishlistOwners';
import { errorKind } from '@/lib/utils/errorKind';
import {
  GIFT_REMINDER_NOTIFICATION_TYPES,
  type GiftReminderNotificationType,
} from '@/lib/utils/notifications';
import {
  OCCASION_REMINDER_CATCH_UP_DAYS,
  OCCASION_REMINDER_LEAD_DAYS,
  storedDatesDue,
} from '@/lib/utils/occasionReminders';
import {
  addDays,
  nextOccurrence,
  utcDateString,
  type Occasion,
  type OccasionRecurrence,
} from '@/lib/utils/occasion';

/**
 * Reminders about what you've reserved (WIS-384; the operator's decision of
 * 2026-10-10: its own events, a week before, plus the "after" nudge). The daily
 * cron (`GET /api/cron/gift-reminders`) runs `sendGiftReminders`.
 *
 * - **Who**: whoever holds something on the list now, as a plain member: a
 *   `Reservation` of theirs whose item is still booked by them (a solo
 *   booking), or whose item's live group gift they're still in (a pledge),
 *   and a membership of the list, not an owner, the list not archived
 *   (`giftHolders`; the nudge after: a live group gift's organizer only, who
 *   alone can give it, and a gifter whose item was marked received too).
 *   Marking a gift as given ends its Reservation, so a gift
 *   given is no longer held. Never owners (who are booking-blind), never other
 *   members, never anyone who turned the event off in Settings.
 * - **When**: `gift_reminder` `OCCASION_REMINDER_LEAD_DAYS` (7) before the
 *   list's next occurrence; `gift_nudge` `GIFT_NUDGE_DELAY_DAYS` (3) after one,
 *   only for reservations made before its day was over. Each with the occasion
 *   reminders' catch-up (up to 2 days late), counted from the UTC date.
 * - **Once**: per person, list and occurrence and phase (a unique index each,
 *   `createGiftReminders`), so re-runs and overlapping runs send nothing new.
 * - **Re-checked**: after the write (the list and each recipient read again;
 *   a row that no longer holds is taken back), before each email (claimed
 *   first, then read again), and whenever the feed is read
 *   (`hiddenGiftReminderRows`, row by row: a row hides once they no longer hold
 *   what it is about, as a plain member).
 * - **Says**: the list, its occasion's kind and day. No item, no count, nothing
 *   about anyone else's reservations, no actor.
 * - **Capped**: at most `GIFT_REMINDER_MAX_PER_RUN` new rows a run per phase,
 *   nearest the end of its window first; `GIFT_EMAIL_MAX_PER_RUN` emails a run.
 * - **Email**: its own setting per event (off by default), its own claim per
 *   person, list and occurrence (`NotificationEmailClaim`, `kind`: the type).
 */

export const GIFT_NUDGE_DELAY_DAYS = 3;
export const GIFT_REMINDER_MAX_PER_RUN = 500;
/** Every gift reminder email a run, both phases: each is an SMTP send inside the cron's 60s. */
export const GIFT_EMAIL_MAX_PER_RUN = 30;

type Id = string | mongoose.Types.ObjectId;

export type GiftReminderPhase = GiftReminderNotificationType;

/** The days from today whose occurrence each phase is about, nearest the end of its window last. */
export function giftReminderOffsets(phase: GiftReminderPhase): number[] {
  const offsets: number[] = [];
  for (let d = 0; d <= OCCASION_REMINDER_CATCH_UP_DAYS; d++) {
    offsets.push(
      phase === 'gift_reminder' ? OCCASION_REMINDER_LEAD_DAYS - d : -(GIFT_NUDGE_DELAY_DAYS + d)
    );
  }
  return offsets;
}

export interface GiftDueList {
  _id: mongoose.Types.ObjectId;
  name: string;
  slug?: string | null;
  owners: mongoose.Types.ObjectId[];
  occasion: Occasion;
  /** The occurrence the reminder is about: the coming one, or the one just passed. */
  occasionDate: string;
}

/** Whether a list's occasion falls on `date` (`YYYY-MM-DD`). */
export function occursOn(
  occasion: { date: string; recurrence?: OccasionRecurrence | null } | null | undefined,
  date: string
): boolean {
  return !!occasion && nextOccurrence(occasion.date, occasion.recurrence ?? null, date) === date;
}

/**
 * The unarchived lists with an occurrence on one of `phase`'s days from
 * `today`, the one closest to the end of its window (the earliest) first.
 */
export async function listsDueForGiftReminder(
  today: string,
  phase: GiftReminderPhase
): Promise<GiftDueList[]> {
  const offsets = giftReminderOffsets(phase);
  const lists = await Wishlist.find({
    archived: { $ne: true },
    'occasion.date': { $in: storedDatesDue(today, offsets) },
  })
    .select('name slug owners occasion')
    .lean();
  const due: GiftDueList[] = [];
  for (const list of lists) {
    const occasion = list.occasion;
    if (!occasion) continue;
    const date = offsets
      .map((d) => addDays(today, d))
      .find((day): day is string => !!day && occursOn(occasion, day));
    if (date) due.push({ ...list, occasion, occasionDate: date });
  }
  return due.sort(
    (a, b) =>
      a.occasionDate.localeCompare(b.occasionDate) || String(a._id).localeCompare(String(b._id))
  );
}

/**
 * The moment a nudge's reservations must predate: the end of the occasion's
 * day (one made since is for a later occurrence). None for the reminder before.
 */
function reservedBefore(phase: GiftReminderPhase, occasionDate: string): Date | null {
  if (phase === 'gift_reminder') return null;
  const dayAfter = addDays(occasionDate, 1);
  return dayAfter ? new Date(`${dayAfter}T00:00:00Z`) : null;
}

/** Whether a holding that began at `since` counts for `phase`'s occurrence on `occasionDate`. */
export function countsFor(phase: GiftReminderPhase, occasionDate: string, since: Date): boolean {
  const cutoff = reservedBefore(phase, occasionDate);
  return !cutoff || since < cutoff;
}

const holderKey = (wishlist: Id, user: Id) => `${String(wishlist)}:${String(user)}`;

/**
 * Who holds something on which list now for `phase`, among the reservations
 * `filter` matches: a map from `<listId>:<userId>` to the earliest such
 * Reservation's `createdAt` (what a nudge's cutoff is checked against,
 * `countsFor`). Only a plain member of the list (a membership, not an owner,
 * the list there and not archived), and only a Reservation that is theirs to
 * settle:
 *
 * - **before** (`gift_reminder`): its item is still booked by them alone, or
 *   still carries a live group gift they're in;
 * - **after** (`gift_nudge`), what they can mark as given now: a solo booking
 *   as above, one whose item the owner has since marked received, or a live
 *   group gift they **organize** (only its organizer gives it, for everyone;
 *   the other contributors can't, so aren't nudged).
 *
 * The list and memberships are read before the items, as `plainMembersOf`
 * does: becoming an owner grants ownership before it releases, and leaving
 * deletes the membership before it frees, so a read landing in between still
 * sees one of the two. Every send re-checks after its write too.
 */
export async function giftHolders(
  filter: FilterQuery<IReservation>,
  phase: GiftReminderPhase
): Promise<Map<string, Date>> {
  const held = new Map<string, Date>();
  const reservations = await Reservation.find(filter)
    .select('gifter wishlist item createdAt')
    .lean();
  if (reservations.length === 0) return held;
  const listIds = Array.from(new Set(reservations.map((r) => String(r.wishlist))));
  const userIds = Array.from(new Set(reservations.map((r) => String(r.gifter))));

  const memberships = await WishlistMember.find({
    wishlist: { $in: listIds },
    user: { $in: userIds },
  })
    .select('wishlist user')
    .lean();
  const lists = await Wishlist.find({ _id: { $in: listIds } })
    .select('owners archived')
    .lean();
  const member = new Set(memberships.map((m) => holderKey(m.wishlist, m.user)));
  const listById = new Map(lists.map((l) => [String(l._id), l]));

  const items = await Item.find({
    _id: { $in: reservations.map((r) => r.item) },
    status: { $in: phase === 'gift_nudge' ? ['booked', 'completed'] : ['booked'] },
  })
    .select('wishlist status bookedBy groupGift')
    .lean();
  const giftIds = items
    .filter((i) => i.status === 'booked' && i.groupGift)
    .map((i) => i.groupGift as mongoose.Types.ObjectId);
  const gifts =
    giftIds.length > 0
      ? await GroupGift.find({ _id: { $in: giftIds }, active: true })
          .select('organizer contributors.user')
          .lean()
      : [];
  const itemById = new Map(items.map((i) => [String(i._id), i]));
  const giftById = new Map(gifts.map((g) => [String(g._id), g]));

  const settles = (gifter: string, item: (typeof items)[number]): boolean => {
    // Received by the owner: theirs to mark as given (after only).
    if (item.status === 'completed') return phase === 'gift_nudge';
    if (!item.groupGift) return String(item.bookedBy) === gifter;
    const gift = giftById.get(String(item.groupGift));
    if (!gift) return false;
    return phase === 'gift_nudge'
      ? String(gift.organizer) === gifter
      : gift.contributors.some((c) => String(c.user) === gifter);
  };

  for (const r of reservations) {
    const gifter = String(r.gifter);
    const list = listById.get(String(r.wishlist));
    if (!list || list.archived || isWishlistOwner(list, gifter)) continue;
    const key = holderKey(r.wishlist, gifter);
    if (!member.has(key)) continue;
    const item = itemById.get(String(r.item));
    if (!item || String(item.wishlist) !== String(r.wishlist)) continue;
    if (!settles(gifter, item)) continue;
    const since = held.get(key);
    if (!since || r.createdAt < since) held.set(key, r.createdAt);
  }
  return held;
}

/** Of `users` (everyone if left out), those who hold something on `list` for `phase` now (`giftHolders`). */
async function holdersAmong(
  phase: GiftReminderPhase,
  list: Pick<GiftDueList, '_id' | 'occasionDate'>,
  users?: Id[]
): Promise<mongoose.Types.ObjectId[]> {
  const held = await giftHolders(
    { wishlist: list._id, ...(users ? { gifter: { $in: users } } : {}) },
    phase
  );
  return Array.from(held)
    .filter(([, since]) => countsFor(phase, list.occasionDate, since))
    .map(([key]) => new mongoose.Types.ObjectId(key.split(':')[1]));
}

/**
 * Who on a due list still needs `phase` on `channel`: its members who get it
 * there (read first, so a list where nobody wants the email, as by default,
 * costs no holding lookup), who hold something for it, and who haven't had it
 * (a row in app, a claim by email).
 */
async function pendingRecipients(
  phase: GiftReminderPhase,
  list: GiftDueList,
  channel: 'inApp' | 'email'
): Promise<mongoose.Types.ObjectId[]> {
  const members = await WishlistMember.find({ wishlist: list._id }).select('user').lean();
  if (members.length === 0) return [];
  const wanting = await User.find({
    _id: { $in: members.map((m) => m.user) },
    ...notificationOptInFilter(phase, channel),
  })
    .select('_id')
    .lean();
  if (wanting.length === 0) return [];
  const holders = await holdersAmong(
    phase,
    list,
    wanting.map((u) => u._id)
  );
  if (holders.length === 0) return [];
  const had =
    channel === 'inApp'
      ? await Notification.find({
          type: phase,
          wishlist: list._id,
          occasionDate: list.occasionDate,
          user: { $in: holders },
        })
          .select('user')
          .lean()
      : await NotificationEmailClaim.find({
          kind: phase,
          wishlist: list._id,
          key: list.occasionDate,
          user: { $in: holders },
        })
          .select('user')
          .lean();
  const done = new Set(had.map((n) => String(n.user)));
  return holders
    .filter((id) => !done.has(String(id)))
    .sort((a, b) => String(a).localeCompare(String(b)));
}

/** Whether a list, read again now, is still due: there, unarchived, its occasion still on that day. */
async function readStillDue(list: Pick<GiftDueList, '_id' | 'occasionDate'>) {
  const now = await Wishlist.findById(list._id).select('name slug archived occasion').lean();
  return now && !now.archived && occursOn(now.occasion, list.occasionDate) ? now : null;
}

/**
 * Write `phase`'s row for each of `users` about one occurrence of a list's
 * occasion, and return how many new ones stand. Each is an upsert on the
 * phase's unique key (`user`, `wishlist`, `occasionDate`), so one already
 * there is left as it is and a concurrent run's duplicate is refused: nobody
 * gets the same one twice. The rows just written are then re-checked and taken
 * back unless they still hold: the list gone, archived or its occasion moved
 * (all of them), or a recipient who no longer holds anything there as a plain
 * member, or turned it off (theirs). Never an earlier run's row.
 *
 * Best-effort: a failure is logged by its kind only and counts as nothing sent.
 */
export async function createGiftReminders(
  phase: GiftReminderPhase,
  list: Pick<GiftDueList, '_id' | 'name' | 'slug' | 'occasion' | 'occasionDate'>,
  users: mongoose.Types.ObjectId[]
): Promise<number> {
  if (users.length === 0) return 0;
  let written: mongoose.Types.ObjectId[];
  try {
    const result = await Notification.bulkWrite(
      users.map((user) => ({
        updateOne: {
          filter: { user, wishlist: list._id, type: phase, occasionDate: list.occasionDate },
          update: {
            $setOnInsert: {
              actorUsername: null,
              count: 1,
              wishlistName: list.name,
              wishlistSlug: list.slug ?? null,
              itemName: null,
              occasionKind: list.occasion.kind,
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
    const upserted = onlyDuplicateKeyErrors(err);
    if (!upserted) {
      console.error('Failed to write gift reminders:', errorKind(err));
      return 0;
    }
    written = upserted;
  }
  if (written.length === 0) return 0;
  return written.length - (await dropStaleGiftReminders(phase, list, written));
}

/** The re-check after `createGiftReminders`' write: deletes those of `ids` that no longer hold. */
async function dropStaleGiftReminders(
  phase: GiftReminderPhase,
  list: Pick<GiftDueList, '_id' | 'occasionDate'>,
  ids: mongoose.Types.ObjectId[]
): Promise<number> {
  try {
    if (!(await readStillDue(list))) {
      const { deletedCount } = await Notification.deleteMany({ _id: { $in: ids } });
      return deletedCount;
    }
    const rows = await Notification.find({ _id: { $in: ids } })
      .select('user')
      .lean();
    const recipients = rows.map((r) => r.user);
    const holders = await holdersAmong(phase, list, recipients);
    const wanting = await User.find({
      _id: { $in: holders },
      ...notificationOptInFilter(phase, 'inApp'),
    })
      .select('_id')
      .lean();
    const keep = new Set(wanting.map((u) => String(u._id)));
    const stale = rows.filter((r) => !keep.has(String(r.user))).map((r) => r._id);
    if (stale.length === 0) return 0;
    const { deletedCount } = await Notification.deleteMany({ _id: { $in: stale } });
    return deletedCount;
  } catch (err) {
    // Unchecked rows are taken back: a reminder must never reach someone it
    // shouldn't, and the next run (within the catch-up) writes it again.
    console.error('Failed to re-check new gift reminders:', errorKind(err));
    try {
      const { deletedCount } = await Notification.deleteMany({ _id: { $in: ids } });
      return deletedCount;
    } catch {
      return 0;
    }
  }
}

/**
 * Email `phase`'s reminder to each of `users` on a due list, and return how
 * many went out. Each is claimed first (once per person, list and occurrence,
 * under the claim's unique index), then the list and the person are read
 * again: a list archived, deleted or moved, or a person who no longer holds
 * anything there as a plain member or turned the email off, gives the claim
 * back and gets nothing.
 */
async function sendGiftReminderEmails(
  phase: GiftReminderPhase,
  list: GiftDueList,
  users: mongoose.Types.ObjectId[]
): Promise<number> {
  let emailed = 0;
  for (const user of users) {
    const claim = await claimOccurrenceEmail(phase, user, list._id, list.occasionDate);
    if (!claim) continue;
    try {
      const now = await readStillDue(list);
      const holds = now ? (await holdersAmong(phase, list, [user])).length > 0 : false;
      const recipient = holds
        ? await User.findOne({ _id: user, ...notificationOptInFilter(phase, 'email') })
            .select('email')
            .lean()
        : null;
      if (!now?.occasion || !recipient?.email) {
        await claim.release();
        continue;
      }
      const sent = await sendOne(
        recipient.email,
        {
          recipientId: String(user),
          type: phase,
          wishlistId: String(list._id),
          wishlistName: now.name,
          wishlistSlug: now.slug ?? null,
          occasionKind: now.occasion.kind,
          occasionDate: list.occasionDate,
        },
        async () => claim
      );
      if (sent) emailed += 1;
    } catch (err) {
      console.error('Failed to send a gift reminder email:', errorKind(err));
      await claim.release();
    }
  }
  return emailed;
}

export interface GiftReminderPhaseRun {
  /** Lists that had someone to remind. */
  lists: number;
  /** New rows written (and still standing after their re-check). */
  sent: number;
  /** The run stopped at the cap with rows left to write. */
  capped: boolean;
}

export interface GiftReminderRun {
  reminders: GiftReminderPhaseRun;
  nudges: GiftReminderPhaseRun;
  /** Emails sent, both phases. */
  emailed: number;
}

async function writePhase(
  phase: GiftReminderPhase,
  due: GiftDueList[],
  maxPerRun: number
): Promise<GiftReminderPhaseRun> {
  const run: GiftReminderPhaseRun = { lists: 0, sent: 0, capped: false };
  for (const list of due) {
    const room = maxPerRun - run.sent;
    if (room <= 0) {
      run.capped = true;
      break;
    }
    const pending = await pendingRecipients(phase, list, 'inApp');
    if (pending.length === 0) continue;
    if (pending.length > room) run.capped = true;
    run.lists += 1;
    run.sent += await createGiftReminders(phase, list, pending.slice(0, room));
    if (run.capped) break;
  }
  return run;
}

/** One daily run: both phases' rows, each up to its cap, then their emails (see the top of this file). */
export async function sendGiftReminders(
  now: Date = new Date(),
  maxPerRun: number = GIFT_REMINDER_MAX_PER_RUN,
  maxEmailsPerRun: number = GIFT_EMAIL_MAX_PER_RUN
): Promise<GiftReminderRun> {
  const today = utcDateString(now);
  const [before, after] = await Promise.all(
    GIFT_REMINDER_NOTIFICATION_TYPES.map((phase) => listsDueForGiftReminder(today, phase))
  );
  const run: GiftReminderRun = {
    reminders: await writePhase('gift_reminder', before, maxPerRun),
    nudges: await writePhase('gift_nudge', after, maxPerRun),
    emailed: 0,
  };
  for (const [phase, due] of [
    ['gift_reminder', before],
    ['gift_nudge', after],
  ] as const) {
    for (const list of due) {
      const room = maxEmailsPerRun - run.emailed;
      if (room <= 0) return run;
      const pending = await pendingRecipients(phase, list, 'email');
      if (pending.length === 0) continue;
      run.emailed += await sendGiftReminderEmails(phase, list, pending.slice(0, room));
    }
  }
  return run;
}

/**
 * The reader's gift reminder rows they mustn't see now, by id: each checked
 * by its own phase and occurrence (`giftHolders`, `countsFor`), so a row shows
 * only while they hold, as a plain member, what it reminds them of (made an
 * owner, left or taken off, the list archived or gone, everything given or
 * released all hide it; a nudge about an occurrence isn't revived by a
 * reservation made after it). Hidden from the feed and its unread count
 * alike, and left in place. A reader with no gift reminder row costs one read.
 */
export async function hiddenGiftReminderRows(userId: string): Promise<mongoose.Types.ObjectId[]> {
  const mine = { user: userId, type: { $in: GIFT_REMINDER_NOTIFICATION_TYPES } };
  // Most readers have none: one existence check on `{ user, type }`, then the rows.
  if (!(await Notification.exists(mine))) return [];
  const rows = await Notification.find(mine).select('type wishlist occasionDate').lean();
  if (rows.length === 0) return [];
  const gifter = new mongoose.Types.ObjectId(userId);
  const held = new Map<GiftReminderPhase, Map<string, Date>>();
  for (const phase of GIFT_REMINDER_NOTIFICATION_TYPES) {
    const lists = rows.filter((r) => r.type === phase && r.wishlist).map((r) => r.wishlist);
    held.set(
      phase,
      lists.length > 0 ? await giftHolders({ gifter, wishlist: { $in: lists } }, phase) : new Map()
    );
  }
  return rows
    .filter((r) => {
      const phase = r.type as GiftReminderPhase;
      const since = r.wishlist ? held.get(phase)?.get(holderKey(r.wishlist, userId)) : undefined;
      return !since || !r.occasionDate || !countsFor(phase, r.occasionDate, since);
    })
    .map((r) => r._id);
}
