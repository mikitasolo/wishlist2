import { describe, it, expect } from 'vitest';
import {
  NOTIFICATION_SETTINGS,
  profileChanges,
  profileSettings,
  rebaseProfileForm,
  settingChange,
  type NotificationSettingKey,
  type ProfileSettings,
} from '@/lib/utils/profileSettings';
import { notificationDefault } from '@/lib/utils/notificationPrefs';

// Every notification switch at its default, as an account that never set one reads.
const NOTIFY_DEFAULTS = Object.fromEntries(
  NOTIFICATION_SETTINGS.map((s) => [s.key, notificationDefault(s.event, s.channel)])
) as Record<NotificationSettingKey, boolean>;

const PHOTO = 'https://store.public.blob.vercel-storage.com/uploads/u1/me.webp';
const NEW_PHOTO = 'https://store.public.blob.vercel-storage.com/uploads/u1/new.webp';

// The profile as the settings form was filled from it.
const saved: ProfileSettings = {
  username: 'alice',
  image: PHOTO,
  bio: 'I collect mugs.',
  birthday: '2000-03-14',
  defaultCurrency: 'EUR',
  searchable: true,
  whoCanInvite: 'everyone',
  profileVisibility: 'everyone',
  birthdayVisibility: 'friends',
  ...NOTIFY_DEFAULTS,
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
        birthday: '2000-02-29',
        defaultCurrency: 'EUR',
        privacy: {
          searchable: false,
          whoCanInvite: 'friends',
          profileVisibility: 'friends',
          birthdayVisibility: 'everyone',
        },
      })
    ).toEqual({
      username: 'alice',
      image: PHOTO,
      bio: 'I collect mugs.',
      birthday: '2000-02-29',
      defaultCurrency: 'EUR',
      searchable: false,
      whoCanInvite: 'friends',
      profileVisibility: 'friends',
      birthdayVisibility: 'everyone',
      ...NOTIFY_DEFAULTS,
    });
  });

  it("reads what's missing as the model's defaults: no photo, no bio, no birthday, USD, public, birthday to friends", () => {
    expect(
      profileSettings({ username: null, image: '', bio: null, birthday: null, privacy: null })
    ).toEqual({
      username: '',
      image: null,
      bio: '',
      birthday: '',
      defaultCurrency: 'USD',
      searchable: true,
      whoCanInvite: 'everyone',
      profileVisibility: 'everyone',
      birthdayVisibility: 'friends',
      ...NOTIFY_DEFAULTS,
    });
    expect(profileSettings({ privacy: { searchable: null } }).searchable).toBe(true);
  });

  it('reads a birthday stored with a real year as its day and month', () => {
    expect(profileSettings({ birthday: '1990-03-14' }).birthday).toBe('2000-03-14');
    expect(profileSettings({ birthday: 'nonsense' }).birthday).toBe('');
  });

  it('uppercases the currency', () => {
    expect(profileSettings({ defaultCurrency: 'pln' }).defaultCurrency).toBe('PLN');
  });
});

describe('profileChanges', () => {
  it('is empty when nothing changed', () => {
    expect(profileChanges(edited(), saved)).toEqual({});
  });

  it('sends a changed notification switch as its one setting, by event and channel', () => {
    expect(profileChanges(edited({ 'notify.occasion_reminder.inApp': false }), saved)).toEqual({
      notificationPrefs: { occasion_reminder: { inApp: false } },
    });
    expect(settingChange('notify.join_request.email', false)).toEqual({
      notificationPrefs: { join_request: { email: false } },
    });
  });

  it('sends only the switches changed, several of one event together', () => {
    expect(
      profileChanges(
        edited({
          'notify.proposal.inApp': false,
          'notify.proposal.email': false,
          'notify.invite_accepted.email': true,
        }),
        saved
      )
    ).toEqual({
      notificationPrefs: {
        proposal: { inApp: false, email: false },
        invite_accepted: { email: true },
      },
    });
  });

  it('reads each switch from its saved setting, or its default', () => {
    const settings = profileSettings({
      notificationPrefs: { occasion_reminder: { inApp: false }, access_changed: { email: true } },
    });
    expect(settings['notify.occasion_reminder.inApp']).toBe(false);
    expect(settings['notify.occasion_reminder.email']).toBe(true);
    expect(settings['notify.access_changed.email']).toBe(true);
    expect(settings['notify.invite_accepted.email']).toBe(false);
  });

  it('has no switch for a channel an event is not offered on (a new follower’s email)', () => {
    expect(NOTIFICATION_SETTINGS.map((s) => s.key)).toContain('notify.follow.inApp');
    expect(NOTIFICATION_SETTINGS.map((s) => s.key)).not.toContain('notify.follow.email');
    expect(Object.keys(profileSettings({}))).not.toContain('notify.follow.email');
  });

  // regression: the settings page sent the whole `privacy` object on every
  // save, as the form loaded it, so a save from a tab opened before the profile
  // was made friends-only wrote `profileVisibility: everyone` back over it.
  it.each([
    ['searchable', { searchable: false }],
    ['whoCanInvite', { whoCanInvite: 'nobody' }],
    ['profileVisibility', { profileVisibility: 'friends' }],
    ['birthdayVisibility', { birthdayVisibility: 'nobody' }],
  ] as const)('regression: sends only the privacy setting changed (%s)', (_, change) => {
    expect(profileChanges(edited(change), saved)).toEqual({ privacy: change });
  });

  it('sends a changed birthday on its own, and a cleared one as null', () => {
    expect(profileChanges(edited({ birthday: '2000-02-29' }), saved)).toEqual({
      birthday: '2000-02-29',
    });
    expect(profileChanges(edited({ birthday: '' }), saved)).toEqual({ birthday: null });
    expect(profileChanges(edited({ bio: 'Mugs.' }), saved)).not.toHaveProperty('birthday');
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
    expect(settingChange('birthdayVisibility', 'everyone')).toEqual({
      privacy: { birthdayVisibility: 'everyone' },
    });
    expect(settingChange('birthday', '')).toEqual({ birthday: null });
  });

  it('clears the photo with an empty string, as profileChanges does', () => {
    expect(settingChange('image', null)).toEqual({ image: '' });
  });
});
