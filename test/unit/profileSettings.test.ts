import { describe, it, expect } from 'vitest';
import {
  profileChanges,
  profileSettings,
  rebaseProfileForm,
  settingChange,
  type ProfileSettings,
} from '@/lib/utils/profileSettings';

const PHOTO = 'https://store.public.blob.vercel-storage.com/uploads/u1/me.webp';
const NEW_PHOTO = 'https://store.public.blob.vercel-storage.com/uploads/u1/new.webp';

// The profile as the settings form was filled from it.
const saved: ProfileSettings = {
  username: 'alice',
  image: PHOTO,
  bio: 'I collect mugs.',
  defaultCurrency: 'EUR',
  searchable: true,
  whoCanInvite: 'everyone',
  profileVisibility: 'everyone',
  occasionReminders: true,
};

/** The form as filled from `saved`, with `change` made in it. */
const edited = (change: Partial<ProfileSettings> = {}): ProfileSettings => ({
  ...saved,
  ...change,
});

describe('profileSettings', () => {
  it('reads a profile the way the form edits it, privacy settings alongside the rest', () => {
    expect(
      profileSettings({
        username: 'alice',
        image: PHOTO,
        bio: 'I collect mugs.',
        defaultCurrency: 'EUR',
        privacy: { searchable: false, whoCanInvite: 'friends', profileVisibility: 'friends' },
      })
    ).toEqual({
      username: 'alice',
      image: PHOTO,
      bio: 'I collect mugs.',
      defaultCurrency: 'EUR',
      searchable: false,
      whoCanInvite: 'friends',
      profileVisibility: 'friends',
      occasionReminders: true,
    });
  });

  it("reads what's missing as the model's defaults: no photo, no bio, USD, public", () => {
    expect(profileSettings({ username: null, image: '', bio: null, privacy: null })).toEqual({
      username: '',
      image: null,
      bio: '',
      defaultCurrency: 'USD',
      searchable: true,
      whoCanInvite: 'everyone',
      profileVisibility: 'everyone',
      occasionReminders: true,
    });
    expect(profileSettings({ privacy: { searchable: null } }).searchable).toBe(true);
  });

  it('uppercases the currency', () => {
    expect(profileSettings({ defaultCurrency: 'pln' }).defaultCurrency).toBe('PLN');
  });
});

describe('profileChanges', () => {
  it('is empty when nothing changed', () => {
    expect(profileChanges(edited(), saved)).toEqual({});
  });

  it('sends occasion reminders as their one notification setting, by event and channel', () => {
    expect(profileChanges(edited({ occasionReminders: false }), saved)).toEqual({
      notificationPrefs: { occasion_reminder: { inApp: false } },
    });
    expect(settingChange('occasionReminders', true)).toEqual({
      notificationPrefs: { occasion_reminder: { inApp: true } },
    });
  });

  it('reads occasion reminders from the saved setting, on unless turned off', () => {
    expect(
      profileSettings({ notificationPrefs: { occasion_reminder: { inApp: false } } })
        .occasionReminders
    ).toBe(false);
    expect(
      profileSettings({ notificationPrefs: { occasion_reminder: {} } }).occasionReminders
    ).toBe(true);
  });

  // regression: the settings page sent the whole `privacy` object on every
  // save, as the form loaded it, so a save from a tab opened before the profile
  // was made friends-only wrote `profileVisibility: everyone` back over it.
  it.each([
    ['searchable', { searchable: false }],
    ['whoCanInvite', { whoCanInvite: 'nobody' }],
    ['profileVisibility', { profileVisibility: 'friends' }],
  ] as const)('regression: sends only the privacy setting changed (%s)', (_, change) => {
    expect(profileChanges(edited(change), saved)).toEqual({ privacy: change });
  });

  it('regression: a save of anything else sends no privacy settings at all', () => {
    expect(profileChanges(edited({ bio: 'Mugs and plants.' }), saved)).toEqual({
      bio: 'Mugs and plants.',
    });
  });

  it('sends several changes together, privacy ones under `privacy`', () => {
    expect(
      profileChanges(
        edited({
          username: 'alice2',
          image: NEW_PHOTO,
          defaultCurrency: 'GBP',
          searchable: false,
          profileVisibility: 'friends',
        }),
        saved
      )
    ).toEqual({
      username: 'alice2',
      image: NEW_PHOTO,
      defaultCurrency: 'GBP',
      privacy: { searchable: false, profileVisibility: 'friends' },
    });
  });

  it('sends a removed photo as empty, and a cleared bio as empty', () => {
    expect(profileChanges(edited({ image: null, bio: '' }), saved)).toEqual({
      image: '',
      bio: '',
    });
  });

  it("doesn't count what the server would store as it already is", () => {
    expect(
      profileChanges(
        edited({ username: 'Alice', bio: '  I collect mugs.  ', defaultCurrency: 'eur' }),
        saved
      )
    ).toEqual({});
    // No photo is null or empty alike.
    expect(profileChanges(edited({ image: '' }), { ...saved, image: null })).toEqual({});
  });

  it('sends a changed username lowercased and a changed bio trimmed', () => {
    expect(profileChanges(edited({ username: 'Alice2', bio: ' Plants. ' }), saved)).toEqual({
      username: 'alice2',
      bio: 'Plants.',
    });
  });
});

