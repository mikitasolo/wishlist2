import mongoose from 'mongoose';
import Wishlist from '@/models/Wishlist';
import connectDB from '@/lib/mongodb';

/** Slugs: lowercase, alphanumeric words joined by single hyphens. */
export const WISHLIST_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Slugs that would collide with real routes under /wishlists/*.
const RESERVED = new Set(['new', 'mine', 'shared']);

export function isReservedWishlistSlug(slug: string): boolean {
  return RESERVED.has(slug.toLowerCase());
}

/** Turn a wishlist name into a slug base (no uniqueness guarantee). */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD') // decompose accents; combining marks fall out below
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

function shortHash(): string {
  return Math.random().toString(36).slice(2, 7); // 5 base36 chars
}

/**
 * Generate a unique slug from a name: `slugified-name` + a short hash suffix,
 * retrying with a fresh hash on the (rare) collision. Requires a DB connection.
 */
export async function generateUniqueWishlistSlug(name: string): Promise<string> {
  await connectDB();
  const base = slugifyName(name) || 'list';
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = `${base}-${shortHash()}`;
    if (isReservedWishlistSlug(candidate)) continue;
    const taken = await Wishlist.exists({ slug: candidate });
    if (!taken) return candidate;
  }
  // Extremely unlikely fallback.
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Resolve a route param that may be a Mongo ObjectId or a slug to the
 * wishlist's real id string. Returns null if nothing matches.
 */
export async function resolveWishlistId(idOrSlug: string): Promise<string | null> {
  await connectDB();
  // A 24-char hex string is treated as an id first.
  if (/^[a-f0-9]{24}$/i.test(idOrSlug) && mongoose.Types.ObjectId.isValid(idOrSlug)) {
    const byId = await Wishlist.findById(idOrSlug).select('_id');
    if (byId) return byId._id.toString();
  }
  const bySlug = await Wishlist.findOne({ slug: idOrSlug }).select('_id');
  return bySlug ? bySlug._id.toString() : null;
}
