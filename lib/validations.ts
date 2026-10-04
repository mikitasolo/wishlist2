import { z } from 'zod';
import { normalizeOccasionDate, OCCASION_KINDS } from '@/lib/utils/occasion';
import { ITEM_NOTES_MAX, isHttpUrl, normalizeItemLink } from '@/lib/utils/itemFields';

/**
 * Validation schemas for API endpoints
 *
 * Zod runs `.trim()` and the checks in the order they're chained, so chain
 * `.trim()` before a string's length checks. A check chained ahead of it
 * measures the untrimmed value: `min(1)` passes "   ", which trims to "" and
 * only fails later at the model's `required`, as a 500 instead of a 400.
 */

// Wishlist schemas

// Any control character (Unicode Cc: CR, LF, tab, NUL, NEL, …) or the Unicode
// line and paragraph separators.
const LINE_BREAK_OR_CONTROL_CHAR = /[\p{Cc}\p{Zl}\p{Zp}]/u;

// The bidi embeddings and overrides (U+202A–U+202E) and isolates
// (U+2066–U+2069). They reorder the text after them, so a name holding one can
// make the rest of an email's line read as something else (a domain spelled
// backwards, say). The bidi marks (LRM, RLM, ALM) only nudge neutral characters
// and stay allowed, as does right-to-left text itself.
const BIDI_CONTROL_CHAR = /[\u202A-\u202E\u2066-\u2069]/u;

// Unicode's Default_Ignorable_Code_Point: every character that renders as
// nothing (zero-width space and joiners, word joiner, BOM, bidi marks,
// variation selectors, tag characters, Hangul fillers, soft hyphen).
const INVISIBLE_CHAR = /\p{Default_Ignorable_Code_Point}/gu;

/** Whether a name shows nothing at all: only whitespace and invisible characters. */
function isVisiblyBlank(name: string): boolean {
  return name.replace(INVISIBLE_CHAR, '').trim() === '';
}

// A wishlist name is one line of text. It goes raw into the invite email's
// plain-text part, where an inner line break would start new lines of text
// under our branding. So the name is refused rather than cleaned up. The check
// runs after `.trim()`, so a line break at either end is just trimmed off. For
// the same reason it can't hold a bidi override or isolate. A name that shows
// nothing (only zero-width characters, say) is refused like an empty one; the
// zero-width joiner and non-joiner are fine inside a visible name, since emoji
// sequences and Persian text need them. A blank name stops there, so it gets
// only the one error (not also "too long" or "hidden characters").
const wishlistNameSchema = z
  .string()
  .trim()
  .refine((name) => !isVisiblyBlank(name), { message: 'Wishlist name is required', abort: true })
  .max(100, 'Name must be 100 characters or less')
  .refine((name) => !LINE_BREAK_OR_CONTROL_CHAR.test(name), {
    message: "Name can't contain line breaks or control characters",
  })
  .refine((name) => !BIDI_CONTROL_CHAR.test(name), {
    message: "Name can't contain hidden text-direction characters",
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

export const updateProfileSchema = z
  .object({
    username: usernameSchema.optional(),
    image: z.url('Invalid image URL').nullable().or(z.literal('')).optional(),
    bio: z.string().trim().max(300, 'Bio must be 300 characters or less').nullable().optional(),
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
      })
      .optional(),
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

export const createItemSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Item name is required')
    .max(200, 'Name must be 200 characters or less'),
  imageUrl: z.url('Invalid image URL').optional(),
  price: z
    .object({
      value: z
        .number()
        .int('Price value must be an integer (cents)')
        .min(0, 'Price value must be non-negative'),
      currency: z.string().min(1, 'Currency code is required').toLowerCase(),
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
    name: z
      .string()
      .trim()
      .min(1, 'Item name is required')
      .max(200, 'Name must be 200 characters or less')
      .optional(),
    imageUrl: z.url('Invalid image URL').optional().nullable(),
    price: z
      .object({
        value: z
          .number()
          .int('Price value must be an integer (cents)')
          .min(0, 'Price value must be non-negative'),
        currency: z.string().min(1, 'Currency code is required').toLowerCase(),
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
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

/**
 * `DELETE /api/users/me`: what the person typed to confirm it, their username
 * or email (`matchesDeletionConfirmation`, lib/utils/deletionConfirmation.ts).
 */
export const deleteAccountSchema = z.object({
  confirm: z.string().max(320),
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
