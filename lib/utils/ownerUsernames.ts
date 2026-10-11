import User from '@/models/User';
import { ownerIds, primaryOwnerId, type OwnedWishlist } from '@/lib/utils/wishlistOwners';

/**
 * A list's owners as other people see them: their public usernames, ordered
 * like `owners` (so the primary owner comes first), less any owner without
 * one, plus the primary owner's alone. Never an email. The list's `GET` and
 * a signed-out visitor's server-drawn `/l/<token>` page (WIS-447) both name
 * owners through this, so the byline drawn on the server is the one the read
 * answers.
 */
export async function readOwnerUsernames(
  wishlist: OwnedWishlist
): Promise<{ ownerUsernames: string[]; ownerUsername: string | null }> {
  const owners = ownerIds(wishlist);
  const users = await User.find({ _id: { $in: owners } })
    .select('username')
    .lean();
  const usernameById = new Map(users.map((u) => [String(u._id), u.username]));
  const primaryId = primaryOwnerId(wishlist);
  return {
    ownerUsernames: owners.map((id) => usernameById.get(id)).filter((u): u is string => !!u),
    ownerUsername: (primaryId && usernameById.get(primaryId)) || null,
  };
}
