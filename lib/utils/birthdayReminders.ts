import mongoose from 'mongoose';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import Notification from '@/models/Notification';
import NotificationEmailClaim from '@/models/NotificationEmailClaim';
import { onlyDuplicateKeyErrors } from '@/lib/notifications';
import { birthdayClaimKey, claimBirthdayReminderEmail, sendOne } from '@/lib/notificationEmails';
import { birthdayVisibleFilter, canSeeBirthday, type BirthdayPrivacy } from '@/lib/utils/birthday';
import { areFriends, getFriendIds } from '@/lib/utils/friends';
import { notificationOptInFilter, type NotificationChannel } from '@/lib/utils/notificationPrefs';
import { reminderDayOffsets, storedDatesFor } from '@/lib/utils/occasionReminders';
import { errorKind } from '@/lib/utils/errorKind';
import {
  addDays,
  daysBetween,
  nextOccurrence,
  utcDateString,
  YEARLY_PLACEHOLDER_YEAR,
} from '@/lib/utils/occasion';

/**
 * Friends' birthday reminders (WIS-345): a week before someone's birthday (the
 * one on their profile, `User.birthday`), each of their friends who may see it
 * gets one `birthday_reminder` in Activity, "@anna’s birthday is on March 14",
 * linking to her profile. The daily cron (`GET /api/cron/birthdays`)
 * runs `sendBirthdayReminders`.
 *
 * This is the one reminder that goes beyond a list's members: it's about a
 * person, not a list, and says nothing about any list, item or booking, nor
 * who else was reminded.
 *
 * - **Who**: the person's friends (mutual follows) as they are when it runs,
 *   and only while `canSeeBirthday(privacy, 'friend')` admits them (the query
 *   form, `birthdayVisibleFilter('friend')`, picks the people). Not anyone who
 *   turned it off (`notificationPrefs.birthday_reminder.inApp`, on by
 *   default). **Not a friend who is a member of any of the person's
 *   unarchived Birthday lists due for its own occasion reminder in the same
 *   window** and whose occasion reminders are on for that channel
 *   (`coveredByBirthdayLists`): that list's `occasion_reminder` already tells
 *   them, so each friend hears about one birthday once.
 * - **When**: the occasion reminders' lead and catch-up (`reminderDayOffsets`),
 *   counted from the UTC date; the row names the day itself.
 * - **Once**: per friend, person and occurrence, by a unique partial index
 *   (`user`, `actor`, `occasionDate`), written as upserts.
 * - **Re-checked after the write**: the rows just written are taken back
 *   unless they still hold (birthday cleared, moved or hidden from friends →
 *   all; unfriended, now covered by a Birthday list, opted out → theirs). An
 *   earlier run's row is never deleted.
 * - **Capped**: `BIRTHDAY_REMINDER_MAX_PER_RUN` new rows a run, nearest first.
 * - **Email**: its own setting (`birthday_reminder.email`, off by default),
 *   once per friend, person and occurrence through a claim taken first, then
 *   everything re-checked; capped at `BIRTHDAY_EMAIL_MAX_PER_RUN` a run.
 */

export const BIRTHDAY_REMINDER_MAX_PER_RUN = 500;
export const BIRTHDAY_EMAIL_MAX_PER_RUN = 50;

type Id = mongoose.Types.ObjectId;

interface DueBirthday {
  _id: Id;
  username: string;
  /** The birthday's next occurrence, a real `YYYY-MM-DD`. */
  occasionDate: string;
  /** Days from today until then. */
  days: number;
}

/** The stored birthdays (all on the placeholder year) whose next one is due a reminder from `today`. */
function storedBirthdaysDue(today: string): string[] {
  const placeholder = `${YEARLY_PLACEHOLDER_YEAR}-`;
  const stored = reminderDayOffsets()
    .flatMap((d) => storedDatesFor(addDays(today, d) ?? ''))
    .filter((date) => date.startsWith(placeholder));
  return Array.from(new Set(stored));
}

