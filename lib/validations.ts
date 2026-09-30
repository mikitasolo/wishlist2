import { z } from 'zod';

/**
 * Validation schemas for API endpoints
 */

// Wishlist schemas
export const createWishlistSchema = z.object({
  name: z
    .string()
    .min(1, 'Wishlist name is required')
    .max(100, 'Name must be 100 characters or less')
    .trim(),
  description: z.string().max(500, 'Description must be 500 characters or less').trim().optional(),
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
    name: z
      .string()
      .min(1, 'Wishlist name is required')
      .max(100, 'Name must be 100 characters or less')
      .trim()
      .optional(),
    description: z
      .string()
      .max(500, 'Description must be 500 characters or less')
      .trim()
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
    bio: z.string().max(300, 'Bio must be 300 characters or less').trim().nullable().optional(),
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
    .min(1, 'Item name is required')
    .max(200, 'Name must be 200 characters or less')
    .trim(),
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
  notes: z.string().max(100, 'Notes must be 100 characters or less').trim().optional(),
  mostWanted: z.boolean().optional(),
  status: z.enum(['draft', 'available', 'booked', 'completed', 'proposed']).default('available'),
  bookedBy: z.string().optional().nullable(),
  proposedBy: z.string().optional().nullable(),
});

export const updateItemSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Item name is required')
      .max(200, 'Name must be 200 characters or less')
      .trim()
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
    notes: z.string().max(100, 'Notes must be 100 characters or less').trim().optional().nullable(),
    mostWanted: z.boolean().optional(),
    status: z.enum(['draft', 'available', 'booked', 'completed', 'proposed']).optional(),
    bookedBy: z.string().optional().nullable(),
    proposedBy: z.string().optional().nullable(),
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
