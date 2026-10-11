import { isolateForText } from '@/lib/utils/emailText';
import { NOTIFICATION_EVENTS, notificationEventOf } from '@/lib/utils/notificationPrefs';
import {
  notificationLink,
  notificationParts,
  type NotificationView,
} from '@/lib/utils/notifications';
import {
  escapeHtml,
  getEmailTemplate,
  notificationFooter,
  type EmailContext,
  type RenderedEmail,
} from './layout';
import type {
  EmailedNotificationType,
  NotificationEmailCopies,
  NotificationEmailDetails,
} from './notifications/types';
import { accessChangedEmail } from './notifications/accessChanged';
import { askedListMadeEmail } from './notifications/askedListMade';
import { birthdayReminderEmail } from './notifications/birthdayReminder';
import { giftNudgeEmail } from './notifications/giftNudge';
import { giftReminderEmail } from './notifications/giftReminder';
import { groupGiftCancelledEmail } from './notifications/groupGiftCancelled';
import { groupGiftConvertedEmail } from './notifications/groupGiftConverted';
import { groupGiftFundedEmail } from './notifications/groupGiftFunded';
import { groupGiftGivenEmail } from './notifications/groupGiftGiven';
import { groupGiftJoinedEmail } from './notifications/groupGiftJoined';
import { groupGiftOrganizerEmail } from './notifications/groupGiftOrganizer';
import { inviteAcceptedEmail } from './notifications/inviteAccepted';
import { joinRequestEmail } from './notifications/joinRequest';
import { linkJoinEmail } from './notifications/linkJoin';
import { occasionReminderEmail } from './notifications/occasionReminder';
import { proposalEmail } from './notifications/proposal';
import { proposalApprovedEmail } from './notifications/proposalApproved';
import { wishlistAskEmail } from './notifications/wishlistAsk';

export type { EmailedNotificationType, NotificationEmailDetails } from './notifications/types';

/**
 * Every emailed type's copy, one module per `NOTIFICATION_EVENTS` event. Typed
 * as the full record, so a new emailed type doesn't compile without its copy.
 */
const COPY: NotificationEmailCopies<EmailedNotificationType> = {
  ...joinRequestEmail,
  ...linkJoinEmail,
  ...proposalEmail,
  ...accessChangedEmail,
  ...inviteAcceptedEmail,
  ...proposalApprovedEmail,
  ...occasionReminderEmail,
  ...birthdayReminderEmail,
  ...wishlistAskEmail,
  ...askedListMadeEmail,
  ...groupGiftJoinedEmail,
  ...groupGiftFundedEmail,
  ...groupGiftOrganizerEmail,
  ...groupGiftCancelledEmail,
  ...groupGiftConvertedEmail,
  ...groupGiftGivenEmail,
  ...giftReminderEmail,
  ...giftNudgeEmail,
};

/** The types whose email names who did it: the same ones whose in-app row does. */
const NAMES_ACTOR: ReadonlySet<EmailedNotificationType> = new Set([
  'join_request',
  'invite_accepted',
  'link_join',
  'birthday_reminder',
  'wishlist_ask',
  'asked_list_made',
  'group_gift_joined',
]);

/**
 * A notification email (WIS-321): the in-app row's own line, built by the same
 * `notificationParts` from the same fields, so an email never says more than
 * the notification does (a proposal stays anonymous, a role change never names
 * who made it, nothing mentions bookings). It links where the row links, and
 * to Activity where the row links nowhere (a removal) or where its copy says
 * so (an ask for a wishlist, answered from its row there). Every one carries the
 * unsubscribe link and headers for its event.
 */
export function notificationEmail(
  details: NotificationEmailDetails,
  ctx: EmailContext
): RenderedEmail {
  const actorUsername = NAMES_ACTOR.has(details.type) ? (details.actorUsername ?? null) : null;
  const view = (overrides: Partial<NotificationView>): NotificationView => ({
    _id: '',
    type: details.type,
    actorUsername,
    count: 1,
    wishlistName: details.wishlistName,
    wishlistSlug: details.wishlistSlug ?? null,
    wishlistId: details.wishlistId,
    itemName: details.itemName ?? null,
    occasionKind: details.occasionKind ?? null,
    occasionDate: details.occasionDate ?? null,
    linkLabel: details.type === 'link_join' ? (details.linkLabel ?? null) : null,
    read: false,
    createdAt: '',
    ...overrides,
  });

  const htmlLine = notificationParts(view({}))
    .map((part) =>
      typeof part === 'string' ? escapeHtml(part) : `<strong>${escapeHtml(part.listName)}</strong>`
    )
    .join('');
  // The text part takes raw values, so each free-text one is isolated first.
  const textLine = notificationParts(
    view({
      wishlistName: details.wishlistName ? isolateForText(details.wishlistName) : null,
      itemName: details.itemName ? isolateForText(details.itemName) : null,
      linkLabel:
        details.type === 'link_join' && details.linkLabel
          ? isolateForText(details.linkLabel)
          : null,
    })
  )
    .map((part) => (typeof part === 'string' ? part : `“${part.listName}”`))
    .join('');

  const copy = COPY[details.type](details, actorUsername ? `@${actorUsername}` : 'Someone');
  const path = copy.path ?? notificationLink(view({})) ?? '/notifications';
  const url = `${ctx.siteUrl}${path}`;
  const event = notificationEventOf(details.type);
  const unsubscribe = ctx.unsubscribe(event);
  const topic = NOTIFICATION_EVENTS[event].label.toLowerCase();

  const html = getEmailTemplate({
    title: copy.heading,
    greeting: copy.heading,
    contentHtml: `<p>${htmlLine}.</p>`,
    buttonText: copy.button,
    buttonUrl: url,
    unsubscribe: notificationFooter(ctx, unsubscribe),
  });

  return {
    kind: `${details.type} notification`,
    subject: copy.subject,
    html,
    text: `${copy.heading}\n\n${textLine}.\n\n${copy.button}: ${url}\n\nUnsubscribe from ${topic} emails: ${unsubscribe.page}`,
    link: url,
    unsubscribe,
  };
}