/** Whether a stored birthday's next occurrence, counted from `occasionDate` itself, is that day. */
function fallsOn(birthday: string | null | undefined, occasionDate: string): boolean {
  return !!birthday && nextOccurrence(birthday, 'yearly', occasionDate) === occasionDate;
}

/**
 * The people with a birthday their friends may see, whose next one falls
 * within the reminder window from `today`, nearest first. Someone with no
 * username has no way to be named, so is left out.
 */
export async function birthdaysDueForReminder(today: string): Promise<DueBirthday[]> {
  const offsets = reminderDayOffsets();
  const people = await User.find({
    $and: [
      birthdayVisibleFilter('friend'),
      { birthday: { $in: storedBirthdaysDue(today) } },
      { username: { $type: 'string', $ne: '' } },
    ],
  })
    .select('username birthday privacy')
    .lean();

  const due: DueBirthday[] = [];
  for (const person of people) {
    // The helper's own answer too: the filter is its query form.
    if (!person.username || !canSeeBirthday(person.privacy as BirthdayPrivacy, 'friend')) continue;
    const next = nextOccurrence(person.birthday ?? '', 'yearly', today);
    const days = next === null ? null : daysBetween(today, next);
    if (next === null || days === null || !offsets.includes(days)) continue;
    due.push({ _id: person._id, username: person.username, occasionDate: next, days });
  }
  return due.sort((a, b) => a.days - b.days || String(a._id).localeCompare(String(b._id)));
}

/**
 * The members of the person's unarchived Birthday lists (lists they own, of
 * occasion kind `birthday`) whose next occurrence falls within the reminder
 * window from `today`: each of those lists' `occasion_reminder` covers them.
 * An archived list, or one outside the window, covers nobody.
 */
export async function coveredByBirthdayLists(
  personId: Id,
  today: string,
  channel: NotificationChannel
): Promise<Set<string>> {
  const offsets = reminderDayOffsets();
  const stored = offsets.flatMap((d) => storedDatesFor(addDays(today, d) ?? ''));
  const lists = await Wishlist.find({
    owners: personId,
    archived: { $ne: true },
    'occasion.kind': 'birthday',
    'occasion.date': { $in: stored },
  })
    .select('occasion')
    .lean();
  const due = lists
    .filter((list) => {
      const occasion = list.occasion;
      if (!occasion) return false;
      const next = nextOccurrence(occasion.date, occasion.recurrence ?? null, today);
      const days = next === null ? null : daysBetween(today, next);
      return days !== null && offsets.includes(days);
    })
    .map((list) => list._id);
  if (due.length === 0) return new Set();
  const members = await WishlistMember.find({ wishlist: { $in: due } })
    .select('user')
    .lean();
  if (members.length === 0) return new Set();
  // Only those the list's reminder reaches on this channel: a member who
  // turned occasion reminders off there would otherwise hear nothing.
  const reached = await User.find({
    _id: { $in: members.map((m) => m.user) },
    ...notificationOptInFilter('occasion_reminder', channel),
  })
    .select('_id')
    .lean();
  return new Set(reached.map((u) => String(u._id)));
}

/** The person's friends who aren't covered on `channel` by one of their Birthday lists (see the top). */
async function audience(personId: Id, today: string, channel: NotificationChannel): Promise<Id[]> {
  const [friends, covered] = await Promise.all([
    getFriendIds(personId),
    coveredByBirthdayLists(personId, today, channel),
  ]);
  return friends.filter((id) => !covered.has(id)).map((id) => new mongoose.Types.ObjectId(id));
}

/** Who of the audience still needs this occurrence's in-app reminder. */
async function pendingRecipients(person: DueBirthday, today: string): Promise<Id[]> {
  const ids = await audience(person._id, today, 'inApp');
  if (ids.length === 0) return [];
  const [wanting, reminded] = await Promise.all([
    User.find({ _id: { $in: ids }, ...notificationOptInFilter('birthday_reminder', 'inApp') })
      .select('_id')
      .lean(),
    Notification.find({
      type: 'birthday_reminder',
      actor: person._id,
      occasionDate: person.occasionDate,
      user: { $in: ids },
    })
      .select('user')
      .lean(),
  ]);
  const done = new Set(reminded.map((n) => String(n.user)));
  return wanting
    .map((u) => u._id)
    .filter((id) => !done.has(String(id)))
    .sort((a, b) => String(a).localeCompare(String(b)));
}

