import type { InvitePolicy, ProfileVisibility } from '@/models/User';
import { normalizeCurrency } from '@/lib/utils/currency';
import {
  DEFAULT_BIRTHDAY_VISIBILITY,
  normalizeBirthday,
  type BirthdayVisibility,
} from '@/lib/utils/birthday';
import {
  channelsOf,
  NOTIFICATION_EVENT_KEYS,
  wantsNotification,
  type NOTIFICATION_EVENTS,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationPrefs,
} from '@/lib/utils/notificationPrefs';

/**
 * One notification setting as a form field: `notify.<event>.<channel>`, for
 * each channel the event is offered on (`NOTIFICATION_EVENTS`), so each switch
 * is compared, saved and refilled on its own like any other setting.
 */
export type NotificationSettingKey = {
  [
    E in NotificationEvent
  ]: `notify.${E}.${keyof (typeof NOTIFICATION_EVENTS)[E]['defaults'] & string}`;
}[NotificationEvent];

export interface NotificationSetting {
  key: NotificationSettingKey;
  event: NotificationEvent;
  channel: NotificationChannel;
}

/** Every notification setting, event by event in the table's order. */
export const NOTIFICATION_SETTINGS: readonly NotificationSetting[] =
  NOTIFICATION_EVENT_KEYS.flatMap((event) =>
    channelsOf(event).map((channel) => ({
      key: `notify.${event}.${channel}` as NotificationSettingKey,
      event,
      channel,
    }))
  );

/** The setting a form field stands for, or undefined for any other field. */
export function notificationSettingOf(key: string): NotificationSetting | undefined {
  return NOTIFICATION_SETTINGS.find((s) => s.key === key);
}

/** The form field of `event` on `channel`, if it's offered there. */
export function notificationSettingKey(
  event: NotificationEvent,
  channel: NotificationChannel
): NotificationSettingKey | undefined {
  return NOTIFICATION_SETTINGS.find((s) => s.event === event && s.channel === channel)?.key;
}

/**
 * The account settings form (`app/settings/page.tsx`), and what a save of it
 * sends to `PATCH /api/users/me`.
 *
 * The form is filled when the page loads, and the same account can have it
 * open in two tabs or on two devices, so by the time one is saved the profile
 * may have changed. A save therefore sends only the settings changed from the
 * profile as the form was last filled from it (`profileChanges`), each privacy
 * setting on its own: one left alone stays out of the write, so it can't undo a
 * change saved elsewhere meanwhile (making the profile friends-only, say).
 * Whenever the profile is read again (a reload, a save's answer), the form
 * takes in what it has now, except what's still being edited
 * (`rebaseProfileForm`), so the next save diffs against that.
 */

/**
 * The profile's settings as the server has them, the way the form edits them:
 * no bio or birthday is `''`, no photo is `null`, and the privacy settings sit alongside
 * the rest, so each one is compared and sent on its own.
 */
export interface ProfileSettings extends Record<NotificationSettingKey, boolean> {
  username: string;
  image: string | null;
  bio: string;
  /**
   * `YYYY-MM-DD` on `YEARLY_PLACEHOLDER_YEAR`, or `''` for none. While it's
   * being picked it may lack its month or day (`birthdayFromParts`), which
   * `isCompleteBirthday` holds back from a save.
   */
  birthday: string;
  defaultCurrency: string;
  searchable: boolean;
  whoCanInvite: InvitePolicy;
  profileVisibility: ProfileVisibility;
  birthdayVisibility: BirthdayVisibility;
}

type PrivacySettings = Pick<
  ProfileSettings,
  'searchable' | 'whoCanInvite' | 'profileVisibility' | 'birthdayVisibility'
>;

/** What a save sends: only the settings changed, and of `privacy` only the ones changed. */
export interface ProfileChanges {
  username?: string;
  /** `''` clears the photo. */
  image?: string;
  bio?: string;
  /** `null` clears it. */
  birthday?: string | null;
  defaultCurrency?: string;
  privacy?: Partial<PrivacySettings>;
  /** Of the notification settings, only the ones changed, each by event and channel. */
  notificationPrefs?: NotificationPrefs;
}

