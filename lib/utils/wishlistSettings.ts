import { getVisibility, type Visibility } from '@/lib/utils/visibility';
import {
  occasionChange,
  occasionToDraft,
  type Occasion,
  type OccasionDraft,
} from '@/lib/utils/occasion';

/**
 * The owner's settings form on the wishlist page, and what a save of it sends.
 *
 * Several owners can edit one list's settings at once, and the form is filled
 * when the page loads, so by the time it's saved a co-owner may have changed
 * the list. A save therefore sends only the settings the owner changed from the
 * list as the form was filled from it (`settingsChanges`): one they didn't touch
 * stays out of the write, so it can't undo a co-owner's change made meanwhile
 * (making the list private, say). The occasion works the same way
 * (`occasionChange`). Whenever the list is read again (a reload, a save's
 * answer), the form takes in what it has now, except what the owner is still
 * editing (`rebaseSettingsForm`), so the next save diffs against that.
 */

/**
 * A list's settings as the server has them, the way the form edits them: no
 * description or banner is `''`, and the currency is its uppercase code.
 */
export interface WishlistSettings {
  name: string;
  slug: string;
  description: string;
  visibility: Visibility;
  bannerUrl: string;
  currency: string;
  occasion: Occasion | null;
}

/** The form itself: the same settings, its occasion possibly half filled in. */
export interface WishlistSettingsForm extends Omit<WishlistSettings, 'occasion'> {
  occasion: OccasionDraft;
}

/** What a save sends: only the settings the owner changed. */
export type WishlistSettingsChanges = Partial<WishlistSettings>;

/** The fields of a list (as the API returns it) that its settings come from. */
export interface WishlistSettingsSource {
  name: string;
  slug?: string | null;
  description?: string | null;
  visibility?: Visibility | null;
  bannerUrl?: string | null;
  currency?: string | null;
  occasion?: Occasion | null;
}

const DEFAULT_CURRENCY = 'USD';

/** A list's settings, from the list as the API returned it. */
export function wishlistSettings(wishlist: WishlistSettingsSource): WishlistSettings {
  return {
    name: wishlist.name,
    slug: wishlist.slug || '',
    description: wishlist.description || '',
    visibility: getVisibility(wishlist),
    bannerUrl: wishlist.bannerUrl || '',
    currency: (wishlist.currency || DEFAULT_CURRENCY).toUpperCase(),
    occasion: wishlist.occasion ?? null,
  };
}

/** The form filled in from a list's settings. */
export function settingsFormFor(settings: WishlistSettings): WishlistSettingsForm {
  return { ...settings, occasion: occasionToDraft(settings.occasion) };
}

// Each text field the way the server stores it (`updateWishlistSchema` in
// lib/validations.ts, then the model), so a value it would store as what's
// already there (a trailing space, a different case) isn't a change. Keep these
// in step with the schema.
const normalize = {
  name: (v: string) => v.trim(),
  slug: (v: string) => v.trim().toLowerCase(),
  description: (v: string) => v.trim(),
  bannerUrl: (v: string) => v,
  currency: (v: string) => v.trim().toUpperCase(),
} satisfies Record<
  Exclude<keyof WishlistSettings, 'visibility' | 'occasion'>,
  (v: string) => string
>;

const TEXT_FIELDS = Object.keys(normalize) as (keyof typeof normalize)[];

/**
 * The settings the form changed from `saved`, the list as the form was filled
 * from it. A field that's unchanged is left out, so the write doesn't touch it.
 * A changed one goes as typed: the server trims and validates it. Empty (`{}`)
 * when nothing changed, which the API would refuse, so the caller sends nothing.
 */
export function settingsChanges(
  form: WishlistSettingsForm,
  saved: WishlistSettings
): WishlistSettingsChanges {
  const changes: WishlistSettingsChanges = {};
  for (const field of TEXT_FIELDS) {
    const clean = normalize[field];
    if (clean(form[field]) !== clean(saved[field])) changes[field] = form[field];
  }
  if (form.visibility !== saved.visibility) changes.visibility = form.visibility;
  const occasion = occasionChange(form.occasion, saved.occasion);
  if (occasion !== undefined) changes.occasion = occasion;
  return changes;
}

/** Whether two of the form's values are the same: a string, or a draft field by field. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((key) => x[key] === y[key]);
}

function copyField<K extends keyof WishlistSettingsForm>(
  to: WishlistSettingsForm,
  from: WishlistSettingsForm,
  key: K
) {
  to[key] = from[key];
}

/**
 * The form refilled from `saved`, the list as the server now has it, keeping
 * whatever the owner has edited since `base`. A field of `form` still as it is
 * in `base` takes the list's value: a co-owner's change, or the owner's own as
 * it was stored. One that isn't keeps the owner's edit. Either way the next
 * save diffs against what the list has now, not what the form first loaded.
 *
 * - On a reload of the list, `base` is the form as filled from the settings it
 *   was last filled from, so unsaved edits stay and every other field updates.
 * - When a save lands, `base` is the form it was sent from, so what was sent
 *   takes the stored value, and an edit made while the save was in flight (a
 *   banner upload that finished meanwhile) stays.
 */
export function rebaseSettingsForm(
  form: WishlistSettingsForm,
  base: WishlistSettingsForm,
  saved: WishlistSettings
): WishlistSettingsForm {
  const next = settingsFormFor(saved);
  for (const key of Object.keys(next) as (keyof WishlistSettingsForm)[]) {
    if (!sameValue(form[key], base[key])) copyField(next, form, key);
  }
  return next;
}
