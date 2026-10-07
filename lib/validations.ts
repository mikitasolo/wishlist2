import { z } from 'zod';
import { normalizeOccasionDate, OCCASION_KINDS } from '@/lib/utils/occasion';
import { BIRTHDAY_VISIBILITIES, normalizeBirthday } from '@/lib/utils/birthday';
import {
  isVisiblyBlank,
  LINE_BREAK_OR_CONTROL_CHAR,
  BIDI_CONTROL_CHAR,
  NAME_BIDI_MESSAGE,
  NAME_CONTROL_CHAR_MESSAGE,
} from '@/lib/utils/visibleName';
import { ITEM_NOTES_MAX, isHttpUrl, normalizeItemLink } from '@/lib/utils/itemFields';
import { notificationPrefsSchema } from '@/lib/utils/notificationPrefs';
import { SHARE_LINK_LABEL_MAX, SHARE_LINK_LEVELS } from '@/lib/utils/shareLinkFields';
import { isTimeZone } from '@/lib/utils/zonedDate';
import { COPY_ITEMS_MAX } from '@/lib/utils/wishlistCopy';

/**
 * Validation schemas for API endpoints
 *
 * Zod runs `.trim()` and the checks in the order they're chained, so chain
 * `.trim()` before a string's length checks. A check chained ahead of it
 * measures the untrimmed value: `min(1)` passes "   ", which trims to "" and
 * only fails later at the model's `required`, as a 500 instead of a 400.
 */

// Wishlist schemas

// A name is one line of text that people read in lists, notifications and
// emails. It goes raw into the invite email's plain-text part, where an inner
// line break would start new lines of text under our branding. So it's refused
// rather than cleaned up. The check runs after `.trim()`, so a line break at
// either end is just trimmed off. For the same reason it can't hold a bidi
// override or isolate. A name that shows nothing (only zero-width characters,
// say) is refused like an empty one; the zero-width joiner and non-joiner are
// fine inside a visible name, since emoji sequences and Persian text need
// them. A blank name stops there, so it gets only the one error (not also "too
// long" or "hidden characters"). Wishlist and item names share this.
function visibleLineName(requiredMessage: string, max: number) {
  return z
    .string()
    .trim()
    .refine((name) => !isVisiblyBlank(name), { message: requiredMessage, abort: true })
    .max(max, `Name must be ${max} characters or less`)
    .refine((name) => !LINE_BREAK_OR_CONTROL_CHAR.test(name), {
      message: NAME_CONTROL_CHAR_MESSAGE,
    })
    .refine((name) => !BIDI_CONTROL_CHAR.test(name), {
      message: NAME_BIDI_MESSAGE,
    });
}

const wishlistNameSchema = visibleLineName('Wishlist name is required', 100);

/** A group's name (WIS-27): one visible line, like a list's, and short. */
export const GROUP_NAME_MAX = 40;
export const groupNameSchema = z.object({
  name: visibleLineName('Group name is required', GROUP_NAME_MAX),
});

/** Who to add to a group: someone the caller follows, by id. */
export const groupMemberSchema = z.object({
  userId: z.string().max(64),
});

// A list's occasion. `date` is a plain calendar date, `YYYY-MM-DD`. A one-off's
// must exist as it is: `2028-02-29` passes, `2027-02-29` and `2026-02-30`
// don't. A yearly one keeps only its month and day: its year, whatever was sent
// (a birth year, say), is replaced with the placeholder leap year, so Feb 29
// passes and Feb 30 doesn't, and a real year never reaches the database or a
// response (`normalizeOccasionDate`). A one-off in the past isn't refused: the
// server can't know the viewer's date, and every one-off ends up there. `kind`
// and `recurrence` are both required (`recurrence: null` for a one-off);
// clearing the occasion is `occasion: null`, not an occasion with fields left
// out.
export const occasionSchema = z
  .object({
    kind: z.enum(OCCASION_KINDS, 'Pick an occasion'),
    date: z.string(),
    recurrence: z.literal('yearly').nullable(),
  })
  .transform((occasion, ctx) => {
    const date = normalizeOccasionDate(occasion.date, occasion.recurrence);
    if (date === null) {
      ctx.issues.push({
        code: 'custom',
        path: ['date'],
        message: 'Pick a real date',
        input: occasion.date,
      });
      return z.NEVER;
    }
    return { ...occasion, date };
  });

