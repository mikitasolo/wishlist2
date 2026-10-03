'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import ImageUpload from '@/components/ImageUpload';
import LoadError from '@/components/LoadError';
import Panel from '@/components/Panel';
import SegmentedControl from '@/components/SegmentedControl';
import { Skeleton } from '@/components/Skeleton';
import Select from '@/components/Select';
import Toggle from '@/components/Toggle';
import UsernameField from '@/components/UsernameField';
import { signInPath } from '@/lib/utils/callbackUrl';
import { currencySelectOptions, SETTINGS_CURRENCY_FIELD_ID } from '@/lib/utils/currencies';
import { useUsernameAvailability } from '@/lib/hooks/useUsernameAvailability';
import { useToast } from '@/components/ToastProvider';
import {
  profileChanges,
  profileSettings,
  rebaseProfileForm,
  type ProfileSettings,
} from '@/lib/utils/profileSettings';
import type { InvitePolicy, ProfileVisibility } from '@/models/User';
import Field from '@/components/Field';
import Textarea from '@/components/Textarea';
import { FIELD_HELPER, FIELD_LABEL } from '@/components/fieldStyles';

export default function SettingsPage() {
  const { status, update } = useSession();
  const router = useRouter();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  // The profile couldn't be read the first time: said in place, with Try again
  // (`attempt`), and no form. One filled with defaults (no username, USD)
  // would look as if the account had lost its settings. Once the form has
  // been filled (`filled`), a reload that fails keeps it.
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const filled = useRef(false);
  const [saving, setSaving] = useState(false);
  const [email, setEmail] = useState('');
  // The form, and the profile as it was last filled from it (`saved`, null
  // until it has loaded). A save sends only what the form changed from `saved`
  // (`profileChanges`), so it can't undo a setting saved from another tab in
  // the meantime. Kept together, so a reload or a save's answer can refill the
  // form and move its baseline in one update (`refill`).
  const [settings, setSettings] = useState<{
    form: ProfileSettings;
    saved: ProfileSettings | null;
  }>(() => ({ form: profileSettings({}), saved: null }));
  const { form, saved } = settings;
  // Onto the form as it is by then: a photo upload can finish after the render
  // that started it.
  const edit = useCallback((change: Partial<ProfileSettings>) => {
    setSettings((s) => ({ ...s, form: { ...s.form, ...change } }));
  }, []);
  // Take in the profile as the server now has it. Every field not edited since
  // `base` (by default: since the form was last filled) shows the profile's
  // value, and the next save diffs against it.
  const refill = useCallback((profile: ProfileSettings, base?: ProfileSettings) => {
    setSettings((s) => ({
      form: s.saved ? rebaseProfileForm(s.form, base ?? s.saved, profile) : profile,
      saved: profile,
    }));
  }, []);
  // Saves sent so far, and whether one is in flight. A reload sent before a
  // save, or while one is in flight, may have read the profile from before that
  // save's write: taken in once the save has answered, it would put back what
  // the save replaced. So it's dropped, and the save's own answer stands.
  const saves = useRef({ sent: 0, inFlight: false });
  const availability = useUsernameAvailability(form.username, saved?.username ?? null);
  const currencyField = useRef<HTMLDivElement>(null);

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
        } else if (!inFlight && saves.current.sent === sent) {
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

  const changes = saved ? profileChanges(form, saved) : {};
  const dirty = Object.keys(changes).length > 0;
  const usernameChanged = changes.username !== undefined;
  const canSave = dirty && !saving && (!usernameChanged || availability === 'ok');

  async function handleSave() {
    if (!canSave) return;
    // Only the settings changed here go, so one saved from another tab since
    // the form was filled stays as that tab left it.
    const sent = form;
    setSaving(true);
    saves.current = { sent: saves.current.sent + 1, inFlight: true };
    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      const result = await res.json();
      // Before the session refresh below, whose reload is then read after
      // this save.
      saves.current.inFlight = false;
      if (result.success) {
        showToast('Settings saved', 'success');
        setEmail(result.data.email);
        // Refill the form from the profile as saved: what was sent, and
        // another tab's change to anything that wasn't. The next save then
        // diffs against that, not the first load.
        refill(profileSettings(result.data), sent);
        if (
          changes.username !== undefined ||
          changes.image !== undefined ||
          changes.defaultCurrency !== undefined
        ) {
          // The header shows the new name, photo or currency once the session
          // is read again. A refresh that fails only delays that, so it
          // doesn't fail a save that has landed.
          await update().catch(() => null);
        }
      } else {
        showToast(result.error || 'Failed to save settings', 'error');
      }
    } catch {
      showToast('Failed to save settings', 'error');
    } finally {
      saves.current.inFlight = false;
      setSaving(false);
    }
  }

  const heading = (
    <>
      <h1 className="mb-1 text-3xl font-semibold tracking-tight text-foreground">Settings</h1>
      <p className="mb-8 text-muted-foreground">Manage your identity and privacy.</p>
    </>
  );

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen">
        <AppHeader actions={<AuthButton />} />
        <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
          {heading}
          <SettingsSkeleton />
        </main>
      </div>
    );
  }

  // Never the form before the profile has been read into it.
  if (loadFailed || !saved) {
    return (
      <div className="min-h-screen">
        <AppHeader actions={<AuthButton />} />
        <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
          {heading}
          <LoadError title="Couldn’t load your settings" onRetry={retryLoad} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        {heading}

        {/* Profile */}
        <Panel
          className="mb-6"
          title="Profile"
          description="Your username is how other people find and see you. Your email stays private."
        >
          <div className="mb-5">
            <span className={FIELD_LABEL}>Profile photo</span>
            <ImageUpload
              value={form.image}
              onChange={(image) => edit({ image })}
              disabled={saving}
              circle
            />
          </div>

          <UsernameField
            value={form.username}
            onChange={(username) => edit({ username })}
            availability={availability}
          />

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
                placeholder="Tell people about your hobbies, interests, and passions…"
                className="resize-none"
              />
            </Field>
          </div>

          <div id={SETTINGS_CURRENCY_FIELD_ID} ref={currencyField} className="mt-5">
            <label className={FIELD_LABEL}>Default currency</label>
            <Select
              value={form.defaultCurrency}
              onChange={(defaultCurrency) => edit({ defaultCurrency })}
              options={currencySelectOptions}
              ariaLabel="Default currency"
              size="md"
              triggerClassName="w-full sm:w-80"
            />
            <p className={FIELD_HELPER}>
              Used as the default for new wishlists and to show others&apos; prices in your
              currency.
            </p>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <span className="text-sm font-medium text-foreground">Email</span>
            <p className="mt-0.5 text-sm text-muted-foreground">{email}</p>
          </div>
        </Panel>

        {/* Privacy */}
        <Panel className="mb-6" title="Privacy" description="Control who can find and reach you.">
          <Toggle
            label="Searchable"
            description="Let people find your profile by searching your username."
            checked={form.searchable}
            onChange={(searchable) => edit({ searchable })}
          />

          <div className="mt-6">
            <p className="text-sm font-medium text-foreground">Who can invite you to wishlists</p>
            <div className="mt-1.5">
              <SegmentedControl
                size="sm"
                className="max-w-sm"
                ariaLabel="Who can invite you to wishlists"
                value={form.whoCanInvite}
                onChange={(v) => edit({ whoCanInvite: v as InvitePolicy })}
                options={[
                  { value: 'everyone', label: 'Everyone' },
                  { value: 'friends', label: 'Friends' },
                  { value: 'nobody', label: 'No one' },
                ]}
              />
            </div>
          </div>

          <div className="mt-6">
            <p className="text-sm font-medium text-foreground">Who can see your wishlists</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Controls who can see your bio and browse your wishlists. Your username and avatar stay
              visible so people can follow you. Each wishlist’s own visibility still applies.
            </p>
            <div className="mt-1.5">
              <SegmentedControl
                size="sm"
                className="max-w-sm"
                ariaLabel="Who can see your wishlists"
                value={form.profileVisibility}
                onChange={(v) => edit({ profileVisibility: v as ProfileVisibility })}
                options={[
                  { value: 'everyone', label: 'Everyone' },
                  { value: 'friends', label: 'Friends' },
                ]}
              />
            </div>
          </div>
        </Panel>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </main>
    </div>
  );
}

