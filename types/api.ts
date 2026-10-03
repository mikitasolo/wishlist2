/**
 * API response types - these match what the API actually returns
 * Separate from database models to allow API to transform/enrich data
 */

/**
 * Item as returned by the API
 * - IDs are serialized as strings (not ObjectId)
 * - Dates are serialized as strings (not Date objects)
 * - May include enriched fields like priceInUsdCents
 * - bookedBy and proposedBy may be strings (user IDs) or undefined based on permissions
 */
export interface ApiItem {
  _id: string;
  wishlist: string;
  name: string;
  imageUrl?: string | null;
  price?: {
    value: number; // in cents
    currency: string;
  } | null;
  priceInUsdCents?: number | null; // Enriched by API for sorting
  link?: string | null;
  notes?: string | null;
  mostWanted?: boolean; // Absent on items saved before the flag existed — treat as false
  status: 'draft' | 'available' | 'booked' | 'completed' | 'proposed';
  bookedBy?: string | null; // User ID as string, or undefined if hidden
  proposedBy?: string | null; // User ID as string, or undefined if hidden
  /**
   * A member's own read only: true on an item they hold the booking of and have
   * marked as given (their gift history has it). Absent for owners, who never
   * see booking status, and for anyone who isn't a member.
   */
  givenByMe?: boolean;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
}

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  // Something about a success the user should hear (e.g. a saved copy of an
  // item whose image couldn't be copied). Shown in a toast.
  notice?: string;
}