interface BirthdayReminderArgs {
  person: { _id: Id; username: string };
  /** The occurrence it's about: the birthday's next one, a real `YYYY-MM-DD`. */
  occasionDate: string;
  users: Id[];
  /** The run's UTC date, which the Birthday-list window is counted from. */
  today: string;
}

/**
 * Write a birthday reminder for each of `users` about one occurrence of the
 * person's birthday, and return how many new ones stand. Each is an upsert on
 * the unique key (`user`, `actor`, `occasionDate`), so one already there is
 * left alone and a concurrent run's duplicate is refused by the index. Then
 * the rows just written are re-checked (`dropStaleBirthdayReminders`).
 *
 * The row names the person (by username, and by account in `actor`) and the
 * day: no list, no item, nothing about bookings.
 *
 * Best-effort: a failure is logged by its kind only and counts as nothing sent.
 */
export async function createBirthdayReminders({
  person,
  occasionDate,
  users,
  today,
}: BirthdayReminderArgs): Promise<number> {
  if (users.length === 0) return 0;
  let written: Id[];
  try {
    const result = await Notification.bulkWrite(
      users.map((user) => ({
        updateOne: {
          filter: {
            user,
            actor: person._id,
            type: 'birthday_reminder' as const,
            occasionDate,
          },
          update: {
            $setOnInsert: {
              actorUsername: person.username,
              count: 1,
              wishlist: null,
              wishlistName: null,
              wishlistSlug: null,
              itemName: null,
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
      console.error('Failed to write birthday reminders:', errorKind(err));
      return 0;
    }
    written = upserted;
  }
  if (written.length === 0) return 0;
  return (
    written.length - (await dropStaleBirthdayReminders(person._id, occasionDate, written, today))
  );
}

/**
 * Whether the person's birthday is still one their friends may see and still
 * falls on `occasionDate`; the person as read, or null.
 */
async function stillDuePerson(
  personId: Id,
  occasionDate: string
): Promise<{ username: string } | null> {
  const person = await User.findById(personId).select('username birthday privacy').lean();
  if (
    !person?.username ||
    !canSeeBirthday(person.privacy as BirthdayPrivacy, 'friend') ||
    !fallsOn(person.birthday, occasionDate)
  ) {
    return null;
  }
  return { username: person.username };
}

/**
 * The re-check after `createBirthdayReminders`' write: deletes those of `ids`
 * that no longer hold, and returns how many it deleted. Never an earlier run's.
 */
async function dropStaleBirthdayReminders(
  personId: Id,
  occasionDate: string,
  ids: Id[],
  today: string
): Promise<number> {
  try {
    if (!(await stillDuePerson(personId, occasionDate))) {
      const { deletedCount } = await Notification.deleteMany({ _id: { $in: ids } });
      return deletedCount;
    }
    const rows = await Notification.find({ _id: { $in: ids } })
      .select('user')
      .lean();
    const [allowed, wanting] = await Promise.all([
      audience(personId, today, 'inApp'),
      User.find({
        _id: { $in: rows.map((r) => r.user) },
        ...notificationOptInFilter('birthday_reminder', 'inApp'),
      })
        .select('_id')
        .lean(),
    ]);
    const allowedSet = new Set(allowed.map(String));
    const wantSet = new Set(wanting.map((u) => String(u._id)));
    const stale = rows
      .filter((r) => !allowedSet.has(String(r.user)) || !wantSet.has(String(r.user)))
      .map((r) => r._id);
    if (stale.length === 0) return 0;
    const { deletedCount } = await Notification.deleteMany({ _id: { $in: stale } });
    return deletedCount;
  } catch (err) {
    console.error('Failed to re-check new birthday reminders:', errorKind(err));
    return 0;
  }
}

/** Who of the audience still needs this occurrence's reminder email. */
async function pendingEmailRecipients(person: DueBirthday, today: string): Promise<Id[]> {
  const ids = await audience(person._id, today, 'email');
  if (ids.length === 0) return [];
  const [wanting, emailed] = await Promise.all([
    User.find({ _id: { $in: ids }, ...notificationOptInFilter('birthday_reminder', 'email') })
      .select('_id')
      .lean(),
    NotificationEmailClaim.find({
      kind: 'birthday_reminder',
      key: birthdayClaimKey(person._id, person.occasionDate),
      user: { $in: ids },
    })
      .select('user')
      .lean(),
  ]);
  const done = new Set(emailed.map((c) => String(c.user)));
  return wanting
    .map((u) => u._id)
    .filter((id) => !done.has(String(id)))
    .sort((a, b) => String(a).localeCompare(String(b)));
}

/**
 * Email each of `users` the reminder about `person`'s birthday, and return how
 * many went out. Each is claimed first (once per friend, person and
 * occurrence), then everything is read again: a birthday cleared, moved or
 * hidden since, a friendship ended, a Birthday list now covering them, or the
 * email turned off, gives the claim back and sends nothing.
 */
async function sendBirthdayEmails(
  person: DueBirthday,
  users: Id[],
  today: string,
  timeUp: () => boolean
): Promise<number> {
  let emailed = 0;
  for (const user of users) {
    if (timeUp()) break;
    const claim = await claimBirthdayReminderEmail(user, person._id, person.occasionDate);
    if (!claim) continue;
    const [now, friends, covered, recipient] = await Promise.all([
      stillDuePerson(person._id, person.occasionDate),
      areFriends(user, person._id),
      coveredByBirthdayLists(person._id, today, 'email'),
      User.findOne({ _id: user, ...notificationOptInFilter('birthday_reminder', 'email') })
        .select('email')
        .lean(),
    ]);
    if (!now || !friends || covered.has(String(user)) || !recipient?.email) {
      await claim.release();
      continue;
    }
    const sent = await sendOne(
      recipient.email,
      {
        recipientId: String(user),
        type: 'birthday_reminder',
        actorUsername: now.username,
        wishlistId: null,
        wishlistName: null,
        occasionDate: person.occasionDate,
      },
      async () => claim
    );
    if (sent) emailed += 1;
  }
  return emailed;
}

export interface BirthdayReminderRun {
  /** People whose friends had someone to remind. */
  people: number;
  /** New reminders written (and still standing after their re-check). */
  sent: number;
  /**
   * The run stopped at a cap, or ran out of its time budget, with reminders
   * (or emails) left to send: the next run, within the catch-up, sends them.
   */
  capped: boolean;
  /** Reminder emails sent. */
  emailed: number;
}

export interface BirthdayReminderLimits {
  maxPerRun?: number;
  maxEmailsPerRun?: number;
  /**
   * When (`Date.now()` ms) the run must stop starting new work, so it fits its
   * share of the birthday cron's time (`lib/utils/birthdayCron.ts`). What's
   * left carries over like anything a cap leaves.
   */
  deadline?: number;
}

/** One daily run: remind every due birthday's friends, up to the caps (see the top of this file). */
export async function sendBirthdayReminders(
  now: Date = new Date(),
  {
    maxPerRun = BIRTHDAY_REMINDER_MAX_PER_RUN,
    maxEmailsPerRun = BIRTHDAY_EMAIL_MAX_PER_RUN,
    deadline = Infinity,
  }: BirthdayReminderLimits = {}
): Promise<BirthdayReminderRun> {
  const today = utcDateString(now);
  const run: BirthdayReminderRun = { people: 0, sent: 0, capped: false, emailed: 0 };
  const timeUp = () => Date.now() >= deadline;
  const due = await birthdaysDueForReminder(today);
  for (const person of due) {
    if (timeUp()) {
      run.capped = true;
      break;
    }
    const pending = await pendingRecipients(person, today);
    if (pending.length === 0) continue;
    const room = maxPerRun - run.sent;
    if (room <= 0) {
      run.capped = true;
      break;
    }
    if (pending.length > room) run.capped = true;
    run.people += 1;
    run.sent += await createBirthdayReminders({
      person,
      occasionDate: person.occasionDate,
      users: pending.slice(0, room),
      today,
    });
    if (run.capped) break;
  }
  // Emails after every in-app row, with their own cap, nearest birthday first.
  for (const person of due) {
    const room = maxEmailsPerRun - run.emailed;
    if (room <= 0) break;
    if (timeUp()) {
      run.capped = true;
      break;
    }
    const pending = await pendingEmailRecipients(person, today);
    if (pending.length === 0) continue;
    run.emailed += await sendBirthdayEmails(person, pending.slice(0, room), today, timeUp);
  }
  if (timeUp()) run.capped = true;
  return run;
}

/** How many re-check passes the feed makes at most (see `dropHiddenBirthdayReminders`). */
const FEED_RECHECK_PASSES = 3;

/**
 * Takes out of `userId`'s feed the birthday reminders they may no longer see
 * (WIS-345): the person gone, their birthday cleared, moved or hidden from
 * friends, or the two no longer friends. A reminder carries the birthday's
 * day, so it follows `canSeeBirthday` for as long as it's shown, not only when
 * it was sent. Run before the feed is read (`GET /api/notifications`, also on
 * every badge poll), so its rows and unread count agree.
 *
 * Only the rows the feed can show or count are checked: the unread ones, and
 * those among the newest `feedLimit` of `visible` (the feed's own filter). A
 * deletion can bring an older row into the newest, so it looks again, up to
 * `FEED_RECHECK_PASSES` times. With no such rows it reads nothing else.
 *
 * Returns each checked, still-standing reminder's person's username as it is
 * now, by account, for the feed to name and link them by (a username can
 * change hands): a feed row with none there is left out. `null` when the
 * re-check failed: the feed then leaves every birthday reminder out, of its
 * rows and of its unread count alike.
 */
export async function dropHiddenBirthdayReminders(
  userId: string,
  visible: Record<string, unknown>,
  feedLimit: number
): Promise<Map<string, string> | null> {
  try {
    const names = new Map<string, string>();
    const checked = new Set<string>();
    let friendSet: Set<string> | null = null;
    for (let pass = 0; pass < FEED_RECHECK_PASSES; pass++) {
      // The oldest row the feed shows: every birthday reminder from then on.
      const [oldest] = await Notification.find(visible)
        .sort({ createdAt: -1 })
        .skip(feedLimit - 1)
        .limit(1)
        .select('createdAt')
        .lean();
      const rows = (
        await Notification.find({
          user: userId,
          type: 'birthday_reminder',
          ...(oldest && { $or: [{ read: false }, { createdAt: { $gte: oldest.createdAt } }] }),
        })
          .select('actor occasionDate')
          .lean()
      ).filter((r) => !checked.has(String(r._id)));
      if (rows.length === 0) break;
      for (const r of rows) checked.add(String(r._id));

      const actorIds = Array.from(new Set(rows.map((r) => String(r.actor ?? '')).filter(Boolean)));
      const friendsRead: Promise<string[] | null> = friendSet
        ? Promise.resolve(null)
        : getFriendIds(userId);
      const [people, friends] = await Promise.all([
        User.find({ _id: { $in: actorIds } })
          .select('username birthday privacy')
          .lean(),
        friendsRead,
      ]);
      if (friends) friendSet = new Set<string>(friends);
      const byId = new Map(people.map((p) => [String(p._id), p]));
      const stale = rows
        .filter((r) => {
          const person = r.actor ? byId.get(String(r.actor)) : undefined;
          const ok =
            !!person?.username &&
            !!friendSet?.has(String(person._id)) &&
            canSeeBirthday(person.privacy as BirthdayPrivacy, 'friend') &&
            !!r.occasionDate &&
            fallsOn(person.birthday, r.occasionDate);
          if (ok) names.set(String(person._id), person.username as string);
          return !ok;
        })
        .map((r) => r._id);
      if (stale.length === 0) break;
      await Notification.deleteMany({ _id: { $in: stale } });
    }
    return names;
  } catch (err) {
    console.error('Failed to re-check birthday reminders:', errorKind(err));
    return null;
  }
}
