'use client';

import type { ReactNode } from 'react';
import Switch from '@/components/Switch';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENT_KEYS,
  NOTIFICATION_EVENTS,
  type NotificationChannel,
} from '@/lib/utils/notificationPrefs';
import { notificationSettingKey, type NotificationSettingKey } from '@/lib/utils/profileSettings';

const CHANNEL_LABELS: Record<NotificationChannel, string> = { inApp: 'In app', email: 'Email' };

/**
 * Settings → Notifications' grid (WIS-321): one row per event, from the one
 * table (`NOTIFICATION_EVENTS`), with a switch for each channel it's offered
 * on: In app (Activity) and Email. A channel an event isn't offered on (a new
 * follower's email) shows a dash. Each switch saves on its own as it's
 * changed (the page's `changeInstant`), and its save note sits by the row's
 * name.
 */
export default function NotificationSettings({
  values,
  onChange,
  note,
}: {
  values: Record<NotificationSettingKey, boolean>;
  onChange: (key: NotificationSettingKey, on: boolean) => void;
  /** The save note of one switch (`SaveNote`). */
  note: (key: NotificationSettingKey) => ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-5 sm:gap-x-6">
      <span />
      {NOTIFICATION_CHANNELS.map((channel) => (
        <span
          key={channel}
          aria-hidden="true"
          className="w-11 text-center text-xs font-medium text-muted-foreground"
        >
          {CHANNEL_LABELS[channel]}
        </span>
      ))}
      {NOTIFICATION_EVENT_KEYS.map((event) => {
        const { label, description } = NOTIFICATION_EVENTS[event];
        return (
          <div key={event} role="group" aria-label={label} className="contents">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3">
                <p className="text-sm font-medium text-foreground">{label}</p>
                {NOTIFICATION_CHANNELS.map((channel) => {
                  const key = notificationSettingKey(event, channel);
                  return key ? <span key={channel}>{note(key)}</span> : null;
                })}
              </div>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            {NOTIFICATION_CHANNELS.map((channel) => {
              const key = notificationSettingKey(event, channel);
              return (
                <div key={channel} className="flex w-11 justify-center">
                  {key ? (
                    <Switch
                      label={`${label}: ${CHANNEL_LABELS[channel].toLowerCase()}`}
                      checked={values[key]}
                      onChange={(on) => onChange(key, on)}
                    />
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">{`No ${CHANNEL_LABELS[channel].toLowerCase()}`}</span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
