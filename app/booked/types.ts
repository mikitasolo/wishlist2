import type { GiftEntry } from '@/components/GiftHistory';
import type { Occasion } from '@/lib/utils/occasion';
import type { ContributingGroupGift } from '@/lib/utils/groupGiftSummary';

export interface Price {
  value: number;
  currency: string;
}

export interface Reservation {
  _id: string;
  /** The reserved item's id, which Release sends the list's own unbook to. */
  itemId: string;
  itemName: string;
  itemImage: string | null;
  itemPrice: Price | null;
  wishlistName: string;
  wishlistId: string;
  /**
   * The live list's slug, `null` for a list that's gone or that the gifter can
   * no longer see (or a legacy one with none): the card links it by id then.
   */
  wishlistSlug: string | null;
  /** The live list's occasion, `null` for none or a list the gifter can no longer see. */
  wishlistOccasion: Occasion | null;
  /** The live item's status, `null` on a list the gifter can't open. */
  itemStatus: string | null;
  /** The live item is still booked by the gifter (`null` on a list they can't open). */
  stillReserved: boolean | null;
  /**
   * The gifter can still open the list (never why not, unless it's archived).
   * Still reserved on a list they can open, the card is under "To give" and
   * offers Release; otherwise it needs their confirmation, and offers Dismiss.
   * A card whose list isn't open names it without a link, and is frozen: its
   * snapshot only, with no hint of what has happened to the item since.
   */
  listOpen: boolean;
  /**
   * The list is archived: the card is frozen, its snapshot only, with no hint
   * of what has happened to the item since, until the list is unarchived.
   */
  listArchived: boolean;
  /**
   * The list's primary owner, by username, while the gifter can open it
   * (`null` otherwise, or for one with none): a group's heading names them.
   */
  wishlistOwnerUsername?: string | null;
  /** The live item's product link, only while it's still theirs on a list they can open. */
  itemLink?: string | null;
  /** The live item's notes ("size M, blue"), on the same terms as its link. */
  itemNotes?: string | null;
  /**
   * Their own share of a group gift (WIS-363), in the gift's currency: what
   * Mark as given logs. `null` (or absent) for a solo booking.
   */
  pledge?: Price | null;
  /**
   * The live group gift they're in on this item, only while it's still theirs
   * on a list they can open: its progress and everyone in it. Its organizer's
   * card offers the gift's own Mark as given; every contributor's offers
   * Leave group gift in place of Release.
   */
  groupGift?: ContributingGroupGift | null;
}

export type Gift = GiftEntry;
