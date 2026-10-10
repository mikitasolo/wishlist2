'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import BirthdayField from '@/components/BirthdayField';
import BookmarkletCard from '@/components/BookmarkletCard';
import TourSetting from '@/components/TourSetting';
import Button from '@/components/Button';
import ConfirmDialog from '@/components/ConfirmDialog';
import DeleteAccount from '@/components/DeleteAccount';
import GroupsSettings, { GroupsSettingsSkeleton } from '@/components/GroupsSettings';
import Icon from '@/components/Icon';
import ImageUpload from '@/components/ImageUpload';
import LoadError from '@/components/LoadError';
import Panel from '@/components/Panel';
import SaveNote, { type SaveState } from '@/components/SaveNote';
import SegmentedControl from '@/components/SegmentedControl';
import { Skeleton } from '@/components/Skeleton';
import SettingsNav from '@/components/SettingsNav';
import Select from '@/components/Select';
import Toggle from '@/components/Toggle';
import UsernameField from '@/components/UsernameField';
import { useTheme } from '@/components/ThemeProvider';
import { parseThemeChoice } from '@/lib/utils/theme';
import { buttonClassName } from '@/components/buttonStyles';
import { signInPath } from '@/lib/utils/callbackUrl';
import { currencySelectOptions, SETTINGS_CURRENCY_FIELD_ID } from '@/lib/utils/currencies';
import { rememberSessionHint } from '@/lib/utils/sessionHint';
import { useLeaveGuard } from '@/lib/hooks/useLeaveGuard';
import { SM_UP_QUERY, useMediaQuery } from '@/lib/hooks/useMediaQuery';
import { useUsernameAvailability } from '@/lib/hooks/useUsernameAvailability';
import { useToast } from '@/components/ToastProvider';
import {
  profileChanges,
  profileSettings,
  rebaseProfileForm,
  settingChange,
  type NotificationSettingKey,
  type ProfileChanges,
  type ProfileSettings,
} from '@/lib/utils/profileSettings';
import NotificationSettings from '@/components/NotificationSettings';
import { NOTIFICATION_EVENT_KEYS } from '@/lib/utils/notificationPrefs';
import type { InvitePolicy, ProfileVisibility } from '@/models/User';
import Field from '@/components/Field';
import Textarea from '@/components/Textarea';
import { FIELD_HELPER, FIELD_LABEL } from '@/components/fieldStyles';
import { useFreshUploads } from '@/lib/hooks/useFreshUploads';
import { isCompleteBirthday, type BirthdayVisibility } from '@/lib/utils/birthday';

/**
 * The settings that save as they're changed (D8): each sends only itself, the
 * moment it's picked, and goes back to what's saved if that fails. The
 * username, bio and birthday are edited, so they wait for their own Save.
 */
type InstantField =
  | 'image'
  | 'defaultCurrency'
  | 'searchable'
  | 'whoCanInvite'
  | 'profileVisibility'
  | 'birthdayVisibility'
  | NotificationSettingKey;
/** What a save note sits beside: one instant setting, or the username, bio and birthday together. */
type NoteKey = InstantField | 'profile';

/** What the header shows comes from the session, so a change to these reads it again. */
const IN_SESSION: readonly (keyof ProfileSettings)[] = ['username', 'image', 'defaultCurrency'];
/** How long "Saved" stays up. */
const SAVED_NOTE_MS = 2000;
const INSTANT_ERROR = 'Couldn’t save. Try again.';

const PROFILE_VISIBILITY_HELPER =
  'Friends only hides your bio and your list of wishlists from everyone else, and keeps your lists out of their search unless they’re on the list. Anyone you send a public list’s link to can still open it.';
const SEARCHABLE_ON =
  'People can find you by searching for your username, and you show up in invite suggestions.';
const SEARCHABLE_OFF =
  'You won’t appear in search or invite suggestions. People who know your exact username can still open your profile, and invite you if Who can invite you allows it.';
const BIRTHDAY_VISIBILITY_HELPER =
  'Everyone means everyone who can see your profile. Only the day and month show.';
// A friends-only profile caps it (`birthdayAudience`), so Everyone reads as Friends.
const BIRTHDAY_VISIBILITY_CAPPED =
  'Your profile is friends only, so Everyone means your friends too.';
const WHO_CAN_INVITE_HELPER = 'Owners of a list you’re on can still offer to make you a co-owner.';

