import NextAuth from 'next-auth';
import Nodemailer from 'next-auth/providers/nodemailer';
import { adapter } from './authAdapter';
import { getEnvVars } from './env';
import { endPreviousSession } from './utils/previousSession';
import { sessionPayload } from './utils/sessionPayload';
import { isVerifiedSignIn, sendVerificationRequest } from './signInEmail';

// Get validated environment variables
const env = getEnvVars();

// NextAuth v5 (Auth.js): a single config exports the route `handlers`, the
// server-side `auth()` helper (replaces v4's getServerSession(authOptions)),
// and the `signIn`/`signOut` server actions.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  // Required outside Vercel's auto-detected environment (local, CI, self-host):
  // trust the incoming Host header when deriving callback URLs.
  trustHost: true,
  providers: [
    // v4's EmailProvider is `Nodemailer` in v5. Our custom sendVerificationRequest
    // rate-limits, then sends the mail via lib/email (which honours
    // EMAIL_TRANSPORT), so this transport is never actually dialed — but v5
    // validates that `server` is present at init. In `smtp` mode we point it at
    // the real SMTP config (harmless, and correct if the custom sender is ever
    // removed); in `console` mode there is none, so we give it nodemailer's JSON
    // transport, which never sends anything either.
    Nodemailer({
      server:
        env.EMAIL_TRANSPORT === 'smtp'
          ? {
              host: env.SMTP_HOST,
              port: Number(env.SMTP_PORT),
              secure: env.SMTP_SECURE === 'true',
              auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
            }
          : { jsonTransport: true },
      from: env.EMAIL_FROM,
      sendVerificationRequest,
    }),
  ],
  callbacks: {
    // Registration is open, but this callback doesn't create the account: it
    // runs when the magic link is requested as well as when it's clicked, and
    // an account made at the request made Auth.js treat every sign-up as a
    // returning user, so `pages.newUser` never fired. The adapter's
    // `createUser` (lib/utils/userAccount.ts) creates it on the first verified
    // sign-in instead.
    async signIn({ user, email }) {
      if (!user.email) return false;
      // Auth.js is about to send a magic link (`verificationRequest`): only for
      // the sign-in form's server action, once its Turnstile check has passed.
      // Clicking the link calls this again without `verificationRequest`, from
      // outside the action.
      if (email?.verificationRequest && !isVerifiedSignIn()) return false;
      return true;
    },
    // With database sessions Auth.js passes `session` as `{ ...sessionRow,
    // user: userRow }`, the raw rows, session token included, and whatever this
    // returns is what `auth()` and GET /api/auth/session give out. So it
    // returns sessionPayload's explicit allowlist, built fresh, never `session`
    // or anything spread from it.
    //
    // `user` is the account's row, which the adapter read for this very check
    // (`getSessionAndUser`), so the session is built from it with no read of
    // our own.
    async session({ session, user }) {
      return sessionPayload(user as unknown as Record<string, unknown>, session.expires);
    },
  },
  events: {
    // A sign-up ends the session the browser was signed in with as someone
    // else, as Auth.js already does when signing in to an existing account.
    // Here rather than in `createUser`: this runs once the new account's own
    // session exists, so a sign-up that fails can't sign the browser out.
    async signIn({ user, isNewUser }) {
      if (isNewUser && user.id) await endPreviousSession(adapter, user.id);
    },
  },
  pages: {
    signIn: '/auth/signin',
    verifyRequest: '/auth/verify-request',
    error: '/auth/error',
    // A brand-new account's first sign-in lands here (with the original
    // `callbackUrl` passed along) to offer a username of their own in place of
    // the generated one. Auth.js only sends a sign-in here when the adapter
    // created the account during it, so existing accounts never see it.
    newUser: '/welcome',
  },
  session: {
    strategy: 'database',
  },
  secret: env.NEXTAUTH_SECRET,
});