export const createWishlistSchema = z.object({
  name: wishlistNameSchema,
  description: z.string().trim().max(500, 'Description must be 500 characters or less').optional(),
  visibility: z.enum(['everyone', 'friends', 'private']).default('everyone'),
  bannerUrl: z.url('Invalid image URL').optional().nullable().or(z.literal('')),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Invalid currency code')
    .optional(),
  occasion: occasionSchema.nullable().optional(),
});

export const updateWishlistSchema = z
  .object({
    name: wishlistNameSchema.optional(),
    description: z
      .string()
      .trim()
      .max(500, 'Description must be 500 characters or less')
      .optional()
      .nullable(),
    visibility: z.enum(['everyone', 'friends', 'private']).optional(),
    archived: z.boolean().optional(),
    featured: z.boolean().optional(),
    bannerUrl: z.url('Invalid image URL').optional().nullable().or(z.literal('')),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Invalid currency code')
      .optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, 'Slug must be at least 3 characters')
      .max(60, 'Slug must be 60 characters or less')
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'Use lowercase letters, numbers, and single hyphens (no leading/trailing hyphen)'
      )
      .optional(),
    occasion: occasionSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

// "Start a new list from this one" (WIS-325): what the owner chose. The rest
// of the new list (description, cover, currency) is read from the source list
// on the server, never taken from the client. `itemIds` are the source items
// picked to bring over, none by default; each must be one of the source list's
// copyable items, which the route checks. Duplicates count once.
export const copyWishlistSchema = z.object({
  name: wishlistNameSchema,
  visibility: z.enum(['everyone', 'friends', 'private']),
  occasion: occasionSchema.nullable().optional(),
  itemIds: z
    .array(z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid item id'))
    .max(COPY_ITEMS_MAX, `Pick at most ${COPY_ITEMS_MAX} items`)
    .default([])
    .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]),
});

// User / profile schemas
export const USERNAME_REGEX = /^[a-z][a-z0-9_]{2,19}$/;

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    USERNAME_REGEX,
    'Username must be 3–20 characters, start with a letter, and use only lowercase letters, numbers, or underscores'
  );

// A profile birthday (WIS-323): a day and a month, whatever year it's sent with.
export const birthdaySchema = z.string().transform((date, ctx) => {
  const birthday = normalizeBirthday(date);
  if (!birthday) {
    ctx.issues.push({ code: 'custom', message: 'Pick a real day and month', input: date });
    return z.NEVER;
  }
  return birthday;
});

