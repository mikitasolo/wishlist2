import { randomInt } from 'node:crypto';
import User from '@/models/User';

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

/** Generated handles: `user_` plus this many random lowercase base36 characters. */
export const GENERATED_USERNAME_PREFIX = 'user_';
const SUFFIX_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SUFFIX_LENGTH = 8;
/**
 * How many taken handles in a row it takes to give up. 36^8 (about 2.8 × 10^12)
 * suffixes make even one collision vanishingly rare, so hitting this means the
 * lookup is broken, not that the namespace is full.
 */
const MAX_ATTEMPTS = 20;

function randomHandle(): string {
  let suffix = '';
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    suffix += SUFFIX_ALPHABET[randomInt(SUFFIX_ALPHABET.length)];
  }
  return `${GENERATED_USERNAME_PREFIX}${suffix}`;
}

/**
 * A fresh, unused username for a new account (or a legacy one without a
 * username), e.g. `user_4f9k2x7q`. Its suffix is crypto-random, so the handle
 * carries nothing about the person: it deliberately takes no input, and in
 * particular never sees the email, since a handle is public and the email
 * never is. The user can pick their own on the welcome page or in settings.
 * Requires an active DB connection.
 */
export async function generateUniqueUsername(): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Never reserved: every reserved name is shorter than a generated handle.
    const candidate = randomHandle();
    const taken = await User.exists({ username: candidate });
    if (!taken) return candidate;
  }
  throw new Error('Could not generate an unused username');
}
