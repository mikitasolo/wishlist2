import type { InvitePolicy, ProfileVisibility } from '@/models/User';

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
 * no bio is `''`, no photo is `null`, and the privacy settings sit alongside
 * the rest, so each one is compared and sent on its own.
 */
export interface ProfileSettings {
  username: string;
  image: string | null;
  bio: string;
  defaultCurrency: string;
  searchable: boolean;
  whoCanInvite: InvitePolicy;
  profileVisibility: ProfileVisibility;
}

type PrivacySettings = Pick<ProfileSettings, 'searchable' | 'whoCanInvite' | 'profileVisibility'>;

/** What a save sends: only the settings changed, and of `privacy` only the ones changed. */
export interface ProfileChanges {
  username?: string;
  /** `''` clears the photo. */
  image?: string;
  bio?: string;
  defaultCurrency?: string;
  privacy?: Partial<PrivacySettings>;
}

/** The fields of a profile (as `/api/users/me` returns it) that its settings come from. */
export interface ProfileSettingsSource {
  username?: string | null;
  image?: string | null;
  bio?: string | null;
  defaultCurrency?: string | null;
  privacy?: {
    searchable?: boolean | null;
    whoCanInvite?: InvitePolicy | null;
    profileVisibility?: ProfileVisibility | null;
  } | null;
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
    defaultCurrency: (profile.defaultCurrency || 'USD').toUpperCase(),
    searchable: profile.privacy?.searchable ?? true,
    whoCanInvite: profile.privacy?.whoCanInvite ?? 'everyone',
    profileVisibility: profile.privacy?.profileVisibility ?? 'everyone',
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
  defaultCurrency: (v) => v.toUpperCase(),
  searchable: (v) => v,
  whoCanInvite: (v) => v,
  profileVisibility: (v) => v,
};

const FIELDS = Object.keys(asStored) as (keyof ProfileSettings)[];
const PRIVACY_FIELDS = ['searchable', 'whoCanInvite', 'profileVisibility'] as const;

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
  if (!sameField('defaultCurrency', form, saved)) changes.defaultCurrency = form.defaultCurrency;

  const privacy: Partial<PrivacySettings> = {};
  for (const field of PRIVACY_FIELDS) {
    if (!sameField(field, form, saved)) copyField(privacy, form, field);
  }
  if (Object.keys(privacy).length > 0) changes.privacy = privacy;

  return changes;
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
