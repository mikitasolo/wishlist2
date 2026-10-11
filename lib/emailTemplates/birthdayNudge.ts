import { NOTIFICATION_EVENTS } from '@/lib/utils/notificationPrefs';
import {
  BIRTHDAY_NUDGE_DETAIL,
  BIRTHDAY_NUDGE_EMAIL_PATH,
  birthdayNudgeTitle,
} from '@/lib/utils/birthdayNudge';
import {
  escapeHtml,
  getEmailTemplate,
  notificationFooter,
  type EmailContext,
  type RenderedEmail,
} from './layout';

export interface BirthdayNudgeEmailDetails {
  /** The recipient's account id, for the unsubscribe link (never shown). */
  recipientId: string;
  /** Days until their birthday, for the heading ("in 3 weeks"). */
  days: number;
}

/**
 * The nudge to make a list before your own birthday (WIS-344), sent once a
 * year by the daily cron (`sendBirthdayNudgeEmails`). Fixed words only: no
 * date, no list, nothing anyone typed. It links to Home with New list open on
 * a Birthday list, through sign-in so that survives being signed out
 * (`BIRTHDAY_NUDGE_EMAIL_PATH`), and carries the unsubscribe link and headers
 * for `birthday_nudge`.
 */
export function birthdayNudgeEmail(
  details: BirthdayNudgeEmailDetails,
  ctx: EmailContext
): RenderedEmail {
  const heading = birthdayNudgeTitle(details.days);
  const button = 'Make a list';
  const url = `${ctx.siteUrl}${BIRTHDAY_NUDGE_EMAIL_PATH}`;
  const unsubscribe = ctx.unsubscribe('birthday_nudge');
  const topic = NOTIFICATION_EVENTS.birthday_nudge.label.toLowerCase();

  const html = getEmailTemplate({
    title: heading,
    greeting: heading,
    contentHtml: `<p>${escapeHtml(BIRTHDAY_NUDGE_DETAIL)}</p>`,
    buttonText: button,
    buttonUrl: url,
    unsubscribe: notificationFooter(ctx, unsubscribe),
  });

  return {
    kind: 'birthday_nudge notification',
    subject: 'Your birthday is coming up',
    html,
    text: `${heading}\n\n${BIRTHDAY_NUDGE_DETAIL}\n\n${button}: ${url}\n\nUnsubscribe from ${topic} emails: ${unsubscribe.page}`,
    link: url,
    unsubscribe,
  };
}