/** The fields of a profile (as `/api/users/me` returns it) that its settings come from. */
export interface ProfileSettingsSource {
  username?: string | null;
  image?: string | null;
  bio?: string | null;
  birthday?: string | null;
  defaultCurrency?: string | null;
  privacy?: {
    searchable?: boolean | null;
    whoCanInvite?: InvitePolicy | null;
    profileVisibility?: ProfileVisibility | null;
    birthdayVisibility?: BirthdayVisibility | null;
  } | null;
  notificationPrefs?: NotificationPrefs | null;
}

/**
 * A profile's settings, from the profile as the API returned it. A missing
 * privacy setting reads as the model's default, as every reader of it does.
 */
export function profileSettings(profile: ProfileSettingsSource): ProfileSettings {
  return {
    username: profile.username || '',
    image: profile.image || null,
    bio: profile.bio || '',
    // As the server would store it, so one saved before normalization (or by
    // hand) with a real year still reads as complete.
    birthday: (profile.birthday && normalizeBirthday(profile.birthday)) || '',
    defaultCurrency: normalizeCurrency(profile.defaultCurrency),
    searchable: profile.privacy?.searchable ?? true,
    whoCanInvite: profile.privacy?.whoCanInvite ?? 'everyone',
    profileVisibility: profile.privacy?.profileVisibility ?? 'everyone',
    birthdayVisibility: profile.privacy?.birthdayVisibility ?? DEFAULT_BIRTHDAY_VISIBILITY,
    ...(Object.fromEntries(
      NOTIFICATION_SETTINGS.map((s) => [
        s.key,
        wantsNotification(profile.notificationPrefs, s.event, s.channel),
      ])
    ) as Record<NotificationSettingKey, boolean>),
  };
}

// Each field the way the server stores it (`updateProfileSchema` in
// lib/validations.ts, then the model), so a value it would store as what's
// already there (a different case, a trailing space) isn't a change, nor an
// edit for a refill to keep. Keep these in step with the schema.
const asStored: { [K in keyof ProfileSettings]: (value: ProfileSettings[K]) => unknown } = {
  username: (v) => v.toLowerCase(),
  // No photo is `null` or `''` alike (`isSameImage` on the server).
  image: (v) => v || null,
  bio: (v) => v.trim(),
  // No birthday is `null` on the server, `''` here.
  birthday: (v) => v || null,
  defaultCurrency: (v) => v.toUpperCase(),
  searchable: (v) => v,
  whoCanInvite: (v) => v,
  profileVisibility: (v) => v,
  birthdayVisibility: (v) => v,
  ...(Object.fromEntries(NOTIFICATION_SETTINGS.map((s) => [s.key, (v: boolean) => v])) as Record<
    NotificationSettingKey,
    (v: boolean) => boolean
  >),
};

const FIELDS = Object.keys(asStored) as (keyof ProfileSettings)[];
const PRIVACY_FIELDS = [
  'searchable',
  'whoCanInvite',
  'profileVisibility',
  'birthdayVisibility',
] as const;

/** Whether `a` and `b` hold what the server would store as the same `key`. */
function sameField<K extends keyof ProfileSettings>(
  key: K,
  a: ProfileSettings,
  b: ProfileSettings
): boolean {
  const stored = asStored[key];
  return stored(a[key]) === stored(b[key]);
}

function copyField<K extends keyof ProfileSettings>(
  to: Partial<ProfileSettings>,
  from: ProfileSettings,
  key: K
) {
  to[key] = from[key];
}

/**
 * The settings the form changed from `saved`, the profile as the form was last
 * filled from it. One that's unchanged is left out, so the write doesn't touch
 * it, and `privacy` carries only the privacy settings that changed (or is left
 * out). Compared the way the server stores them (`asStored`), and a changed
 * username goes lowercased and a bio trimmed, as the server would store them.
 * Empty (`{}`) when nothing changed.
 */