type PatchResult =
  | { ok: true; profile: ProfileSettings; email: string }
  // `answered`: the server refused it, so it's over and wrote nothing. Without
  // it the save may still have landed (a dropped connection, an unreadable answer).
  | { ok: false; error?: string; answered?: boolean };

export default function SettingsPage() {
  const { status, update } = useKnownSession();
  const router = useRouter();
  const { showToast } = useToast();
  // Which of the username and bio's two Save rows is on screen: CSS picks it on
  // the first paint, and this drops the other once the width is known.
  const smUp = useMediaQuery(SM_UP_QUERY);

  const [loading, setLoading] = useState(true);
  // The profile couldn't be read the first time: said in place, with Try again
  // (`attempt`), and no form. One filled with defaults (no username, USD)
  // would look as if the account had lost its settings. Once the form has
  // been filled (`filled`), a reload that fails keeps it.
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const filled = useRef(false);
  const [savingText, setSavingText] = useState(false);
  const [email, setEmail] = useState('');
  // The form, and the profile as it was last filled from it (`saved`, null
  // until it has loaded). A save sends only what changed from `saved`
  // (`profileChanges`), so it can't undo a setting saved from another tab in
  // the meantime. Kept together, so a reload or a save's answer can refill the
  // form and move its baseline in one update (`refill`).
  const [settings, setSettings] = useState<{
    form: ProfileSettings;
    saved: ProfileSettings | null;
  }>(() => ({ form: profileSettings({}), saved: null }));
  const { form, saved } = settings;
  // The profile as the server last answered with it, at once: an instant save
  // works out what it sends from it, and may run before the render that shows it.
  const latest = useRef<ProfileSettings | null>(null);
  // Onto the form as it is by then: a photo upload can finish after the render
  // that started it.
  const edit = useCallback((change: Partial<ProfileSettings>) => {
    setSettings((s) => ({ ...s, form: { ...s.form, ...change } }));
  }, []);
  // Take in the profile as the server now has it. Every field not edited since
  // `base` (by default: since the form was last filled) shows the profile's
  // value, and the next save diffs against it.
  const refill = useCallback((profile: ProfileSettings, base?: ProfileSettings) => {
    latest.current = profile;
    setSettings((s) => ({
      form: s.saved ? rebaseProfileForm(s.form, base ?? s.saved, profile) : profile,
      saved: profile,
    }));
  }, []);
  // Saves sent so far, and how many are in flight. A reload sent before a
  // save, or while one is in flight, may have read the profile from before that
  // save's write: taken in once the save has answered, it would put back what
  // the save replaced. So it's dropped, and the save's own answer stands.
  const saves = useRef({ sent: 0, inFlight: 0 });
  // The latest save, in the order they were sent, whose answer has been taken
  // in. Saves of different settings run side by side, so an earlier one's
  // answer can arrive after a later one's: it's dropped then, as older.
  const applied = useRef(0);
  const availability = useUsernameAvailability(form.username, saved?.username ?? null);
  const currencyField = useRef<HTMLDivElement>(null);

  // Each save note, and the timers that take "Saved" down again.
  const [notes, setNotes] = useState<Partial<Record<NoteKey, SaveState>>>({});
  const noteTimers = useRef<Partial<Record<NoteKey, ReturnType<typeof setTimeout>>>>({});
  const note = useCallback((key: NoteKey, state: SaveState | undefined) => {
    clearTimeout(noteTimers.current[key]);
    setNotes((n) => ({ ...n, [key]: state }));
    if (state?.kind === 'saved') {
      noteTimers.current[key] = setTimeout(
        () => setNotes((n) => (n[key]?.kind === 'saved' ? { ...n, [key]: undefined } : n)),
        SAVED_NOTE_MS
      );
    }
  }, []);
  useEffect(() => {
    const timers = noteTimers.current;
    return () => Object.values(timers).forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(signInPath('/settings'));
  }, [status, router]);

  useEffect(() => {
    async function load() {
      const { sent, inFlight } = saves.current;
      try {
        const res = await fetch('/api/users/me', { cache: 'no-store' });
        const result = await res.json();
        if (!result.success) {
          if (!filled.current) setLoadFailed(true);
        } else if (inFlight === 0 && saves.current.inFlight === 0 && saves.current.sent === sent) {
          setEmail(result.data.email);
          // Edits not saved yet stay in the form.
          refill(profileSettings(result.data));
          filled.current = true;
        }
      } catch {
        if (filled.current) showToast('Failed to load settings', 'error');
        else setLoadFailed(true);
      } finally {
        setLoading(false);
      }
    }
    if (status === 'authenticated') load();
  }, [status, showToast, refill, attempt]);

  const retryLoad = useCallback(() => {
    setLoadFailed(false);
    setLoading(true);
    setAttempt((n) => n + 1);
  }, []);

  // The dashboard's currency prompt sends "Choose another currency" here: once the
  // form is in, focus the currency picker (which scrolls it into view).
  useEffect(() => {
    if (loading || window.location.hash !== `#${SETTINGS_CURRENCY_FIELD_ID}`) return;
    currencyField.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus();
  }, [loading]);

  /**
   * Sends `changes`, and on success takes the profile in as saved: what was
   * sent (`base`, the profile with it applied) takes the stored value, and
   * anything else edited meanwhile stays. Reads the session again when the
   * header shows what changed; a refresh that fails only delays that, so it
   * doesn't fail a save that has landed.
   */
  async function patchProfile(
    changes: ProfileChanges,
    base: ProfileSettings
  ): Promise<PatchResult> {
    saves.current = { sent: saves.current.sent + 1, inFlight: saves.current.inFlight + 1 };
    const seq = saves.current.sent;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      saves.current.inFlight -= 1;
    };
    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      const result = await res.json();
      // Before the session refresh below, whose reload is then read after this save.
      settle();
      if (!result.success) return { ok: false, error: result.error, answered: true };
      const profile = profileSettings(result.data);
      if (seq > applied.current) {
        applied.current = seq;
        setEmail(result.data.email);
        refill(profile, base);
      }
      if (IN_SESSION.some((key) => key in changes)) await update().catch(() => null);
      return { ok: true, profile, email: result.data.email };
    } catch {
      return { ok: false };
    } finally {
      settle();
    }
  }

  // An instant setting whose save is in flight, and the value picked for it
  // meanwhile, which goes once that save has answered: two saves of one
  // setting in flight could land in either order.
  const running = useRef(new Set<InstantField>());
  // Profile photos uploaded here that no save has taken: one replaced before
  // its save went, one a refused save put back, and one waiting to go when the
  // page is left are handed back (WIS-181).
  const photoUploads = useFreshUploads();
  const queued = useRef<Partial<ProfileSettings>>({});

  function changeInstant<K extends InstantField>(field: K, value: ProfileSettings[K]) {
    edit({ [field]: value } as Partial<ProfileSettings>);
    if (running.current.has(field)) {
      queued.current[field] = value;
      return;
    }
    void runInstant(field, value);
  }

  async function runInstant<K extends InstantField>(field: K, first: ProfileSettings[K]) {
    running.current.add(field);
    let next: ProfileSettings[K] | undefined = first;
    let lastSent: { value: ProfileSettings[K] } | null = null;
    try {
      while (next !== undefined) {
        const value: ProfileSettings[K] = next;
        delete queued.current[field];
        next = undefined;
        const current = latest.current;
        if (!current) return;
        // Every change of the control is sent (but one picked back to what
        // this run has just saved): only this setting, by its own dotted path
        // on the server for a privacy one, so it can't write back any other.
        if (lastSent === null || lastSent.value !== value) {
          note(field, { kind: 'saving' });
          const photo = field === 'image' ? (value as ProfileSettings['image']) : null;
          const settlePhoto = photoUploads.saving(photo);
          const result = await patchProfile(settingChange(field, value), {
            ...current,
            [field]: value,
          });
          settlePhoto(result.ok ? 'saved' : result.answered ? 'refused' : 'unknown');
          if (!result.ok) {
            // The control goes back to what's saved, so neither the refused
            // photo nor one waiting behind it is shown any more.
            if (field === 'image') {
              photoUploads.discard(photo);
              photoUploads.discard(queued.current.image);
            }
            delete queued.current[field];
            // Back to what's saved, which is what the control shows again, and
            // read the profile afresh in case what's saved was read out of date.
            setSettings((s) =>
              s.saved ? { ...s, form: { ...s.form, [field]: s.saved[field] } } : s
            );
            note(field, { kind: 'error', message: INSTANT_ERROR });
            setAttempt((n) => n + 1);
            return;
          }
          lastSent = { value };
        }
        next = queued.current[field] as ProfileSettings[K] | undefined;
      }
      note(field, lastSent ? { kind: 'saved' } : undefined);
    } finally {
      running.current.delete(field);
    }
  }

  // The username, bio and birthday: edited, so saved together with their own Save.
  const textChanges = saved
    ? profileChanges(
        { ...saved, username: form.username, bio: form.bio, birthday: form.birthday },
        saved
      )
    : {};
  const textDirty = Object.keys(textChanges).length > 0;
  const usernameChanged = textChanges.username !== undefined;
  // A month picked without its day (or the other way round) waits for the other.
  const birthdayComplete = isCompleteBirthday(form.birthday);
  const canSaveText =
    textDirty && !savingText && birthdayComplete && (!usernameChanged || availability === 'ok');
  const guard = useLeaveGuard(textDirty);

  async function handleSaveText() {
    const current = latest.current;
    if (!canSaveText || !current) return;
    setSavingText(true);
    note('profile', { kind: 'saving' });
    const result = await patchProfile(textChanges, {
      ...current,
      username: form.username,
      bio: form.bio,
      birthday: form.birthday,
    });
    setSavingText(false);
    if (result.ok) {
      note('profile', { kind: 'saved' });
    } else {
      // The edits stay, to be sent again.
      note('profile', { kind: 'error', message: result.error || 'Couldn’t save your changes.' });
    }
  }

  function discardText() {
    setSettings((s) =>
      s.saved
        ? {
            ...s,
            form: {
              ...s.form,
              username: s.saved.username,
              bio: s.saved.bio,
              birthday: s.saved.birthday,
            },
          }
        : s
    );
    note('profile', undefined);
  }

  function handleSignOut() {
    // With the username or bio unsaved, ask first, in the page's own dialog:
    // the browser's leave prompt would only come once the session is gone.
    if (textDirty) guard.hold(signOutNow);
    else signOutNow();
  }

  function signOutNow() {
    // Forgotten first, as the account menu does (WIS-209). Settings needs an
    // account, so signing out from it goes home.
    rememberSessionHint(false);
    signOut({ redirectTo: '/' });
  }

  const heading = (
    <>
      <h1 className="mb-1 text-3xl font-semibold tracking-tight text-foreground">Settings</h1>
      <p className="mb-8 text-muted-foreground">Your profile, privacy and account.</p>
    </>
  );

  // Never the form before the profile has been read into it. Once it has, the
  // form stays up through a session refresh, which reads it again.
  if (!saved) {
    return (
      <div className="min-h-screen">
        <AppHeader actions={<AuthButton />} />
        <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10 lg:max-w-5xl lg:px-8">
          {heading}
          <div className="max-w-2xl lg:ml-52">
            {loadFailed && !loading ? (
              <LoadError title="Couldn’t load your settings" onRetry={retryLoad} />
            ) : (
              <SettingsSkeleton />
            )}
          </div>
        </main>
      </div>
    );
  }

  const savingImage = notes.image?.kind === 'saving';

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10 lg:max-w-5xl lg:px-8">
        {heading}

        <div className="lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-10">
          <SettingsNav />
          <div className="min-w-0 max-w-2xl [&>[id]]:scroll-mt-24">
            <Panel
              id="profile"
              className="mb-6"
              title="Public profile"
              description="What everyone sees on your profile."
            >
              <div className="mb-5">
                <div className="mb-1.5 flex items-center gap-3">
                  <span className="text-sm font-medium text-foreground">Profile photo</span>
                  <SaveNote state={notes.image} />
                </div>
                <ImageUpload
                  value={form.image}
                  onChange={(image) => changeInstant('image', image)}
                  uploads={photoUploads}
                  disabled={savingImage}
                  circle
                />
              </div>

              <UsernameField
                value={form.username}
                onChange={(username) => edit({ username })}
                availability={availability}
                disabled={savingText}
                savedUsername={saved.username}
              />
              {saved.username && <ProfileLink username={saved.username} />}

              <div className="mt-5">
                {/* The count is read with the field, as the item form's notes count is. */}
                <Field
                  label="Bio"
                  id="bio"
                  helper={<span className="block text-right">{form.bio.length}/300</span>}
                >
                  <Textarea
                    value={form.bio}
                    onChange={(e) => edit({ bio: e.target.value.slice(0, 300) })}
                    rows={3}
                    maxLength={300}
                    placeholder="Tell people about your hobbies, interests and passions"
                    className="resize-none"
                    disabled={savingText}
                  />
                </Field>
              </div>

              <div className="mt-5">
                <BirthdayField
                  value={form.birthday}
                  onChange={(birthday) => edit({ birthday })}
                  disabled={savingText}
                  error={birthdayComplete ? null : 'Pick both the month and the day'}
                />
              </div>

              <div className="mt-5">
                <div className="flex items-center gap-3">
                  <p id="birthday-visibility-label" className="text-sm font-medium text-foreground">
                    Who can see your birthday
                  </p>
                  <SaveNote state={notes.birthdayVisibility} />
                </div>
                <p id="birthday-visibility-helper" className={`${FIELD_HELPER} mb-1.5`}>
                  {form.profileVisibility === 'friends' && form.birthdayVisibility === 'everyone'
                    ? BIRTHDAY_VISIBILITY_CAPPED
                    : BIRTHDAY_VISIBILITY_HELPER}
                </p>
                <SegmentedControl
                  size="sm"
                  className="max-w-sm"
                  ariaLabelledBy="birthday-visibility-label"
                  ariaDescribedBy="birthday-visibility-helper"
                  value={form.birthdayVisibility}
                  onChange={(v) => changeInstant('birthdayVisibility', v as BirthdayVisibility)}
                  options={[
                    { value: 'nobody', label: 'No one' },
                    { value: 'friends', label: 'Friends' },
                    { value: 'everyone', label: 'Everyone' },
                  ]}
                />
              </div>

              {smUp !== false && (
                <div className="mt-5 flex items-center justify-end gap-3 max-sm:hidden">
                  <SaveNote state={notes.profile} className="mr-auto" />
                  <Button
                    variant="secondary"
                    onClick={discardText}
                    disabled={!textDirty || savingText}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleSaveText} disabled={!canSaveText}>
                    {savingText ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              )}
            </Panel>

            <Panel
              id="privacy"
              className="mb-6"
              title="Privacy"
              description="Friends are people you follow who follow you back."
            >
              <div>
                <div className="flex items-center gap-3">
                  <p id="profile-visibility-label" className="text-sm font-medium text-foreground">
                    Who can see your profile
                  </p>
                  <SaveNote state={notes.profileVisibility} />
                </div>
                <p id="profile-visibility-helper" className={`${FIELD_HELPER} mb-1.5`}>
                  {PROFILE_VISIBILITY_HELPER}
                </p>
                <SegmentedControl
                  size="sm"
                  className="max-w-sm"
                  ariaLabelledBy="profile-visibility-label"
                  ariaDescribedBy="profile-visibility-helper"
                  value={form.profileVisibility}
                  onChange={(v) => changeInstant('profileVisibility', v as ProfileVisibility)}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'friends', label: 'Friends only' },
                  ]}
                />
              </div>

              <div className="mt-6">
                <Toggle
                  label="Searchable"
                  description={form.searchable ? SEARCHABLE_ON : SEARCHABLE_OFF}
                  checked={form.searchable}
                  onChange={(searchable) => changeInstant('searchable', searchable)}
                  note={<SaveNote state={notes.searchable} />}
                />
              </div>

              <div className="mt-6">
                <div className="flex items-center gap-3">
                  <p id="who-can-invite-label" className="text-sm font-medium text-foreground">
                    Who can invite you to wishlists
                  </p>
                  <SaveNote state={notes.whoCanInvite} />
                </div>
                <p id="who-can-invite-helper" className={`${FIELD_HELPER} mb-1.5`}>
                  {WHO_CAN_INVITE_HELPER}
                </p>
                <SegmentedControl
                  size="sm"
                  className="max-w-sm"
                  ariaLabelledBy="who-can-invite-label"
                  ariaDescribedBy="who-can-invite-helper"
                  value={form.whoCanInvite}
                  onChange={(v) => changeInstant('whoCanInvite', v as InvitePolicy)}
                  options={[
                    { value: 'everyone', label: 'Everyone' },
                    { value: 'friends', label: 'Friends' },
                    { value: 'nobody', label: 'No one' },
                  ]}
                />
              </div>
            </Panel>

            <GroupsSettings />

            <Panel
              id="notifications"
              className="mb-6"
              title="Notifications"
              description="What reaches you in Activity, and what’s also sent to your email."
            >
              <NotificationSettings
                values={form}
                onChange={(key, on) => changeInstant(key, on)}
                note={(key) => <SaveNote state={notes[key]} />}
              />
            </Panel>

            <BookmarkletCard />

            <Panel id="preferences" className="mb-6" title="Preferences">
              <div id={SETTINGS_CURRENCY_FIELD_ID} ref={currencyField}>
                <div className="mb-1.5 flex items-center gap-3">
                  <label className="text-sm font-medium text-foreground">Default currency</label>
                  <SaveNote state={notes.defaultCurrency} />
                </div>
                <Select
                  value={form.defaultCurrency}
                  onChange={(defaultCurrency) => changeInstant('defaultCurrency', defaultCurrency)}
                  options={currencySelectOptions}
                  ariaLabel="Default currency"
                  size="lg"
                  triggerClassName="w-full sm:w-80"
                />
                <p className={FIELD_HELPER}>
                  Used as the default for new wishlists and to show others&apos; prices in your
                  currency.
                </p>
              </div>

              <ThemeSetting />
            </Panel>

            <TourSetting />

            <Panel id="account" title="Account">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Email</p>
                  <p className="mt-0.5 break-all text-sm text-foreground">{email}</p>
                  <p className={FIELD_HELPER}>
                    Used to sign you in and to email you invitations. Never shown to anyone else.
                  </p>
                </div>
                <Button variant="secondary" icon="logout" onClick={handleSignOut}>
                  Sign out
                </Button>
              </div>
              <DeleteAccount
                username={saved?.username ?? ''}
                email={email}
                onDeleted={() => {
                  // The account and its sessions are gone: nothing unsaved is
                  // left to guard, and this browser signs out to the home page.
                  discardText();
                  signOutNow();
                }}
                onSignInAgain={() => {
                  discardText();
                  rememberSessionHint(false);
                  signOut({ redirectTo: signInPath('/settings') });
                }}
              />
            </Panel>

            {/* On a phone the username and bio's Save sits in a bar stuck to the
            bottom of the screen (above the tab bar, `--tab-bar-space`) while
            they have edits, so it's in reach from anywhere on the page. */}
            {textDirty && smUp !== true && (
              <div
                role="region"
                aria-label="Unsaved changes"
                className="sticky bottom-[calc(1rem+var(--tab-bar-space,0px))] z-20 mt-6 flex items-center gap-3 rounded-2xl border border-border bg-surface py-3 pl-4 pr-3 shadow-lg sm:hidden"
              >
                <p className="min-w-0 flex-1 text-sm font-medium text-foreground">
                  {notes.profile?.kind === 'error' ? (
                    <SaveNote state={notes.profile} />
                  ) : (
                    'Unsaved changes'
                  )}
                </p>
                <Button variant="secondary" onClick={discardText} disabled={savingText}>
                  Discard
                </Button>
                <Button onClick={handleSaveText} disabled={!canSaveText}>
                  {savingText ? 'Saving…' : 'Save'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </main>

      <ConfirmDialog
        isOpen={guard.pending !== null}
        title="Discard changes?"
        message="Your profile changes haven’t been saved."
        confirmText="Discard"
        cancelText="Keep editing"
        type="warning"
        onConfirm={() => {
          discardText();
          guard.leave();
        }}
        onCancel={guard.stay}
      />
    </div>
  );
}

/** Light, Dark or System (the default), as the account menu's Theme sets it: kept in this browser, not the account. */
function ThemeSetting() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="mt-6">
      <p id="theme-label" className={FIELD_LABEL}>
        Theme
      </p>
      <SegmentedControl
        size="sm"
        className="max-w-xs"
        ariaLabelledBy="theme-label"
        value={theme}
        onChange={(t) => setTheme(parseThemeChoice(t))}
        options={[
          { value: 'light', label: 'Light', icon: 'sun' },
          { value: 'dark', label: 'Dark', icon: 'moon' },
          { value: 'system', label: 'System', icon: 'monitor' },
        ]}
      />
    </div>
  );
}

