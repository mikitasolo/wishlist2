import { z } from 'zod';

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

// A wishlist name is one line of text. It goes raw into the invite email's
// plain-text part and subject, and into the console transport's log, where an
// inner line break would start new lines of text under our branding (or a
// forged `Link:` line). So the name is refused rather than cleaned up. The check
// runs after `.trim()`, so a line break at either end is just trimmed off.
const wishlistNameSchema = z
  .string()
  .trim()
  .min(1, 'Wishlist name is required')
  .max(100, 'Name must be 100 characters or less')
  .refine((name) => !LINE_BREAK_OR_CONTROL_CHAR.test(name), {
    message: "Name can't contain line breaks or control characters",
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
  callbackUrl: z.string().trim().max(2048).optional().default('/'),
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

// Item schemas
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
  link: z.url('Invalid link URL').optional(),
  notes: z.string().trim().max(100, 'Notes must be 100 characters or less').optional(),
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
    link: z.url('Invalid link URL').optional().nullable(),
    notes: z.string().trim().max(100, 'Notes must be 100 characters or less').optional().nullable(),
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
