import { describe, it, expect } from 'vitest';
import {
  birthdayAudience,
  birthdayField,
  birthdayFromParts,
  birthdayParts,
  canSeeBirthday,
  formatBirthday,
  isCompleteBirthday,
  normalizeBirthday,
  visibleBirthday,
  type BirthdayViewer,
  type BirthdayVisibility,
} from '@/lib/utils/birthday';
import { birthdaySchema, updateProfileSchema } from '@/lib/validations';

type Setting = BirthdayVisibility | undefined;
type ProfileVis = 'everyone' | 'friends' | undefined;

// Every birthday setting (unset = its default, friends) × every profile
// visibility (unset = everyone) × every relationship, and who sees it. The
// query form is pinned to the same table in test/api/birthdayVisibleFilter.test.ts.
const BIRTHDAY_TABLE: [Setting, ProfileVis, BirthdayViewer, boolean][] = [];
const settings: Setting[] = ['nobody', 'friends', 'everyone', undefined];
const profiles: ProfileVis[] = ['everyone', 'friends', undefined];
const viewers: BirthdayViewer[] = ['self', 'friend', 'other'];
for (const s of settings) {
  for (const p of profiles) {
    for (const v of viewers) {
      const effective = s ?? 'friends';
      const expected =
        v === 'self' ||
        (v === 'friend' && effective !== 'nobody') ||
        (v === 'other' && effective === 'everyone' && p !== 'friends');
      BIRTHDAY_TABLE.push([s, p, v, expected]);
    }
  }
}

describe('canSeeBirthday', () => {
  it.each(BIRTHDAY_TABLE)(
    'birthdayVisibility %s, profileVisibility %s, viewer %s → %s',
    (birthdayVisibility, profileVisibility, viewer, expected) => {
      expect(canSeeBirthday({ birthdayVisibility, profileVisibility }, viewer)).toBe(expected);
    }
  );

  it('reads no privacy settings at all as the defaults: friends see it, others don’t', () => {
    expect(canSeeBirthday(null, 'friend')).toBe(true);
    expect(canSeeBirthday(undefined, 'other')).toBe(false);
  });
});

describe('birthdayAudience', () => {
  it('is the narrower of the birthday setting and the profile’s visibility', () => {
    expect(birthdayAudience({ birthdayVisibility: 'everyone' })).toBe('everyone');
    expect(birthdayAudience({ birthdayVisibility: 'everyone', profileVisibility: 'friends' })).toBe(
      'friends'
    );
    expect(birthdayAudience({ birthdayVisibility: 'nobody', profileVisibility: 'everyone' })).toBe(
      'nobody'
    );
    expect(birthdayAudience({})).toBe('friends');
  });
});

describe('visibleBirthday / birthdayField', () => {
  const hidden = { birthday: '2000-03-14', privacy: { birthdayVisibility: 'nobody' as const } };
  const none = { birthday: null, privacy: { birthdayVisibility: 'everyone' as const } };

  it('gives an excluded viewer the same answer for a hidden birthday as for none', () => {
    for (const viewer of ['friend', 'other'] as const) {
      expect(visibleBirthday(hidden, viewer)).toBeUndefined();
      expect(birthdayField(hidden, viewer)).toEqual({});
      expect(birthdayField(hidden, viewer)).toEqual(birthdayField(none, viewer));
    }
  });

  it('gives an admitted viewer the birthday, and always the person themselves', () => {
    expect(birthdayField(hidden, 'self')).toEqual({ birthday: '2000-03-14' });
    expect(
      birthdayField(
        { birthday: '2000-03-14', privacy: { birthdayVisibility: 'friends' } },
        'friend'
      )
    ).toEqual({ birthday: '2000-03-14' });
    expect(birthdayField({ birthday: '', privacy: null }, 'self')).toEqual({});
  });
});

describe('normalizeBirthday', () => {
  it('drops any year, keeping the day and month on the placeholder year', () => {
    expect(normalizeBirthday('1990-03-14')).toBe('2000-03-14');
    expect(normalizeBirthday('2000-03-14')).toBe('2000-03-14');
  });

  it('allows Feb 29, whatever year it came with', () => {
    expect(normalizeBirthday('1991-02-29')).toBe('2000-02-29');
  });

  it('refuses what isn’t a real day and month', () => {
    expect(normalizeBirthday('1990-02-30')).toBeNull();
    expect(normalizeBirthday('1990-13-01')).toBeNull();
    expect(normalizeBirthday('03-14')).toBeNull();
    expect(normalizeBirthday('')).toBeNull();
  });
});

describe('birthday form helpers', () => {
  it('splits a birthday into its month and day, a half-picked one too', () => {
    expect(birthdayParts('2000-03-14')).toEqual({ month: '03', day: '14' });
    expect(birthdayParts('2000-03-')).toEqual({ month: '03', day: '' });
    expect(birthdayParts('')).toEqual({ month: '', day: '' });
    expect(birthdayParts(null)).toEqual({ month: '', day: '' });
  });

  it('builds one from a month and day, none from neither', () => {
    expect(birthdayFromParts('03', '14')).toBe('2000-03-14');
    expect(birthdayFromParts('', '14')).toBe('2000--14');
    expect(birthdayFromParts('', '')).toBe('');
  });

  it('holds a half-picked birthday back from a save', () => {
    expect(isCompleteBirthday('')).toBe(true);
    expect(isCompleteBirthday('2000-02-29')).toBe(true);
    expect(isCompleteBirthday('2000-03-')).toBe(false);
    expect(isCompleteBirthday('2000--14')).toBe(false);
  });
});

describe('formatBirthday', () => {
  it('shows the month and day, never a year', () => {
    expect(formatBirthday('2000-03-14', 'en-US')).toBe('March 14');
    expect(formatBirthday('2000-02-29', 'en-US')).toBe('February 29');
    expect(formatBirthday('2000-03-14', 'en-US')).not.toMatch(/2000/);
  });

  it('gives nothing for a value that isn’t a birthday', () => {
    expect(formatBirthday('nope', 'en-US')).toBe('');
  });
});

describe('birthdaySchema', () => {
  it('stores the day and month only, Feb 29 included', () => {
    expect(birthdaySchema.parse('1990-03-14')).toBe('2000-03-14');
    expect(birthdaySchema.parse('1991-02-29')).toBe('2000-02-29');
  });

  it('refuses an impossible day', () => {
    expect(birthdaySchema.safeParse('1990-04-31').success).toBe(false);
    expect(birthdaySchema.safeParse('March 14').success).toBe(false);
  });

  it('takes a birthday, null to clear it, and its visibility in a profile update', () => {
    expect(updateProfileSchema.parse({ birthday: '1985-12-01' })).toEqual({
      birthday: '2000-12-01',
    });
    expect(updateProfileSchema.parse({ birthday: null })).toEqual({ birthday: null });
    expect(updateProfileSchema.parse({ privacy: { birthdayVisibility: 'nobody' } })).toEqual({
      privacy: { birthdayVisibility: 'nobody' },
    });
    expect(
      updateProfileSchema.safeParse({ privacy: { birthdayVisibility: 'public' } }).success
    ).toBe(false);
  });
});
