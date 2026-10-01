'use client';

import { useEffect, useState } from 'react';
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

type InvitePolicy = 'everyone' | 'friends' | 'nobody';
type ProfileVisibility = 'everyone' | 'friends';

interface Profile {
  email: string;
  username: string;
  image: string | null;
  bio: string;
  defaultCurrency: string;
  privacy: {
    searchable: boolean;
    whoCanInvite: InvitePolicy;
    profileVisibility: ProfileVisibility;
  };
}

export default function SettingsPage() {
  const { status, update } = useSession();
  const router = useRouter();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [initial, setInitial] = useState<Profile | null>(null);
  const [username, setUsername] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [defaultCurrency, setDefaultCurrency] = useState('USD');
  const [searchable, setSearchable] = useState(true);
  const [whoCanInvite, setWhoCanInvite] = useState<InvitePolicy>('everyone');
  const [profileVisibility, setProfileVisibility] = useState<ProfileVisibility>('everyone');
  const availability = useUsernameAvailability(username, initial?.username ?? null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
  }, [status, router]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/users/me', { cache: 'no-store' });
        const result = await res.json();
        if (result.success) {
          const p: Profile = {
            email: result.data.email,
            username: result.data.username || '',
            image: result.data.image ?? null,
            bio: result.data.bio ?? '',
            defaultCurrency: result.data.defaultCurrency ?? 'USD',
            privacy: {
              searchable: result.data.privacy?.searchable ?? true,
              whoCanInvite: result.data.privacy?.whoCanInvite ?? 'everyone',
              profileVisibility: result.data.privacy?.profileVisibility ?? 'everyone',
            },
          };
          setInitial(p);
          setUsername(p.username);
          setImage(p.image);
          setBio(p.bio);
          setDefaultCurrency(p.defaultCurrency);
          setSearchable(p.privacy.searchable);
          setWhoCanInvite(p.privacy.whoCanInvite);
          setProfileVisibility(p.privacy.profileVisibility);
        }
      } catch {
        showToast('Failed to load settings', 'error');
      } finally {
        setLoading(false);
      }
    }
    if (status === 'authenticated') load();
  }, [status, showToast]);

  const imageChanged = !!initial && (image ?? null) !== (initial.image ?? null);
  const bioChanged = !!initial && bio.trim() !== initial.bio;
  const currencyChanged = !!initial && defaultCurrency !== initial.defaultCurrency;
  const dirty =
    !!initial &&
    (username.toLowerCase() !== initial.username ||
      imageChanged ||
      bioChanged ||
      currencyChanged ||
      searchable !== initial.privacy.searchable ||
      whoCanInvite !== initial.privacy.whoCanInvite ||
      profileVisibility !== initial.privacy.profileVisibility);

  const usernameChanged = !!initial && username.toLowerCase() !== initial.username;
  const canSave = dirty && !saving && (!usernameChanged || availability === 'ok');

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        privacy: { searchable, whoCanInvite, profileVisibility },
      };
      if (usernameChanged) body.username = username.toLowerCase();
      if (imageChanged) body.image = image ?? '';
      if (bioChanged) body.bio = bio.trim();
      if (currencyChanged) body.defaultCurrency = defaultCurrency;

      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (result.success) {
        showToast('Settings saved', 'success');
        setInitial({
          email: result.data.email,
          username: result.data.username,
          image: result.data.image ?? null,
          bio: result.data.bio ?? '',
          defaultCurrency: result.data.defaultCurrency ?? 'USD',
          privacy: result.data.privacy,
        });
        if (usernameChanged || imageChanged || currencyChanged) await update();
      } else {
        showToast(result.error || 'Failed to save settings', 'error');
      }
    } catch {
      showToast('Failed to save settings', 'error');
    } finally {
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
            <ImageUpload value={image} onChange={setImage} disabled={saving} circle />
          </div>

          <UsernameField value={username} onChange={setUsername} availability={availability} />

          <div className="mt-5">
            <label htmlFor="bio" className="mb-1.5 block text-sm font-medium text-foreground">
              Bio
            </label>
            <textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 300))}
              rows={3}
              maxLength={300}
              placeholder="Tell people about your hobbies, interests, and passions…"
              className="w-full resize-none rounded-xl border border-border-strong bg-surface px-4 py-2.5 text-[15px] outline-none"
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">{bio.length}/300</p>
          </div>

          <div className="mt-5">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Default currency
            </label>
            <Select
              value={defaultCurrency}
              onChange={setDefaultCurrency}
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
            <p className="mt-0.5 text-sm text-muted-foreground">{initial?.email}</p>
          </div>
        </section>

        {/* Privacy */}
        <section className="mb-6 rounded-2xl border border-border bg-surface p-6 shadow-md">
          <h2 className="mb-1 text-lg font-semibold text-foreground">Privacy</h2>
          <p className="mb-5 text-sm text-muted-foreground">Control who can find and reach you.</p>

          <Toggle
            label="Searchable"
            description="Let people find your profile by searching your username."
            checked={searchable}
            onChange={setSearchable}
          />

          <div className="mt-6">
            <p className="text-sm font-medium text-foreground">Who can invite you to wishlists</p>
            <div className="mt-2">
              <Segmented
                value={whoCanInvite}
                onChange={(v) => setWhoCanInvite(v as InvitePolicy)}
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
                value={profileVisibility}
                onChange={(v) => setProfileVisibility(v as ProfileVisibility)}
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
  value,
  onChange,
  options,
}: {
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
    <div className="relative inline-flex w-full max-w-sm rounded-xl border border-border bg-surface-2 p-1">
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
