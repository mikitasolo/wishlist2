'use client';

import { useCallback, useMemo, useState } from 'react';
import { useFreshUploads } from '@/lib/hooks/useFreshUploads';
import {
  rebaseSettingsForm,
  settingsChanges,
  settingsFormFor,
  wishlistSettings,
  type WishlistSettings,
  type WishlistSettingsForm,
} from '@/lib/utils/wishlistSettings';

/**
 * The owners' Settings form on the wishlist page (WIS-372), kept by the page
 * rather than the tab, as the form outlives the tab: the form, the list's
 * settings as it was last filled from them (`saved`), and the cover photos
 * uploaded in it that no save has taken.
 */
export function useSettingsForm() {
  // The settings form, and the list's settings as it was last filled from them
  // (`saved`). A save sends only what the form changed from `saved`
  // (`settingsChanges`), so it can't undo a setting a co-owner changed in the
  // meantime. Kept together, so a reload or a save's answer can refill the form
  // and move its baseline in one update (`refillSettings`).
  const [settings, setSettings] = useState<{
    form: WishlistSettingsForm;
    saved: WishlistSettings;
  }>(() => {
    const saved = wishlistSettings({ name: '', visibility: 'everyone' });
    return { form: settingsFormFor(saved), saved };
  });
  const { form, saved } = settings;
  // Onto the form as it is by then: a banner upload can finish after the
  // render that started it.
  const edit = useCallback((change: Partial<WishlistSettingsForm>) => {
    setSettings((s) => ({ ...s, form: { ...s.form, ...change } }));
  }, []);
  // Take in the list as the server now has it. Every field the owner hasn't
  // edited since `base` (by default: since the form was last filled) shows the
  // list's value, and the next save diffs against it.
  const refill = useCallback((list: WishlistSettings, base?: WishlistSettingsForm) => {
    setSettings((s) => ({
      form: rebaseSettingsForm(s.form, base ?? settingsFormFor(s.saved), list),
      saved: list,
    }));
  }, []);
  // Cover photos uploaded in Settings that no save has taken: one replaced or
  // removed, one discarded, and any left when the page goes are handed back
  // (WIS-181). The page's, not the tab's, as the form outlives the tab.
  const uploads = useFreshUploads();

  // Whether a save would send anything: the form as `settingsChanges` sees it,
  // so a field typed and put back, or changed only in case or spaces, isn't.
  const dirty = useMemo(() => Object.keys(settingsChanges(form, saved)).length > 0, [form, saved]);

  // Discard: the form as it was last filled from the list.
  const discard = useCallback(() => {
    setSettings((s) => ({ ...s, form: settingsFormFor(s.saved) }));
    uploads.discardAll();
  }, [uploads]);

  return { form, saved, edit, refill, uploads, dirty, discard };
}

export type SettingsFormControl = ReturnType<typeof useSettingsForm>;
