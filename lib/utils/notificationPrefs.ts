import { z } from 'zod';
import type { NotificationType } from '@/lib/utils/notifications';

/**
 * Per-user notification preferences (`User.notificationPrefs`), keyed by event
 * and then by channel: `{ join_request: { email: false } }`. Each setting is
 * stored, sent and written on its own dotted path
 * (`notificationPrefs.join_request.email`), so a save of one never writes
 * back another.
 *
 * `NOTIFICATION_EVENTS` is the one table (the operator's decision of
 * 2026-10-05, WIS-321): which notification types each event covers, which
 * channels it's offered on, and each channel's default. An event is offered
 * on a channel only if the table gives it a default there: `follow` has no
 * email (anyone can follow anyone, so an email would be a spam vector).
 *
 * A missing setting reads as its default, as on an account saved before it
 * existed, so a default applies to existing accounts with no migration; every
 * reader goes through `wantsNotification`, and a query through
 * `notificationOptInFilter` / `notificationOptOutFilter`.
 */

/** Where a notification can be delivered. In-app is the Activity feed. */
export const NOTIFICATION_CHANNELS = ['inApp', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

interface EventSpec {
  /** The notification types this setting covers. */
  types: readonly NotificationType[];
  /** Each channel it's offered on, with its default; a channel left out isn't offered. */
  defaults: Partial<Record<NotificationChannel, boolean>>;
  /** Settings → Notifications' name for it, and the unsubscribe page's. */
  label: string;
  description: string;
}

export const NOTIFICATION_EVENTS = {
  wishlist_invite: {
    types: ['wishlist_invite'],
    defaults: { inApp: true, email: true },
    label: 'Invitations',
    description: 'When someone invites you to a wishlist.',
  },
  occasion_reminder: {
    types: ['occasion_reminder'],
    defaults: { inApp: true, email: true },
    label: 'Occasion reminders',
    description: 'A week before the occasion on a list you’re a member of.',
  },
  join_request: {
    types: ['join_request'],
    defaults: { inApp: true, email: true },
    label: 'Requests to join',
    description: 'When someone asks to join a list you own.',
  },
  proposal: {
    types: ['proposal'],
    defaults: { inApp: true, email: true },
    label: 'Proposals to review',
    description:
      'When someone proposes an item for a list you own. At most one email a day per list.',
  },
  access_changed: {
    types: ['role_changed', 'removed_from_wishlist'],
    defaults: { inApp: true, email: false },
    label: 'Changes to your access',
    description: 'When you’re no longer an owner of a list, or you’re taken off one.',
  },
  invite_accepted: {
    types: ['invite_accepted'],
    defaults: { inApp: true, email: false },
    label: 'Invitations accepted',
    description: 'When someone accepts an invitation you sent.',
  },
  proposal_approved: {
    types: ['proposal_approved'],
    defaults: { inApp: true, email: false },
    label: 'Proposals approved',
    description: 'When an owner adds an item you proposed to their list.',
  },
  follow: {
    types: ['follow'],
    defaults: { inApp: true },
    label: 'New followers',
    description: 'When someone follows you.',
  },
} as const satisfies Record<string, EventSpec>;

/** A setting's event: one row of Settings → Notifications. */
export type NotificationEvent = keyof typeof NOTIFICATION_EVENTS;

/** The events, in the order Settings shows them. */
export const NOTIFICATION_EVENT_KEYS = Object.keys(NOTIFICATION_EVENTS) as NotificationEvent[];

export type NotificationPrefs = {
  [E in NotificationEvent]?: { [C in NotificationChannel]?: boolean };
};

const EVENT_OF_TYPE = new Map<NotificationType, NotificationEvent>(
  NOTIFICATION_EVENT_KEYS.flatMap((event) =>
    NOTIFICATION_EVENTS[event].types.map((type) => [type, event] as const)
  )
);

/** The setting a notification type is governed by. */
export function notificationEventOf(type: NotificationType): NotificationEvent {
  const event = EVENT_OF_TYPE.get(type);
  // Every type has a row (pinned by a test), so this only fires on a new type
  // added without one.
  if (!event) throw new Error(`Notification type ${type} has no setting`);
  return event;
}

/** Whether `event` is offered on `channel` at all. */
export function offersChannel(event: NotificationEvent, channel: NotificationChannel): boolean {
  return typeof notificationDefault(event, channel) === 'boolean';
}

/** The default of `event` on `channel`, or undefined when it isn't offered there. */
export function notificationDefault(
  event: NotificationEvent,
  channel: NotificationChannel
): boolean | undefined {
  return (NOTIFICATION_EVENTS[event].defaults as EventSpec['defaults'])[channel];
}

/** The channels `event` is offered on. */
export function channelsOf(event: NotificationEvent): NotificationChannel[] {
  return NOTIFICATION_CHANNELS.filter((channel) => offersChannel(event, channel));
}

/** The events offered on `channel`. */
export function eventsOn(channel: NotificationChannel): NotificationEvent[] {
  return NOTIFICATION_EVENT_KEYS.filter((event) => offersChannel(event, channel));
}

/** The stored path of one setting, e.g. `notificationPrefs.join_request.email`. */
export function notificationPrefPath(
  event: NotificationEvent,
  channel: NotificationChannel
): `notificationPrefs.${NotificationEvent}.${NotificationChannel}` {
  return `notificationPrefs.${event}.${channel}`;
}

/**
 * Whether someone with `prefs` gets `event` on `channel`: its setting, or its
 * default. Never on a channel the event isn't offered on, whatever is stored.
 */
export function wantsNotification(
  prefs: NotificationPrefs | null | undefined,
  event: NotificationEvent,
  channel: NotificationChannel
): boolean {
  const fallback = notificationDefault(event, channel);
  if (fallback === undefined) return false;
  const value = prefs?.[event]?.[channel];
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * A `User` filter matching the people who get `event` on `channel`: those who
 * set it on, and, for a setting on by default, those who never set it. Matches
 * nobody on a channel the event isn't offered on.
 */
export function notificationOptInFilter(
  event: NotificationEvent,
  channel: NotificationChannel
): Record<string, unknown> {
  const fallback = notificationDefault(event, channel);
  if (fallback === undefined) return { _id: { $exists: false } };
  const path = notificationPrefPath(event, channel);
  return fallback ? { [path]: { $ne: false } } : { [path]: true };
}

/**
 * The dotted-path writes for the settings in `prefs`, one per setting sent:
 * never the whole object, which would write back settings it wasn't sent.
 * Only offered settings are written (the schema refuses the rest anyway).
 */
export function notificationPrefWrites(
  prefs: NotificationPrefs | undefined
): Record<string, boolean> {
  const writes: Record<string, boolean> = {};
  if (!prefs) return writes;
  for (const event of NOTIFICATION_EVENT_KEYS) {
    for (const channel of channelsOf(event)) {
      const value = prefs[event]?.[channel];
      if (typeof value === 'boolean') writes[notificationPrefPath(event, channel)] = value;
    }
  }
  return writes;
}

/**
 * What a save may send (`PATCH /api/users/me`'s `notificationPrefs`): any of
 * the offered settings, each a boolean. An unknown event, or a channel the
 * event isn't offered on (`follow.email`), is refused, not dropped, so a
 * client that sends one it doesn't know learns of it.
 */
export const notificationPrefsSchema = z
  .object(
    Object.fromEntries(
      NOTIFICATION_EVENT_KEYS.map((event) => [
        event,
        z
          .object(Object.fromEntries(channelsOf(event).map((c) => [c, z.boolean().optional()])))
          .strict()
          .optional(),
      ])
    )
  )
  .strict() as unknown as z.ZodType<NotificationPrefs>;

/**
 * The mongoose schema of `User.notificationPrefs`, from the table: a Boolean
 * per offered setting, none with a default (see the top of this file).
 */
export function notificationPrefsMongooseShape(): Record<
  string,
  Record<string, { type: BooleanConstructor }>
> {
  return Object.fromEntries(
    NOTIFICATION_EVENT_KEYS.map((event) => [
      event,
      Object.fromEntries(channelsOf(event).map((c) => [c, { type: Boolean }])),
    ])
  );
}
