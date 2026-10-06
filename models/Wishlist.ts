import mongoose, { Schema, Model } from 'mongoose';
import { normalizeOccasionDate, OCCASION_KINDS, type Occasion } from '@/lib/utils/occasion';

// A list's one occasion (see `lib/utils/occasion.ts`). `date` is a plain
// calendar date, `YYYY-MM-DD`, never a timestamp: no time zone is stored or
// applied here. A yearly one is stored on the placeholder year, never a real
// one. `occasionSchema` (`lib/validations.ts`) checks and normalizes it; the
// checks here are a backstop for a write that skips it.
const OccasionSchema = new Schema(
  {
    kind: { type: String, enum: OCCASION_KINDS, required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    recurrence: { type: String, enum: ['yearly', null], default: null },
  },
  { _id: false }
);

const WishlistSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // Human-readable URL slug (e.g. "birthday-2026-a1b2c"). Unique + sparse so
    // legacy rows without one are allowed until backfilled. Generated from the
    // name on creation; editable in settings.
    slug: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    // Co-owners. Every owner is equal: same authorization, same privacy (none of
    // them ever see booking status), the list shows on each of their profiles,
    // and each can pin it to their own dashboard (see `featuredBy`). Always has
    // at least one entry — the last owner can't be removed, only the wishlist
    // deleted. Owners are NOT rows in `WishlistMember`; that collection holds
    // only members (existence, no role field).
    owners: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
    // Who can see this wishlist:
    //  - everyone: anyone with the link / on any owner's profile
    //  - friends:  any owner's friends (mutual follows) + members
    //  - private:  owners + explicit members only
    // No default, on purpose: every write names the tier (the create route
    // always passes one), and a stored list somehow missing it must fail closed
    // on every reader. A default would hydrate it as `everyone` in a
    // `findById` read while the query side (search, profiles) and lean reads
    // match it to no tier.
    visibility: {
      type: String,
      enum: ['everyone', 'friends', 'private'],
      required: true,
    },
    archived: {
      type: Boolean,
      default: false,
    },
    // Default currency for this wishlist (uppercase code). Prefilled from the
    // creating owner's default; editable in settings.
    currency: {
      type: String,
      uppercase: true,
      trim: true,
      default: 'USD',
    },
    // Optional custom banner image (URL). When set, it replaces the generated
    // gradient on the wishlist's cover art. Falls back to the gradient if empty.
    bannerUrl: {
      type: String,
      required: false,
      default: null,
    },
    // Which owners pinned this list as the hero of *their* dashboard. "Featured"
    // is per-owner, not per-list: a co-owned family list can be the highlight
    // for one owner and not another. At most one list per owner (enforced in the
    // update route), and an owner is pulled out when they lose ownership.
    featuredBy: {
      type: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      default: [],
    },
    // The list's occasion (birthday, holiday, …) and its date, set by an owner
    // in settings. Absent or null means none. It's shown to everyone who can
    // see the list and never changes who that is.
    occasion: {
      type: OccasionSchema,
      default: null,
      validate: {
        // Only as stored: a real date, and a yearly one on the placeholder year.
        validator: (v: Occasion | null) =>
          !v || normalizeOccasionDate(v.date, v.recurrence ?? null) === v.date,
        message:
          'Occasion date must be a real date, and a yearly one must be on the placeholder year',
      },
    },
    // "Start a new list from this one" (WIS-325): the creating request's
    // `Idempotency-Key`, scoped to its sender (`scopedIdempotencyKey`), so a
    // retry answers with the list the first attempt made instead of a second
    // one. Never selected, and never sent (`serializeWishlist`).
    idempotencyKey: {
      type: String,
      required: false,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

// A wishlist without an owner is unreachable and unmanageable — never allow one.
// This only runs on create/save, not on `updateOne`: removals are guarded by the
// conditional write in `removeWishlistOwner` instead.
WishlistSchema.path('owners').validate(
  (v: mongoose.Types.ObjectId[]) => Array.isArray(v) && v.length > 0,
  'A wishlist must have at least one owner'
);

// "My wishlists" / profile listings look up by owner.
WishlistSchema.index({ owners: 1 });
// The daily occasion reminders look lists up by their occasion's stored date
// (lib/utils/occasionReminders.ts).
WishlistSchema.index({ 'occasion.date': 1 });
// One list per creating request: a retry racing the first attempt is refused
// here and answered with the first one's list. Partial: lists made any other
// way carry no key.
WishlistSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } }
);

// Base document type
export interface IWishlist {
  _id: mongoose.Types.ObjectId;
  name: string;
  slug?: string | null;
  description?: string | null;
  owners: mongoose.Types.ObjectId[];
  visibility: 'everyone' | 'friends' | 'private';
  archived?: boolean;
  currency?: string;
  featuredBy: mongoose.Types.ObjectId[];
  /**
   * Whether this list is the *viewer's* dashboard highlight. Not stored: it's
   * persisted per-owner in `featuredBy`, and API responses fold it down to this
   * boolean for the caller (see `serializeWishlist`).
   */
  featured?: boolean;
  bannerUrl?: string | null;
  /** Absent on lists saved before occasions existed: treat as none. */
  occasion?: Occasion | null;
  /** Only on a list made by a copy (WIS-325); never selected or sent. */
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const Wishlist: Model<IWishlist> =
  mongoose.models.Wishlist || mongoose.model<IWishlist>('Wishlist', WishlistSchema);

export default Wishlist;
