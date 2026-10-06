import { describe, it, expect } from 'vitest';
import { NOTIFICATION_TYPES } from '@/lib/utils/notifications';
import {
  channelsOf,
  eventsOn,
  notificationDefault,
  notificationEventOf,
  notificationOptInFilter,
  notificationPrefsSchema,
  notificationPrefWrites,
  wantsNotification,
} from '@/lib/utils/notificationPrefs';

describe('the settings table (operator decision, 2026-10-05)', () => {
  it('gives every notification type a setting', () => {
    for (const type of NOTIFICATION_TYPES) expect(() => notificationEventOf(type)).not.toThrow();
    expect(notificationEventOf('role_changed')).toBe('access_changed');
    expect(notificationEventOf('removed_from_wishlist')).toBe('access_changed');
  });

  it('keeps an in-app switch on by default for every event', () => {
    expect(eventsOn('inApp')).toHaveLength(12);
    for (const event of eventsOn('inApp')) expect(notificationDefault(event, 'inApp')).toBe(true);
  });

  it('defaults email on for invitations, occasion reminders, join requests, link joins and proposals, off for the rest', () => {
    expect(
      Object.fromEntries(eventsOn('email').map((e) => [e, notificationDefault(e, 'email')]))
    ).toEqual({
      wishlist_invite: true,
      occasion_reminder: true,
      // WIS-345: the operator's decision, off unless turned on.
      birthday_reminder: false,
      // WIS-344: once a year, three weeks before your own birthday.
      birthday_nudge: true,
      // WIS-324: the operator's decision, off unless turned on.
      wishlist_ask: false,
      asked_list_made: false,
      join_request: true,
      // WIS-337: at most one a day per list per owner (`claimDailyListEmail`).
      link_join: true,
      proposal: true,
      access_changed: false,
      invite_accepted: false,
      proposal_approved: false,
    });
  });

  it('offers the birthday nudge by email only: its in-app side is a Needs you row (WIS-344)', () => {
    expect(channelsOf('birthday_nudge')).toEqual(['email']);
    expect(wantsNotification(undefined, 'birthday_nudge', 'email')).toBe(true);
    expect(wantsNotification({ birthday_nudge: { email: false } }, 'birthday_nudge', 'email')).toBe(
      false
    );
  });

  it('offers no email for a new follower', () => {
    expect(channelsOf('follow')).toEqual(['inApp']);
    expect(wantsNotification({ follow: { email: true } } as never, 'follow', 'email')).toBe(false);
  });
});

describe('wantsNotification', () => {
  it('reads a setting never saved as its default', () => {
    expect(wantsNotification(undefined, 'occasion_reminder', 'inApp')).toBe(true);
    expect(wantsNotification({}, 'occasion_reminder', 'email')).toBe(true);
    expect(wantsNotification({ occasion_reminder: {} }, 'occasion_reminder', 'inApp')).toBe(true);
    expect(wantsNotification({}, 'invite_accepted', 'email')).toBe(false);
  });

  it('honours a saved setting', () => {
    expect(
      wantsNotification({ occasion_reminder: { inApp: false } }, 'occasion_reminder', 'inApp')
    ).toBe(false);
    expect(
      wantsNotification({ invite_accepted: { email: true } }, 'invite_accepted', 'email')
    ).toBe(true);
  });
});

describe('notificationOptInFilter', () => {
  it('matches everyone but those who turned an on-by-default setting off', () => {
    expect(notificationOptInFilter('occasion_reminder', 'inApp')).toEqual({
      'notificationPrefs.occasion_reminder.inApp': { $ne: false },
    });
  });

  it('matches only those who turned an off-by-default setting on', () => {
    expect(notificationOptInFilter('access_changed', 'email')).toEqual({
      'notificationPrefs.access_changed.email': true,
    });
  });

  it('matches nobody on a channel the event is not offered on', () => {
    expect(notificationOptInFilter('follow', 'email')).toEqual({ _id: { $exists: false } });
  });
});

describe('notificationPrefWrites', () => {
  it('writes each setting sent by its own path, and nothing else', () => {
    expect(
      notificationPrefWrites({ occasion_reminder: { inApp: false }, proposal: { email: false } })
    ).toEqual({
      'notificationPrefs.occasion_reminder.inApp': false,
      'notificationPrefs.proposal.email': false,
    });
    expect(notificationPrefWrites({ occasion_reminder: {} })).toEqual({});
    expect(notificationPrefWrites(undefined)).toEqual({});
  });

  it('never writes a channel the event is not offered on', () => {
    expect(notificationPrefWrites({ follow: { email: true } } as never)).toEqual({});
  });
});

describe('notificationPrefsSchema', () => {
  it('takes booleans per event and channel', () => {
    expect(
      notificationPrefsSchema.parse({
        occasion_reminder: { inApp: false, email: false },
        follow: { inApp: false },
      })
    ).toEqual({ occasion_reminder: { inApp: false, email: false }, follow: { inApp: false } });
  });

  it('refuses an unknown event or channel, an email for a follower, or a non-boolean', () => {
    expect(notificationPrefsSchema.safeParse({ bookings: { inApp: false } }).success).toBe(false);
    expect(notificationPrefsSchema.safeParse({ role_changed: { inApp: false } }).success).toBe(
      false
    );
    expect(notificationPrefsSchema.safeParse({ proposal: { sms: true } }).success).toBe(false);
    expect(notificationPrefsSchema.safeParse({ follow: { email: true } }).success).toBe(false);
    expect(notificationPrefsSchema.safeParse({ occasion_reminder: { inApp: 'no' } }).success).toBe(
      false
    );
  });
});
