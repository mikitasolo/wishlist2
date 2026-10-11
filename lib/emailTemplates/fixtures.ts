import type { BirthdayNudgeEmailDetails } from './birthdayNudge';
import type { EmailedNotificationType, NotificationEmailDetails } from './notifications/types';
import type { WishlistInvitationDetails } from './wishlistInvite';

/**
 * Made-up data for every email the app sends (WIS-375): the dev-only gallery
 * (`/dev/emails`) renders each one, and `test/unit/emailTemplates.test.ts`
 * pins each one's subject, HTML and text. Nothing here is a real person,
 * address or list, and nothing is read from the database.
 *
 * Free-text values carry an apostrophe or an ampersand, so the gallery and the
 * snapshots both show them escaped.
 */

/** A recipient who doesn't exist: an id no account has, and a reserved domain. */
export const FIXTURE_RECIPIENT = {
  id: '000000000000000000000001',
  email: 'sam@example.com',
} as const;

/**
 * A sign-in link's path and query, shaped like Auth.js's, with a token that
 * signs no one in. Joined to the site URL where it's rendered, as every other
 * link is.
 */
export const FIXTURE_MAGIC_LINK_PATH =
  '/api/auth/callback/nodemailer?token=fixture-token&email=sam%40example.com';

/** The day each dated fixture is about: an occasion's, and a friend's birthday. */
export const FIXTURE_OCCASION_DATE = '2026-12-24';
export const FIXTURE_BIRTHDAY = '2026-03-14';

const LIST = {
  wishlistId: '000000000000000000000002',
  wishlistName: 'Ann\'s 30th & "cake"',
  wishlistSlug: 'anns-30th',
} as const;

type NotificationFixture = Omit<NotificationEmailDetails, 'recipientId' | 'type'>;

/**
 * One fixture per emailed notification type: typed as a full record, so a new
 * type doesn't compile until it has one (and so a gallery entry and a snapshot).
 */
const NOTIFICATION_FIXTURES: Record<EmailedNotificationType, NotificationFixture> = {
  join_request: { ...LIST, actorUsername: 'ben' },
  link_join: { ...LIST, actorUsername: 'ben', linkLabel: 'Family <3' },
  proposal: { ...LIST },
  role_changed: { ...LIST },
  removed_from_wishlist: { ...LIST, wishlistSlug: null },
  invite_accepted: { ...LIST, actorUsername: 'ben' },
  proposal_approved: { ...LIST, itemName: 'Pasta maker' },
  occasion_reminder: { ...LIST, occasionKind: 'birthday', occasionDate: FIXTURE_OCCASION_DATE },
  birthday_reminder: {
    actorUsername: 'ann',
    wishlistId: null,
    wishlistName: null,
    occasionDate: FIXTURE_BIRTHDAY,
  },
  wishlist_ask: { actorUsername: 'ann', wishlistId: null, wishlistName: null },
  asked_list_made: { ...LIST, actorUsername: 'ann' },
  group_gift_joined: { ...LIST, actorUsername: 'ben', itemName: 'Record player' },
  group_gift_funded: { ...LIST, itemName: 'Record player' },
  group_gift_organizer: { ...LIST, itemName: 'Record player' },
  group_gift_cancelled: { ...LIST, itemName: 'Record player' },
  group_gift_converted: { ...LIST, itemName: 'Record player' },
  group_gift_given: { ...LIST, itemName: 'Record player' },
  gift_reminder: { ...LIST, occasionKind: 'holiday', occasionDate: FIXTURE_OCCASION_DATE },
  gift_nudge: { ...LIST, occasionKind: 'wedding', occasionDate: FIXTURE_OCCASION_DATE },
};

function notification(
  type: EmailedNotificationType,
  overrides: Partial<NotificationFixture> = {}
): NotificationEmailDetails {
  return { recipientId: FIXTURE_RECIPIENT.id, type, ...NOTIFICATION_FIXTURES[type], ...overrides };
}

function invite(overrides: Partial<WishlistInvitationDetails> = {}): WishlistInvitationDetails {
  return {
    recipientId: FIXTURE_RECIPIENT.id,
    wishlistName: LIST.wishlistName,
    role: 'member',
    inviterName: 'Ben',
    inviterUsername: 'ben',
    ...overrides,
  };
}

export type EmailFixture = { id: string; label: string } & (
  | { template: 'magic_link'; magicLinkPath: string }
  | { template: 'wishlist_invite'; details: WishlistInvitationDetails }
  | { template: 'notification'; details: NotificationEmailDetails }
  | { template: 'birthday_nudge'; details: BirthdayNudgeEmailDetails }
);

/** Every email, in the gallery's order, plus the variants whose copy differs. */
export const EMAIL_FIXTURES: readonly EmailFixture[] = [
  {
    id: 'magic-link',
    label: 'Sign-in link',
    template: 'magic_link',
    magicLinkPath: FIXTURE_MAGIC_LINK_PATH,
  },
  { id: 'invite-member', label: 'Invitation', template: 'wishlist_invite', details: invite() },
  {
    id: 'invite-owner',
    label: 'Invitation to co-own',
    template: 'wishlist_invite',
    details: invite({ role: 'owner' }),
  },
  {
    id: 'invite-no-username',
    label: 'Invitation from someone with no username',
    template: 'wishlist_invite',
    details: invite({ inviterUsername: null }),
  },
  ...(Object.keys(NOTIFICATION_FIXTURES) as EmailedNotificationType[]).map(
    (type): EmailFixture => ({
      id: type.replaceAll('_', '-'),
      label: type,
      template: 'notification',
      details: notification(type),
    })
  ),
  {
    id: 'link-join-no-label',
    label: 'link_join, through a link with no label',
    template: 'notification',
    details: notification('link_join', { linkLabel: null }),
  },
  {
    id: 'occasion-reminder-other',
    label: 'occasion_reminder, another occasion with no date',
    template: 'notification',
    details: notification('occasion_reminder', { occasionKind: 'other', occasionDate: null }),
  },
  {
    id: 'group-gift-funded-no-item',
    label: 'group_gift_funded, with no item name',
    template: 'notification',
    details: notification('group_gift_funded', { itemName: null }),
  },
  {
    id: 'birthday-nudge',
    label: 'Birthday nudge',
    template: 'birthday_nudge',
    details: { recipientId: FIXTURE_RECIPIENT.id, days: 21 },
  },
  {
    id: 'birthday-nudge-soon',
    label: 'Birthday nudge, days away',
    template: 'birthday_nudge',
    details: { recipientId: FIXTURE_RECIPIENT.id, days: 3 },
  },
];