/** The two panels and the Save button, shaped like the form, while the profile is read. */
function SettingsSkeleton() {
  const field = (labelWidth: string) => (
    <div className="mt-5">
      <Skeleton className={`mb-1.5 h-4 ${labelWidth}`} />
      <Skeleton className="h-11 w-full rounded-xl" />
      <Skeleton className="mt-1.5 h-3 w-2/3" />
    </div>
  );
  return (
    <div aria-hidden="true">
      <Panel className="mb-6">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="mt-2 h-4 w-full max-w-md" />
        <div className="mt-5">
          <Skeleton className="mb-1.5 h-4 w-24" />
          <div className="flex items-center gap-4">
            <Skeleton className="h-24 w-24 flex-shrink-0 rounded-full" />
            <Skeleton className="h-9 w-32 rounded-xl" />
          </div>
        </div>
        {field('w-20')}
        <div className="mt-5">
          <Skeleton className="mb-1.5 h-4 w-10" />
          <Skeleton className="h-[5.5rem] w-full rounded-xl" />
        </div>
        {field('w-32')}
        <div className="mt-5 border-t border-border pt-4">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="mt-1.5 h-4 w-48" />
        </div>
      </Panel>
      <Panel className="mb-6">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="mt-2 h-4 w-64 max-w-full" />
        <div className="mt-5 flex items-center justify-between gap-4">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-3/4" />
          </div>
          <Skeleton className="h-6 w-11 rounded-full" />
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="mt-6">
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="mt-1.5 h-[2.625rem] w-full max-w-sm rounded-xl" />
          </div>
        ))}
      </Panel>
      <div className="flex justify-end">
        <Skeleton className="h-11 w-36 rounded-xl" />
      </div>
    </div>
  );
}
