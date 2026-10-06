/**
 * A person's birthday on their profile (WIS-323): `User.birthday`, a day and a
 * month with no year, and who may see it, `User.privacy.birthdayVisibility`.
 *
 * It's the person's own, and fully independent of any list: it never fills in,
 * moves or suggests a list's occasion, and a list's Birthday occasion never
 * fills it in.
 *
 * Stored like a yearly occasion's date: `YYYY-MM-DD` with
 * `YEARLY_PLACEHOLDER_YEAR` in place of any year (`normalizeOccasionDate`), so
 * a birth year never reaches the database, and Feb 29 is a birthday like any
 * other. Nothing ever shows the stored year.
 *
 * **Who sees it is decided here and nowhere else.** The audience is the
 * narrower of `birthdayVisibility` (default `friends`) and `profileVisibility`
 * (a friends-only profile caps it at friends); the person always sees their
 * own. Every answer that carries someone's birthday goes through
 * `visibleBirthday` (one person) or `birthdayVisibleFilter` (its query form,
 * for the batch reads to come: Coming up, reminders), and leaves the field out for anyone excluded, exactly as
 * for someone with no birthday, so a hidden birthday can't be told from none.
 */
import { YEARLY_PLACEHOLDER_YEAR, normalizeOccasionDate } from '@/lib/utils/occasion';

export const BIRTHDAY_VISIBILITIES = ['nobody', 'friends', 'everyone'] as const;
export type BirthdayVisibility = (typeof BIRTHDAY_VISIBILITIES)[number];

/** What `birthdayVisibility` reads as when it was never saved (the model's default too). */
export const DEFAULT_BIRTHDAY_VISIBILITY: BirthdayVisibility = 'friends';

/**
 * Who is asking, as the person whose birthday it is sees them: themselves, a
 * friend (mutual follow), or anyone else (signed in or not).
 */
export type BirthdayViewer = 'self' | 'friend' | 'other';

/** The privacy settings the audience depends on, as stored (either may be missing). */
export interface BirthdayPrivacy {
  birthdayVisibility?: BirthdayVisibility | null;
  profileVisibility?: 'everyone' | 'friends' | null;
}

/**
 * Who besides the person can see their birthday: the narrower of their
 * birthday setting and their profile's visibility. `everyone` means everyone
 * who can see the profile, so a friends-only profile reads it as `friends`.
 */
export function birthdayAudience(privacy: BirthdayPrivacy | null | undefined): BirthdayVisibility {
  const setting = privacy?.birthdayVisibility ?? DEFAULT_BIRTHDAY_VISIBILITY;
  if (setting === 'everyone' && privacy?.profileVisibility === 'friends') return 'friends';
  return setting;
}

/** Whether `viewer` may see the birthday of someone with these settings (if they have one). */
export function canSeeBirthday(
  privacy: BirthdayPrivacy | null | undefined,
  viewer: BirthdayViewer
): boolean {
  if (viewer === 'self') return true;
  const audience = birthdayAudience(privacy);
  if (audience === 'everyone') return true;
  if (audience === 'friends') return viewer === 'friend';
  return false;
}

/**
 * The birthday to put in an answer for `viewer`, or `undefined`: none set, or
 * one they may not see, alike. Spread it in as `{ birthday }` only when defined
 * (`birthdayField`), so the answer has no `birthday` key either way.
 */
export function visibleBirthday(
  person: { birthday?: string | null; privacy?: BirthdayPrivacy | null },
  viewer: BirthdayViewer
): string | undefined {
  if (!person.birthday || !canSeeBirthday(person.privacy, viewer)) return undefined;
  return person.birthday;
}

/** `{ birthday }` for an answer when `viewer` may see it, else `{}`: never a `null`. */
export function birthdayField(
  person: { birthday?: string | null; privacy?: BirthdayPrivacy | null },
  viewer: BirthdayViewer
): { birthday?: string } {
  const birthday = visibleBirthday(person, viewer);
  return birthday ? { birthday } : {};
}

/**
 * The query form of `canSeeBirthday`, for a read of many people's birthdays
 * (Coming up, reminders): matches the users with a birthday that a viewer who
 * is their `friend`, or `other`, may see. Pinned to `canSeeBirthday` by a
 * table test (`test/api/birthday.test.ts`): change both together.
 * A setting never saved matches as its default does (`birthdayVisibility`
 * friends, `profileVisibility` everyone). The caller still narrows it to the
 * people it's about (the viewer's friends, say), and selects only what it shows.
 */
export function birthdayVisibleFilter(
  viewer: Exclude<BirthdayViewer, 'self'>
): Record<string, unknown> {
  const hasBirthday = { birthday: { $type: 'string', $ne: '' } };
  if (viewer === 'friend') {
    return { ...hasBirthday, 'privacy.birthdayVisibility': { $ne: 'nobody' } };
  }
  return {
    ...hasBirthday,
    'privacy.birthdayVisibility': 'everyone',
    'privacy.profileVisibility': { $ne: 'friends' },
  };
}

/** A birthday as it's stored, from any `YYYY-MM-DD` (its year dropped), or `null` if it isn't a real day. */
export function normalizeBirthday(date: string): string | null {
  return normalizeOccasionDate(date, 'yearly');
}

/** The month and day of a stored (or half-picked) birthday, each `''` when not there. */
export function birthdayParts(value: string | null | undefined): { month: string; day: string } {
  const match = /^\d{4}-(\d{2}|)-(\d{2}|)$/.exec(value ?? '');
  return match ? { month: match[1], day: match[2] } : { month: '', day: '' };
}

/**
 * The settings form's birthday from a picked month and day: `''` when neither
 * is picked, else `YYYY-MM-DD` on `YEARLY_PLACEHOLDER_YEAR` with a part not yet
 * picked left empty (`2000--14`), which `isCompleteBirthday` holds back.
 */
export function birthdayFromParts(month: string, day: string): string {
  if (!month && !day) return '';
  return `${YEARLY_PLACEHOLDER_YEAR}-${month}-${day}`;
}

/** Whether a form's birthday can be saved as it is: none, or a real day and month. */
export function isCompleteBirthday(value: string): boolean {
  return value === '' || normalizeBirthday(value) === value;
}

/**
 * A birthday for people: "March 14" (in `locale`, default the viewer's), never
 * a year. An unparseable value gives `''`.
 */
export function formatBirthday(value: string, locale?: string): string {
  const normalized = normalizeBirthday(value);
  if (!normalized) return '';
  const { month, day } = birthdayParts(normalized);
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(YEARLY_PLACEHOLDER_YEAR, Number(month) - 1, Number(day)));
}

/** Who sees your birthday, as your own profile says it beside the date. */
export const BIRTHDAY_AUDIENCE_TEXT: Record<BirthdayVisibility, string> = {
  nobody: 'Only you can see it',
  friends: 'Your friends can see it',
  everyone: 'Everyone who can see your profile can see it',
};
