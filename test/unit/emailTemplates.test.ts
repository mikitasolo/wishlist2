import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SMTP_ENV_VARS } from '@/lib/env';
import { formatOccasionDay } from '@/lib/utils/occasion';
import { formatBirthday } from '@/lib/utils/birthday';
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_EVENT_KEYS,
  offersChannel,
  type NotificationEvent,
} from '@/lib/utils/notificationPrefs';
import { NOTIFICATION_EMAILS_BY_EVENT } from '@/lib/emailTemplates/notification';
import {
  EMAIL_FIXTURES,
  FIXTURE_BIRTHDAY,
  FIXTURE_OCCASION_DATE,
  FIXTURE_RECIPIENT,
  type EmailFixture,
} from '@/lib/emailTemplates/fixtures';

/**
 * Characterization of every email (WIS-375): each fixture's message exactly as
 * it reaches nodemailer (subject, HTML, text, headers) and as the console
 * transport prints it (recipient, subject, link). Recorded before
 * `lib/email.ts` was split into one template module per email, so the split
 * is pinned byte for byte; a deliberate copy change updates the snapshot in
 * the same diff (`npx vitest run -u`), where a reviewer sees it.
 */

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) };
});
vi.mock('nodemailer', () => ({ default: { createTransport } }));

/**
 * Dates are formatted in the process's locale (as the in-app row does), so
 * they're swapped for a placeholder: the snapshot holds on any machine.
 */
function withoutLocaleDates(value: string): string {
  return value
    .replaceAll(formatOccasionDay(FIXTURE_OCCASION_DATE), '<occasion day>')
    .replaceAll(formatBirthday(FIXTURE_BIRTHDAY), '<birthday>');
}

async function loadEmail(transport: 'smtp' | 'console') {
  vi.stubEnv('EMAIL_TRANSPORT', transport);
  if (transport === 'console') {
    for (const name of SMTP_ENV_VARS) vi.stubEnv(name, undefined);
  }
  vi.resetModules();
  return import('@/lib/email');
}

async function send(email: Awaited<ReturnType<typeof loadEmail>>, fixture: EmailFixture) {
  const to = FIXTURE_RECIPIENT.email;
  switch (fixture.template) {
    case 'magic_link':
      return email.sendMagicLinkEmail(to, `http://localhost:3000${fixture.magicLinkPath}`);
    case 'wishlist_invite':
      return email.sendWishlistInvitationEmail(to, fixture.details);
    case 'notification':
      return email.sendNotificationEmail(to, fixture.details);
    case 'birthday_nudge':
      return email.sendBirthdayNudgeEmail(to, fixture.details);
  }
}

let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', undefined);
  createTransport.mockClear();
  sendMail.mockReset();
  sendMail.mockResolvedValue({ accepted: [FIXTURE_RECIPIENT.email], rejected: [] });
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('one module per event', () => {
  it('holds each event module to exactly the types its event covers', () => {
    for (const [event, copies] of Object.entries(NOTIFICATION_EMAILS_BY_EVENT)) {
      expect(Object.keys(copies).sort(), event).toEqual(
        [...NOTIFICATION_EVENTS[event as NotificationEvent].types].sort()
      );
    }
  });

  it('has a module for every event with an email, besides the ones with their own template', () => {
    const emailed = NOTIFICATION_EVENT_KEYS.filter((event) => offersChannel(event, 'email'));
    expect(
      [...Object.keys(NOTIFICATION_EMAILS_BY_EVENT), 'wishlist_invite', 'birthday_nudge'].sort()
    ).toEqual(emailed.sort());
  });
});

describe('every email, byte for byte', () => {
  it('has a fixture with a unique id for every email', () => {
    const ids = EMAIL_FIXTURES.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(EMAIL_FIXTURES.map((fixture) => [fixture.id, fixture] as const))(
    '%s, as sent over SMTP',
    async (_id, fixture) => {
      const email = await loadEmail('smtp');
      await send(email, fixture);

      expect(sendMail).toHaveBeenCalledTimes(1);
      const { attachments, ...message } = sendMail.mock.calls[0]![0] as Record<string, unknown> & {
        attachments: { filename: string; cid: string; content: Buffer }[];
      };
      expect(attachments.map(({ filename, cid }) => ({ filename, cid }))).toEqual([
        { filename: 'logo.png', cid: 'wishlist-logo' },
      ]);
      const { html, text, ...envelope } = message as {
        html: string;
        text: string;
      } & Record<string, unknown>;
      expect(envelope).toMatchSnapshot('envelope');
      expect(withoutLocaleDates(text)).toMatchSnapshot('text');
      expect(withoutLocaleDates(html)).toMatchSnapshot('html');
    }
  );

  it.each(EMAIL_FIXTURES.map((fixture) => [fixture.id, fixture] as const))(
    '%s, as printed by the console transport',
    async (_id, fixture) => {
      const email = await loadEmail('console');
      await send(email, fixture);

      expect(sendMail).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0]![0])).toMatchSnapshot();
    }
  );
});
