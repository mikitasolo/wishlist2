import { cookies } from 'next/headers';
import type { Adapter } from 'next-auth/adapters';
import { errorKind } from './errorKind';

/**
 * Auth.js's default database-session cookie (we don't override `cookies`): the
 * `__Secure-` prefixed name on https, the bare one on http (local dev, E2E).
 * A test pins these to Auth.js's own defaults, so a rename upstream fails CI.
 */
export const SESSION_COOKIE_NAMES = [
  '__Secure-authjs.session-token',
  'authjs.session-token',
] as const;

/**
 * End the session a sign-up request carried, when it belongs to another
 * account. `events.signIn` (lib/auth.ts) calls it once Auth.js has signed a
 * brand-new account in, i.e. after that account's own session exists, so a
 * failed sign-up can't log the browser out for nothing.
 *
 * Signing in to an existing account already does this (Auth.js's
 * existing-user branch deletes the session it replaces), but its new-user
 * branch doesn't. So a browser signed in as A that opened a sign-up link for a
 * new email B would otherwise leave A's session valid until it expires, though
 * the browser has swapped its cookie for B's. Like Auth.js, it keeps a session
 * that is already the new account's (two links for one new email, raced in
 * one browser), and goes through the adapter to find and delete it.
 *
 * Best-effort: the sign-up stands whatever happens here, and a failure is
 * logged as its kind only, never with the token, the email or a user id.
 */
export async function endPreviousSession(
  adapter: Pick<Adapter, 'getSessionAndUser' | 'deleteSession'>,
  newUserId: string
): Promise<void> {
  try {
    const jar = await cookies();
    const tokens = new Set(SESSION_COOKIE_NAMES.flatMap((name) => jar.get(name)?.value || []));
    for (const token of tokens) {
      const current = await adapter.getSessionAndUser?.(token);
      if (current?.user.id === newUserId) continue;
      await adapter.deleteSession?.(token);
    }
  } catch (error) {
    console.error('Could not end the previous session on sign-up:', errorKind(error));
  }
}