export function profileChanges(form: ProfileSettings, saved: ProfileSettings): ProfileChanges {
  const changes: ProfileChanges = {};
  if (!sameField('username', form, saved)) changes.username = form.username.toLowerCase();
  if (!sameField('image', form, saved)) changes.image = form.image || '';
  if (!sameField('bio', form, saved)) changes.bio = form.bio.trim();
  if (!sameField('birthday', form, saved)) changes.birthday = form.birthday || null;
  if (!sameField('defaultCurrency', form, saved)) changes.defaultCurrency = form.defaultCurrency;

  const privacy: Partial<PrivacySettings> = {};
  for (const field of PRIVACY_FIELDS) {
    if (!sameField(field, form, saved)) copyField(privacy, form, field);
  }
  if (Object.keys(privacy).length > 0) changes.privacy = privacy;

  let prefs: NotificationPrefs | undefined;
  for (const setting of NOTIFICATION_SETTINGS) {
    if (!sameField(setting.key, form, saved)) {
      prefs = withSetting(prefs ?? {}, setting, form[setting.key]);
    }
  }
  if (prefs) changes.notificationPrefs = prefs;

  return changes;
}

/**
 * What a save of the one setting `key`, set to `value`, sends: shaped and
 * stored-cased as `profileChanges` would send it (a privacy setting under
 * `privacy`), but sent whatever the profile was last read as. The settings
 * that save as they're changed use it: the control's change is the intent, and
 * a save answer that landed out of order could leave the profile last read
 * already showing `value`, which would otherwise send nothing.
 */
export function settingChange<K extends keyof ProfileSettings>(
  key: K,
  value: ProfileSettings[K]
): ProfileChanges {
  const settings = { [key]: value } as Partial<ProfileSettings>;
  switch (key) {
    case 'username':
      return { username: settings.username!.toLowerCase() };
    case 'image':
      return { image: settings.image || '' };
    case 'bio':
      return { bio: settings.bio!.trim() };
    case 'birthday':
      return { birthday: settings.birthday || null };
    case 'defaultCurrency':
      return { defaultCurrency: settings.defaultCurrency!.toUpperCase() };
    case 'searchable':
    case 'whoCanInvite':
    case 'profileVisibility':
    case 'birthdayVisibility':
      return { privacy: { [key]: value } as Partial<PrivacySettings> };
    default: {
      const setting = notificationSettingOf(key)!;
      return { notificationPrefs: withSetting({}, setting, value as boolean) };
    }
  }
}

/** `prefs` with `setting` set to `on`, by event and channel. */
function withSetting(
  prefs: NotificationPrefs,
  setting: NotificationSetting,
  on: boolean
): NotificationPrefs {
  return { ...prefs, [setting.event]: { ...prefs[setting.event], [setting.channel]: on } };
}

/**
 * The form refilled from `saved`, the profile as the server now has it, keeping
 * whatever has been edited since `base`. A field of `form` still as it is in
 * `base` (compared as `profileChanges` does, so an edit the server would store
 * as nothing isn't one) takes the profile's value: a change saved from another
 * tab, or this form's own as it was stored. One that isn't keeps the edit.
 * Either way the next save diffs against the profile as it is now, not as the
 * form first loaded it.
 *
 * - On a reload, `base` is the profile the form was last filled from, so
 *   unsaved edits stay and every other field updates.
 * - When a save lands, `base` is the form it was sent from, so what was sent
 *   takes the stored value, and an edit made while the save was in flight (a
 *   photo upload that finished meanwhile) stays.
 */
export function rebaseProfileForm(
  form: ProfileSettings,
  base: ProfileSettings,
  saved: ProfileSettings
): ProfileSettings {
  const next = { ...saved };
  for (const key of FIELDS) {
    if (!sameField(key, form, base)) copyField(next, form, key);
  }
  return next;
}
