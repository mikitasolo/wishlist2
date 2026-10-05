import mongoose, { Schema, Model } from 'mongoose';
import {
  SHARE_LINK_LABEL_MAX,
  SHARE_LINK_LEVELS,
  type ShareLinkLevel,
} from '@/lib/utils/shareLinkFields';

/**
 * A list's share link (the Share links project): a secret, revocable URL,
 * `/l/<token>`, that opens the list for whoever holds it (`view`) or lets them
 * join it as a member (`join`), whatever the list's visibility.
 *
 * - **The token is the access.** Nothing is stored about who opened a link.
 *   It's kept in the clear (owners copy a link again), and only ever sent to
 *   the list's owners: the owners' link list and the create answer. Never on,
 *   or spread into, the `Wishlist` document (`serializeWishlist` spreads it),
 *   and never in a log (a duplicate-key error quotes it: log `errorKind`).
 * - **Links belong to the list**, not to whoever made it: any owner may edit or
 *   revoke any of them. `createdBy` is only a record, cleared when that account
 *   is deleted (`deleteAccount`); deleting the list deletes its links
 *   (`deleteOwnedWishlist`).
 * - **The level never changes** after creation (the edit schema refuses it).
 * - **Expired** means `expiresAt <= now`. An expired link stays (counted
 *   against the cap, listed to owners as expired) and a later `expiresAt`
 *   brings it back. Resolve one only through `resolveShareLink`
 *   (`lib/utils/shareLinks.ts`), which treats expired, unknown, archived and
 *   deleted the same.
 */
const ShareLinkSchema = new Schema(
  {
    wishlist: { type: Schema.Types.ObjectId, ref: 'Wishlist', required: true },
    token: { type: String, required: true },
    level: { type: String, enum: SHARE_LINK_LEVELS, required: true },
    // An owner's note to tell links apart ("Family chat"). Owner-written free
    // text: escape it in HTML and keep it out of email subjects.
    label: { type: String, trim: true, maxlength: SHARE_LINK_LABEL_MAX, default: null },
    // Missing (or null) for a link that never expires.
    expiresAt: { type: Date, default: null },
    // Set with the Day after the occasion preset (WIS-342): `expiresAt` is then
    // the start of the day after the occasion in `timeZone` (the IANA zone of
    // whoever set it), kept so by `syncOccasionLinks`. Owners only.
    untilOccasion: { type: Boolean, default: false },
    timeZone: { type: String, default: null },
    // Null once that account is deleted.
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// A token opens exactly one link. The collection is new, so Mongoose's autoIndex
// builds it on an empty collection and no migration is needed.
ShareLinkSchema.index({ token: 1 }, { unique: true });
// A list's links, newest first (the owners' list, the cap, the list delete).
ShareLinkSchema.index({ wishlist: 1, createdAt: -1 });
// The links an account made (its deletion clears `createdBy`).
ShareLinkSchema.index({ createdBy: 1 });

export interface IShareLink {
  _id: mongoose.Types.ObjectId;
  wishlist: mongoose.Types.ObjectId;
  token: string;
  level: ShareLinkLevel;
  label: string | null;
  expiresAt: Date | null;
  /** Missing on links made before WIS-342: read as false. */
  untilOccasion?: boolean;
  timeZone?: string | null;
  createdBy: mongoose.Types.ObjectId | null;
  createdAt: Date;
}

const ShareLink: Model<IShareLink> =
  mongoose.models.ShareLink || mongoose.model<IShareLink>('ShareLink', ShareLinkSchema);

export default ShareLink;
