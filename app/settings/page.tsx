'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import ImageUpload from '@/components/ImageUpload';
import Select from '@/components/Select';
import Toggle from '@/components/Toggle';
import UsernameField from '@/components/UsernameField';
import { currencySelectOptions } from '@/lib/utils/currencies';
import { useUsernameAvailability } from '@/lib/hooks/useUsernameAvailability';
import { useToast } from '@/components/ToastProvider';
import {
  profileChanges,
  profileSettings,
  rebaseProfileForm,
  type ProfileSettings,
} from '@/lib/utils/profileSettings';
import type { InvitePolicy, ProfileVisibility } from '@/models/User';

export default function SettingsPage() {
  const { status, update } = useSession();
  const router = useRouter();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
  }, [status, router]);

  useEffect(() => {
    async function load() {
      const { sent, inFlight } = saves.current;
      try {
        const res = await fetch('/api/users/me', { cache: 'no-store' });
        const result = await res.json();
        if (result.success && !inFlight && saves.current.sent === sent) {
          setEmail(result.data.email);
          // Edits not saved yet stay in the form.
          refill(profileSettings(result.data));
        }
      } catch {
        showToast('Failed to load settings', 'error');
      } finally {
        setLoading(false);
      }
    }
    if (status === 'authenticated') load();
  }, [status, showToast, refill]);

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

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen">
        <AppHeader actions={<AuthButton />} />
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="spinner h-8 w-8 text-primary-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <h1 className="mb-1 text-3xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="mb-8 text-muted-foreground">Manage your identity and privacy.</p>

        {/* Profile */}
        <section className="mb-6 rounded-2xl border border-border bg-surface p-6 shadow-md">
          <h2 className="mb-1 text-lg font-semibold text-foreground">Profile</h2>
          <p className="mb-5 text-sm text-muted-foreground">
            Your username is how other people find and see you. Your email stays private.
          </p>

          <div className="mb-5">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Profile photo</span>
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
            <label htmlFor="bio" className="mb-1.5 block text-sm font-medium text-foreground">
              Bio
            </label>
            <textarea
              id="bio"
              value={form.bio}
              onChange={(e) => edit({ bio: e.target.value.slice(0, 300) })}
              rows={3}
              maxLength={300}
              placeholder="Tell people about your hobbies, interests, and passions…"
              className="w-full resize-none rounded-xl border border-border-strong bg-surface px-4 py-2.5 text-[15px] outline-none"
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">{form.bio.length}/300</p>
          </div>

          <div className="mt-5">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Default currency
            </label>
            <Select
              value={form.defaultCurrency}
              onChange={(defaultCurrency) => edit({ defaultCurrency })}
              options={currencySelectOptions}
              ariaLabel="Default currency"
              size="md"
              triggerClassName="w-full sm:w-80"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Used as the default for new wishlists and to show others&apos; prices in your
              currency.
            </p>
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <span className="text-sm font-medium text-foreground">Email</span>
            <p className="mt-0.5 text-sm text-muted-foreground">{email}</p>
          </div>
        </section>

        {/* Privacy */}
        <section className="mb-6 rounded-2xl border border-border bg-surface p-6 shadow-md">
          <h2 className="mb-1 text-lg font-semibold text-foreground">Privacy</h2>
          <p className="mb-5 text-sm text-muted-foreground">Control who can find and reach you.</p>

          <Toggle
            label="Searchable"
            description="Let people find your profile by searching your username."
            checked={form.searchable}
            onChange={(searchable) => edit({ searchable })}
          />

          <div className="mt-6">
            <p className="text-sm font-medium text-foreground">Who can invite you to wishlists</p>
            <div className="mt-2">
              <Segmented
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
            <div className="mt-2">
              <Segmented
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
        </section>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </main>
    </div>
  );
}

function Segmented({
  ariaLabel,
  value,
  onChange,
  options,
}: {
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const n = options.length;
  const idx = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="relative inline-flex w-full max-w-sm rounded-xl border border-border bg-surface-2 p-1"
    >
      {/* Sliding selected indicator */}
      <span
        aria-hidden
        className="absolute bottom-1 top-1 rounded-lg bg-surface shadow-sm transition-[left] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
        style={{
          width: `calc((100% - 0.5rem) / ${n})`,
          left: `calc(${idx} * ((100% - 0.5rem) / ${n}) + 0.25rem)`,
        }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`relative z-10 flex-1 rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors ${
            value === o.value ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
