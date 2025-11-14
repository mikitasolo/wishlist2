import { z } from 'zod';

/**
 * Validation schemas for API endpoints
 */

// Wishlist schemas
export const createWishlistSchema = z.object({
  name: z.string().min(1, 'Wishlist name is required').max(100, 'Name must be 100 characters or less').trim(),
  description: z.string().max(500, 'Description must be 500 characters or less').trim().optional(),
  isPublic: z.boolean().default(true),
});

export const updateWishlistSchema = z.object({
  name: z.string().min(1, 'Wishlist name is required').max(100, 'Name must be 100 characters or less').trim().optional(),
  description: z.string().max(500, 'Description must be 500 characters or less').trim().optional().nullable(),
  isPublic: z.boolean().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

// Member schemas
export const inviteMemberSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
});

// Item schemas
export const createItemSchema = z.object({
  name: z.string().min(1, 'Item name is required').max(200, 'Name must be 200 characters or less').trim(),
  imageUrl: z.string().url('Invalid image URL').trim(),
  priceInCents: z.number().int().min(0, 'Price must be non-negative').optional(),
  link: z.string().url('Invalid link URL').trim().optional(),
  status: z.enum(['available', 'booked', 'completed']).default('available'),
  bookedBy: z.string().optional().nullable(),
});

export const updateItemSchema = z.object({
  name: z.string().min(1, 'Item name is required').max(200, 'Name must be 200 characters or less').trim().optional(),
  imageUrl: z.string().url('Invalid image URL').trim().optional(),
  priceInCents: z.number().int().min(0, 'Price must be non-negative').optional().nullable(),
  link: z.string().url('Invalid link URL').trim().optional().nullable(),
  status: z.enum(['available', 'booked', 'completed']).optional(),
  bookedBy: z.string().optional().nullable(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

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

