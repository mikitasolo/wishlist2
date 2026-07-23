import User from '@/models/User';

/** Usernames: 3–20 chars, start with a letter, then letters/digits/underscore. */
export const USERNAME_REGEX = /^[a-z][a-z0-9_]{2,19}$/;

const RESERVED = new Set([
  'admin',
  'root',
  'support',
  'help',
  'api',
  'settings',
  'wishlist',
  'wishlists',
  'user',
  'users',
  'me',
  'about',
  'login',
  'signin',
  'signup',
  'auth',
]);

export function isReservedUsername(name: string): boolean {
  return RESERVED.has(name.toLowerCase());
}

/** Turn an email (or any string) into a valid username base. */
function baseFromEmail(email: string): string {
  let base = (email.split('@')[0] || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  if (!/^[a-z]/.test(base)) base = `u${base}`;
  base = base.slice(0, 18);
  while (base.length < 3) base += '0';
  return base;
}

/**
 * Generate a unique username derived from an email, appending a numeric
 * suffix on collision. Requires an active DB connection.
 */
export async function generateUniqueUsername(email: string): Promise<string> {
  const base = baseFromEmail(email);
  const candidates = [base, ...Array.from({ length: 9999 }, (_, i) => `${base}${i + 2}`)];
  for (const candidate of candidates) {
    const trimmed = candidate.slice(0, 20);
    if (isReservedUsername(trimmed)) continue;
    const taken = await User.exists({ username: trimmed });
    if (!taken) return trimmed;
  }
  // Extremely unlikely fallback
  return `${base.slice(0, 12)}${Date.now().toString(36)}`.slice(0, 20);
}