describe('rebaseProfileForm', () => {
  it('after a save, takes the profile as saved, including what another tab changed', () => {
    const sent = edited({ searchable: false });
    // Another tab made the profile friends-only before this save landed.
    const stored = { ...saved, searchable: false, profileVisibility: 'friends' as const };

    const form = rebaseProfileForm(sent, sent, stored);

    expect(form).toEqual(stored);
    expect(profileChanges(form, stored)).toEqual({});
  });

  it('keeps an edit made while the save was in flight', () => {
    const sent = edited({ bio: 'Plants.' });
    const now = { ...sent, image: NEW_PHOTO }; // an upload finished meanwhile
    const stored = { ...saved, bio: 'Plants.' };

    const form = rebaseProfileForm(now, sent, stored);

    expect(form).toEqual({ ...stored, image: NEW_PHOTO });
    expect(profileChanges(form, stored)).toEqual({ image: NEW_PHOTO });
  });

  it('on a reload, refreshes every untouched field and keeps the ones being edited', () => {
    const form = edited({ bio: 'Plants.', whoCanInvite: 'friends' });
    const reloaded = {
      ...saved,
      bio: 'Changed elsewhere',
      whoCanInvite: 'nobody' as const,
      profileVisibility: 'friends' as const,
    };

    expect(rebaseProfileForm(form, saved, reloaded)).toEqual({
      ...reloaded,
      bio: 'Plants.',
      whoCanInvite: 'friends',
    });
  });

  // An edit `profileChanges` wouldn't send isn't one to keep either: kept, it
  // would hold back the other tab's value and then send its own over it.
  it('takes the stored value over an edit the server would store as nothing', () => {
    const form = edited({ bio: 'I collect mugs. ', username: 'ALICE', defaultCurrency: 'eur' });
    const reloaded = { ...saved, bio: 'Changed elsewhere', defaultCurrency: 'GBP' };

    const next = rebaseProfileForm(form, saved, reloaded);

    expect(next).toEqual(reloaded);
    expect(profileChanges(next, reloaded)).toEqual({});
  });
});

describe('settingChange', () => {
  it('sends the one setting as profileChanges would, a privacy one under privacy', () => {
    expect(settingChange('searchable', false)).toEqual({ privacy: { searchable: false } });
    expect(settingChange('whoCanInvite', 'nobody')).toEqual({
      privacy: { whoCanInvite: 'nobody' },
    });
    expect(settingChange('profileVisibility', 'friends')).toEqual({
      privacy: { profileVisibility: 'friends' },
    });
    expect(settingChange('defaultCurrency', 'pln')).toEqual({ defaultCurrency: 'PLN' });
    expect(settingChange('image', NEW_PHOTO)).toEqual({ image: NEW_PHOTO });
    expect(settingChange('username', 'Alice')).toEqual({ username: 'alice' });
    expect(settingChange('bio', ' Mugs. ')).toEqual({ bio: 'Mugs.' });
  });

  it('clears the photo with an empty string, as profileChanges does', () => {
    expect(settingChange('image', null)).toEqual({ image: '' });
  });
});