export const updateProfileSchema = z
  .object({
    username: usernameSchema.optional(),
    image: z.url('Invalid image URL').nullable().or(z.literal('')).optional(),
    bio: z.string().trim().max(300, 'Bio must be 300 characters or less').nullable().optional(),
    // Their birthday's day and month, sent as `YYYY-MM-DD`: any year is
    // dropped (`normalizeBirthday`), stored on `YEARLY_PLACEHOLDER_YEAR`.
    // `null` clears it.
    birthday: birthdaySchema.nullable().optional(),
    defaultCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Invalid currency code')
      .optional(),
    // They've answered the dashboard's currency prompt (so has any request that
    // sets `defaultCurrency`). Only ever `true`: the server stamps
    // `User.currencyChosenAt` itself, and nothing unsets it.
    currencyChosen: z.literal(true).optional(),
    privacy: z
      .object({
        searchable: z.boolean().optional(),
        whoCanInvite: z.enum(['everyone', 'friends', 'nobody']).optional(),
        profileVisibility: z.enum(['everyone', 'friends']).optional(),
        birthdayVisibility: z.enum(BIRTHDAY_VISIBILITIES).optional(),
      })
      .optional(),
    // Each notification setting it's sent, per event and channel.
    notificationPrefs: notificationPrefsSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

// Sign-in: the magic-link request the sign-in form's server action receives
// (`app/auth/signin/actions.ts`). Only the shape is checked here. Auth.js
// normalizes and validates the address itself, and keeps `callbackUrl` on our
// own origin. The Turnstile token is judged by `verifyTurnstileToken`, which
// refuses a missing or oversized one as a failed check rather than bad input.
export const magicLinkRequestSchema = z.object({
  email: z.string().trim().min(1).max(254),
  // Missing, empty or absurdly long (Auth.js reflects it into the link): home.
  callbackUrl: z
    .string()
    .trim()
    .optional()
    .transform((url) => (url && url.length <= 2048 ? url : '/')),
  turnstileToken: z.string().nullish(),
});

// Member schemas — invite an existing account by username.
// A wishlist has two kinds of people: owners (manage it, never see bookings) and
// members (gift). `owner` is a real invite role because co-ownership can only be
// granted with the invitee's consent, so it uses the same accept/decline path.
export const wishlistRoleSchema = z.enum(['owner', 'member']);

export const inviteMemberSchema = z.object({
  username: usernameSchema,
  role: wishlistRoleSchema.optional().default('member'),
});

// An owner's answer to a request to join their list (WIS-275): Invite issues a
// member invite, Decline ends it without telling anyone.
export const joinRequestAnswerSchema = z.object({
  action: z.enum(['invite', 'decline']),
});

// Share link schemas (WIS-334). Both are strict, so a body can't carry a
// `token` (the server makes it) and an edit can't carry a `level` (fixed when
// the link is made: make a new link instead). Every field is type-checked, so
// an operator object like `{"$ne": null}` is refused, never passed on.

// A link's label: one short line an owner reads in their link list. Blank
// (only spaces or zero-width characters) means no label. Like a name, it can't
// hold line breaks, control characters or bidi overrides: it's owner-written
// free text that may reach a notification later.
const shareLinkLabelSchema = z
  .string()
  .trim()
  .max(SHARE_LINK_LABEL_MAX, `Label must be ${SHARE_LINK_LABEL_MAX} characters or less`)
  .refine((label) => !LINE_BREAK_OR_CONTROL_CHAR.test(label), {
    message: NAME_CONTROL_CHAR_MESSAGE,
  })
  .refine((label) => !BIDI_CONTROL_CHAR.test(label), { message: NAME_BIDI_MESSAGE })
  .transform((label) => (isVisiblyBlank(label) ? null : label))
  .nullable();

// When a link stops working: an ISO date-time, or null for never. The API
// takes what it's sent (the presets and defaults are the client's); a time
// already past makes an expired link, which a later one brings back.
const shareLinkExpirySchema = z.iso
  .datetime({ offset: true, message: 'Invalid expiry date' })
  .transform((value) => new Date(value))
  .nullable();

// `untilOccasion` (WIS-342): the link ends the day after the list's occasion,
// at midnight in `timeZone` (the IANA zone of whoever sets it), and moves with
// the occasion. The server works the date out, so it needs the zone.
const shareLinkTimeZoneSchema = z.string().refine(isTimeZone, 'Invalid time zone');
const UNTIL_OCCASION_NEEDS_ZONE = {
  message: 'A link that ends with the occasion needs a time zone',
  path: ['timeZone'],
};

export const createShareLinkSchema = z
  .strictObject({
    level: z.enum(SHARE_LINK_LEVELS),
    label: shareLinkLabelSchema.optional(),
    expiresAt: shareLinkExpirySchema.optional(),
    untilOccasion: z.boolean().optional(),
    timeZone: shareLinkTimeZoneSchema.optional(),
  })
  .refine((body) => !body.untilOccasion || !!body.timeZone, UNTIL_OCCASION_NEEDS_ZONE);

export const updateShareLinkSchema = z
  .strictObject({
    label: shareLinkLabelSchema.optional(),
    expiresAt: shareLinkExpirySchema.optional(),
    untilOccasion: z.boolean().optional(),
    timeZone: shareLinkTimeZoneSchema.optional(),
  })
  .refine(
    (body) =>
      body.label !== undefined || body.expiresAt !== undefined || body.untilOccasion !== undefined,
    { message: 'Nothing to update' }
  )
  .refine((body) => !body.untilOccasion || !!body.timeZone, UNTIL_OCCASION_NEEDS_ZONE);

// Item schemas
// A product link: one typed without a scheme ("amazon.de/dp/1") gets https://,
// and only an http(s) address is accepted (never javascript:, data:, …).
const itemLinkSchema = z.preprocess(
  (v) => (typeof v === 'string' ? normalizeItemLink(v) : v),
  z.url('Invalid link URL').refine(isHttpUrl, 'Invalid link URL')
);
const itemNotesSchema = z
  .string()
  .trim()
  .max(ITEM_NOTES_MAX, `Notes must be ${ITEM_NOTES_MAX} characters or less`);

/**
 * An item price's currency code, stored uppercase like a list's and a user's.
 * The route checks it against
 * the day's rates (`hasRate`).
 */
const itemCurrencySchema = z.string().trim().toUpperCase().min(1, 'Currency code is required');

export const createItemSchema = z.object({
  name: visibleLineName('Item name is required', 200),
  imageUrl: z.url('Invalid image URL').optional(),
  price: z
    .object({
      value: z
        .number()
        .int('Price value must be an integer (cents)')
        .min(0, 'Price value must be non-negative'),
      currency: itemCurrencySchema,
    })
    .optional()
    .nullable(), // Price object is optional, but if provided, both value and currency are required
  link: itemLinkSchema.optional(),
  notes: itemNotesSchema.optional(),
  mostWanted: z.boolean().optional(),
  // A new item is never booked or completed, and takes no `bookedBy`: a booking
  // only comes from a member booking it (PATCH), which also writes the
  // Reservation that lets them release it. The route narrows this further:
  // owners create draft/available, members only propose. No `proposedBy`
  // either: the route sets the proposer from the session.
  status: z.enum(['draft', 'available', 'proposed']).default('available'),
  // "Save to my list": the item this one is a copy of. The copy's fields are
  // the ones sent here, never the source's; the id only lets the route check
  // that the caller can see the source, and copy its image blob for them
  // rather than share it. The route checks its shape (`isObjectIdParam`).
  sourceItemId: z.string().optional(),
});

export const updateItemSchema = z
  .object({
    name: visibleLineName('Item name is required', 200).optional(),
    imageUrl: z.url('Invalid image URL').optional().nullable(),
    price: z
      .object({
        value: z
          .number()
          .int('Price value must be an integer (cents)')
          .min(0, 'Price value must be non-negative'),
        currency: itemCurrencySchema,
      })
      .optional()
      .nullable(), // Price object is optional, but if provided, both value and currency are required
    link: itemLinkSchema.optional().nullable(),
    notes: itemNotesSchema.optional().nullable(),
    mostWanted: z.boolean().optional(),
    // The route narrows this per role: members only book/unbook, owners only
    // draft/available/completed (draft/available when approving a proposal).
    // No `bookedBy` or `proposedBy`, so a client-sent one is dropped: the server
    // sets them (a member's booking, a member's proposal) and clears them.
    status: z.enum(['draft', 'available', 'booked', 'completed', 'proposed']).optional(),
    // The review dialog's approve says it expects the item to still be a
    // proposal (WIS-199, lib/utils/proposalReview.ts). Not a change, so it
    // doesn't count as a field to update.
    expectedStatus: z.literal('proposed').optional(),
    // And the version (`updatedAt`) of the proposal it shows (WIS-320). Only
    // with `expectedStatus`; not a change either.
    expectedUpdatedAt: z.string().datetime().optional(),
  })
  .refine(
    (data) =>
      Object.keys(data).some((key) => key !== 'expectedStatus' && key !== 'expectedUpdatedAt'),
    { message: 'At least one field must be provided for update' }
  )
  .refine((data) => data.expectedUpdatedAt === undefined || data.expectedStatus === 'proposed', {
    message: 'expectedUpdatedAt needs expectedStatus',
  });

/**
 * `DELETE /api/users/me`: what the person typed to confirm it, their username
 * or email (`matchesDeletionConfirmation`, lib/utils/deletionConfirmation.ts).
 */
export const deleteAccountSchema = z.object({
  confirm: z.string().max(320),
  // The ids of the lists the confirmation named as going with the account: none
  // other is deleted (`deleteAccount`).
  lists: z.array(z.string().max(64)).max(1000).default([]),
});

// Helper function to validate request body
export async function validateRequestBody<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<{ success: true; data: T } | { success: false; error: string; status: number }> {
  try {
    const body = await request.json();
    const validatedData = schema.parse(body);
    return { success: true, data: validatedData };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.issues.map((err) => {
        const path = err.path.join('.');
        return path ? `${path}: ${err.message}` : err.message;
      });
      return {
        success: false,
        error: `Validation error: ${errorMessages.join(', ')}`,
        status: 400,
      };
    }
    return {
      success: false,
      error: 'Invalid request body',
      status: 400,
    };
  }
}
