/**
 * Magic links for the sign-up spec. global-setup stores a verification token
 * for each, the way the Auth.js MongoDB adapter does when it emails one (the
 * stored token is a hash of the link's token and the secret), so following a
 * link here signs in through Auth.js's real callback without any email. Each
 * token is single-use: one test per link.
 */

/** The `NEXTAUTH_SECRET` the E2E server runs with, which the stored hashes depend on. */
export const E2E_AUTH_SECRET = 'e2e-secret-e2e-secret-e2e-secret-0';

export const MAGIC_LINKS = {
  /** Emails with no account yet: following one is a sign-up. */
  newcomerKeeps: { email: 'e2e-newcomer-keeps@example.com', token: 'e2e-signup-keeps' },
  newcomerPicks: { email: 'e2e-newcomer-picks@example.com', token: 'e2e-signup-picks' },
  newcomerSwitches: { email: 'e2e-newcomer-switches@example.com', token: 'e2e-signup-switches' },
  /** Signs up through a Join link, by way of the welcome page (WIS-339). */
  newcomerJoins: { email: 'e2e-newcomer-joins@example.com', token: 'e2e-signup-joins' },
  /** The seeded friend account, so following it is a returning sign-in. */
  returning: { email: 'e2e-friend@example.com', token: 'e2e-signin-returning' },
  /** The friend again, signing in to join a list through its Join link (WIS-337). */
  friendJoins: { email: 'e2e-friend@example.com', token: 'e2e-signin-join' },
} as const;

/** The path a magic-link email would point at, continuing to `callbackUrl`. */
export function magicLinkPath(
  { email, token }: { email: string; token: string },
  callbackUrl: string
): string {
  return `/api/auth/callback/nodemailer?${new URLSearchParams({ callbackUrl, token, email })}`;
}

/**
 * A database session global-setup gives the seeded friend (`e2efriend`), for a
 * browser that is already signed in as them when it opens a sign-up link.
 */
export const FRIEND_SESSION_TOKEN = 'e2e-friend-session';

/**
 * A second session for the friend, for a spec that acts as them through the
 * API (following the E2E user, so they have something unread). The sign-up
 * spec ends `FRIEND_SESSION_TOKEN`, so this one is separate.
 */
export const FRIEND_API_SESSION_TOKEN = 'e2e-friend-api-session';