/** "Profile link: example.com/users/alice", with Copy and View ↗. */
function ProfileLink({ username }: { username: string }) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const path = `/users/${username}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
    } catch {
      showToast('Could not copy your profile link', 'error');
      return;
    }
    setCopied(true);
    showToast('Profile link copied to clipboard', 'success');
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), SAVED_NOTE_MS);
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="min-w-0 text-sm text-muted-foreground">
        Profile link:{' '}
        <span className="break-all font-medium text-foreground">
          {window.location.host}
          {path}
        </span>
      </p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={copied ? 'check' : 'link'}
          onClick={copy}
          aria-label={copied ? 'Copied your profile link' : 'Copy your profile link'}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <a
          href={path}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClassName({ variant: 'secondary', size: 'sm' })}
          aria-label="View your profile (opens in a new tab)"
        >
          View
          <Icon name="external-link" size={16} />
        </a>
      </div>
    </div>
  );
}

/** The five panels, shaped like the page, while the profile is read. */
function SettingsSkeleton() {
  const row = (labelWidth: string) => (
    <div className="mt-6">
      <Skeleton className={`h-4 ${labelWidth}`} />
      <Skeleton className="mt-1.5 h-3 w-full max-w-md" />
      <Skeleton className="mt-1.5 h-8 w-full max-w-sm rounded-xl" />
    </div>
  );
  const title = (width: string) => <Skeleton className={`h-6 ${width}`} />;
  return (
    <div aria-hidden="true">
      <Panel className="mb-6">
        {title('w-32')}
        <Skeleton className="mt-2 h-4 w-56 max-w-full" />
        <div className="mt-5">
          <Skeleton className="mb-1.5 h-4 w-24" />
          <div className="flex items-center gap-4">
            <Skeleton className="h-24 w-24 flex-shrink-0 rounded-full" />
            <Skeleton className="h-9 w-32 rounded-xl" />
          </div>
        </div>
        <div className="mt-5">
          <Skeleton className="mb-1.5 h-4 w-20" />
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="mt-1.5 h-3 w-2/3" />
          <Skeleton className="mt-3 h-9 w-72 max-w-full rounded-xl" />
        </div>
        <div className="mt-5">
          <Skeleton className="mb-1.5 h-4 w-10" />
          <Skeleton className="h-[5.5rem] w-full rounded-xl" />
        </div>
        <div className="mt-5">
          <Skeleton className="mb-1.5 h-4 w-16" />
          <div className="flex gap-3">
            <Skeleton className="h-11 flex-1 rounded-xl sm:w-40 sm:flex-none" />
            <Skeleton className="h-11 w-24 rounded-xl" />
          </div>
          <Skeleton className="mt-1.5 h-3 w-64 max-w-full" />
        </div>
        <div className="mt-5">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="mt-1.5 h-3 w-full max-w-md" />
          <Skeleton className="mt-1.5 h-8 w-full max-w-sm rounded-xl" />
        </div>
      </Panel>
      <Panel className="mb-6">
        {title('w-20')}
        <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        <div className="mt-5">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="mt-1.5 h-3 w-full" />
          <Skeleton className="mt-1.5 h-8 w-full max-w-sm rounded-xl" />
        </div>
        <div className="mt-6 flex items-center justify-between gap-4">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <Skeleton className="h-6 w-11 rounded-full" />
        </div>
        {row('w-56 max-w-full')}
      </Panel>
      <GroupsSettingsSkeleton />
      <Panel className="mb-6">
        {title('w-28')}
        <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        {NOTIFICATION_EVENT_KEYS.map((event) => (
          <div key={event} className="mt-5 flex items-center gap-3 sm:gap-6">
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <Skeleton className="h-6 w-11 rounded-full" />
            <Skeleton className="h-6 w-11 rounded-full" />
          </div>
        ))}
      </Panel>
      <Panel className="mb-6">
        {title('w-28')}
        <div className="mt-5">
          <Skeleton className="mb-1.5 h-4 w-32" />
          <Skeleton className="h-11 w-full rounded-xl sm:w-80" />
          <Skeleton className="mt-1.5 h-3 w-2/3" />
        </div>
        <div className="mt-6">
          <Skeleton className="mb-1.5 h-4 w-14" />
          <Skeleton className="h-8 w-full max-w-xs rounded-xl" />
        </div>
      </Panel>
      <Panel>
        {title('w-24')}
        <div className="mt-5 flex items-center justify-between gap-4">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="h-11 w-28 rounded-xl" />
        </div>
      </Panel>
    </div>
  );
}
