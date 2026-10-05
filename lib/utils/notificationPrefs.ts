import { z } from 'zod';
import type { NotificationType } from '@/lib/utils/notifications';

/**
 * Per-user notification preferences (`User.notificationPrefs`), keyed by event
 * (a notification type) and then by channel: `{ occasion_reminder: { inApp:
 * false } }`. Each setting is stored, sent and written on its own dotted path
 * (`notificationPrefs.occasion_reminder.inApp`), so a save of one never writes
 * back another.
 *
 * Only the events listed in `CONFIGURABLE_NOTIFICATIONS` can be turned off,
 * and only on the channels in `NOTIFICATION_CHANNELS`. Adding email delivery
 * (WIS-321) is adding `'email'` to the channels (with its default per event)
 * and more events to the list: the shape stays the same.
 *
 * A missing setting reads as its default (`NOTIFICATION_PREF_DEFAULTS`), as on
 * an account saved before it existed; every reader goes through
 * `wantsNotification`, and a query through `notificationOptInFilter`.
 */

/** Where a notification can be delivered. In-app is the Activity feed. */
export const NOTIFICATION_CHANNELS = ['inApp'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** The notification types a person can turn off, each per channel. */
export const CONFIGURABLE_NOTIFICATIONS = [
  'occasion_reminder',
] as const satisfies readonly NotificationType[];
export type ConfigurableNotification = (typeof CONFIGURABLE_NOTIFICATIONS)[number];

export type NotificationPrefs = {
  [E in ConfigurableNotification]?: { [C in NotificationChannel]?: boolean };
};

/** What each setting is until it's changed. */
export const NOTIFICATION_PREF_DEFAULTS: {
  [E in ConfigurableNotification]: { [C in NotificationChannel]: boolean };
} = {
  occasion_reminder: { inApp: true },
};

/** The stored path of one setting, e.g. `notificationPrefs.occasion_reminder.inApp`. */
export function notificationPrefPath(
  event: ConfigurableNotification,
  channel: NotificationChannel
): `notificationPrefs.${ConfigurableNotification}.${NotificationChannel}` {
  return `notificationPrefs.${event}.${channel}`;
}

/** Whether someone with `prefs` gets `event` on `channel`: its setting, or its default. */
export function wantsNotification(
  prefs: NotificationPrefs | null | undefined,
  event: ConfigurableNotification,
  channel: NotificationChannel
): boolean {
  const value = prefs?.[event]?.[channel];
  return typeof value === 'boolean' ? value : NOTIFICATION_PREF_DEFAULTS[event][channel];
}

/**
 * A `User` filter matching the people who get `event` on `channel`: those who
 * set it on, and, for a setting on by default, those who never set it.
 */
export function notificationOptInFilter(
  event: ConfigurableNotification,
  channel: NotificationChannel
): Record<string, unknown> {
  const path = notificationPrefPath(event, channel);
  return NOTIFICATION_PREF_DEFAULTS[event][channel] ? { [path]: { $ne: false } } : { [path]: true };
}

/**
 * The dotted-path writes for the settings in `prefs`, one per setting sent:
 * never the whole object, which would write back settings it wasn't sent.
 */
export function notificationPrefWrites(
  prefs: NotificationPrefs | undefined
): Record<string, boolean> {
  const writes: Record<string, boolean> = {};
  if (!prefs) return writes;
  for (const event of CONFIGURABLE_NOTIFICATIONS) {
    for (const channel of NOTIFICATION_CHANNELS) {
      const value = prefs[event]?.[channel];
      if (typeof value === 'boolean') writes[notificationPrefPath(event, channel)] = value;
    }
  }
  return writes;
}

const channelsSchema = z
  .object(
    Object.fromEntries(NOTIFICATION_CHANNELS.map((c) => [c, z.boolean().optional()])) as Record<
      NotificationChannel,
      z.ZodOptional<z.ZodBoolean>
    >
  )
  .strict();

/**
 * What a save may send (`PATCH /api/users/me`'s `notificationPrefs`): any of
 * the settings, each a boolean. An unknown event or channel is refused, not
 * dropped, so a client that sends one it doesn't know learns of it.
 */
export const notificationPrefsSchema = z
  .object(
    Object.fromEntries(
      CONFIGURABLE_NOTIFICATIONS.map((e) => [e, channelsSchema.optional()])
    ) as Record<ConfigurableNotification, z.ZodOptional<typeof channelsSchema>>
  )
  .strict();
