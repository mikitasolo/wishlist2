import { describe, it, expect } from 'vitest';
import {
  notificationOptInFilter,
  notificationPrefsSchema,
  notificationPrefWrites,
  wantsNotification,
} from '@/lib/utils/notificationPrefs';

describe('wantsNotification', () => {
  it('reads a setting never saved as its default (occasion reminders: on)', () => {
    expect(wantsNotification(undefined, 'occasion_reminder', 'inApp')).toBe(true);
    expect(wantsNotification({}, 'occasion_reminder', 'inApp')).toBe(true);
    expect(wantsNotification({ occasion_reminder: {} }, 'occasion_reminder', 'inApp')).toBe(true);
  });

  it('honours a saved setting', () => {
    expect(
      wantsNotification({ occasion_reminder: { inApp: false } }, 'occasion_reminder', 'inApp')
    ).toBe(false);
  });
});

describe('notificationOptInFilter', () => {
  it('matches everyone but those who turned an on-by-default setting off', () => {
    expect(notificationOptInFilter('occasion_reminder', 'inApp')).toEqual({
      'notificationPrefs.occasion_reminder.inApp': { $ne: false },
    });
  });
});

describe('notificationPrefWrites', () => {
  it('writes each setting sent by its own path, and nothing else', () => {
    expect(notificationPrefWrites({ occasion_reminder: { inApp: false } })).toEqual({
      'notificationPrefs.occasion_reminder.inApp': false,
    });
    expect(notificationPrefWrites({ occasion_reminder: {} })).toEqual({});
    expect(notificationPrefWrites(undefined)).toEqual({});
  });
});

describe('notificationPrefsSchema', () => {
  it('takes booleans per event and channel', () => {
    expect(notificationPrefsSchema.parse({ occasion_reminder: { inApp: false } })).toEqual({
      occasion_reminder: { inApp: false },
    });
  });

  it('refuses an unknown event or channel, or a non-boolean', () => {
    expect(notificationPrefsSchema.safeParse({ follow: { inApp: false } }).success).toBe(false);
    expect(notificationPrefsSchema.safeParse({ occasion_reminder: { email: false } }).success).toBe(
      false
    );
    expect(notificationPrefsSchema.safeParse({ occasion_reminder: { inApp: 'no' } }).success).toBe(
      false
    );
  });
});
