import type { ItemRef, LinkChanges } from '@/lib/utils/itemLinks';
import type { GroupGiftSummary } from '@/lib/utils/groupGiftSummary';

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
  tags?: string[]; // The owners' tags (WIS-385); absent on an item with none
  status: 'draft' | 'available' | 'booked' | 'completed' | 'proposed';
  bookedBy?: string | null; // User ID as string, or undefined if hidden
  proposedBy?: string | null; // User ID as string, or undefined if hidden
  /**
   * A member's own read only: true on an item they hold the booking of and have
   * marked as given (their gift history has it). Absent for owners, who never
   * see booking status, and for anyone who isn't a member.
   */
  givenByMe?: boolean;
  /**
   * "Goes with" (WIS-29): the partners this viewer may see, `{ id, name }` only
   * (never a draft or proposal to a non-owner, never a status). Absent on an
   * answer from before the field existed: treat as none.
   */
  relatedItems?: ItemRef[];
  /**
   * A live group gift on a booked item (WIS-361), on a member's own read only:
   * the full split for a contributor, only the percent funded for any other
   * member. Never on an owner's or visitor's answer.
   */
  groupGift?: GroupGiftSummary;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
}

/**
 * An item edit as the page sends it: the item's fields, plus the links added
 * and removed (an owner's, WIS-29), which the server answers with the item's
 * new `relatedItems`.
 */
export type ItemUpdate = Partial<ApiItem> & LinkChanges;

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
