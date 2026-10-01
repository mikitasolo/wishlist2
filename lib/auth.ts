import NextAuth from 'next-auth';
import Nodemailer from 'next-auth/providers/nodemailer';
import connectDB from './mongodb';
import User from '@/models/User';
import { adapter } from './authAdapter';
import { getEnvVars } from './env';
import { generateUniqueUsername } from './utils/username';
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
    async session({ session, user }) {
      if (session.user && user?.email) {
        try {
          await connectDB();
          const dbUser = await User.findOne({ email: user.email.toLowerCase() });

          if (dbUser) {
            // Lazily backfill a username for legacy users who predate the field.
            if (!dbUser.username) {
              dbUser.username = await generateUniqueUsername();
              await dbUser.save();
            }
            // Always set identity fields when the user exists
            session.user.id = dbUser._id.toString();
            session.user.email = user.email;
            session.user.username = dbUser.username || undefined;
            session.user.image = dbUser.image || undefined;
            session.user.defaultCurrency = dbUser.defaultCurrency || 'USD';
          } else {
            // This shouldn't happen, but handle gracefully. Logged without the email
            // or any other identifier: anyone with project access reads these logs.
            console.error('User not found in database during session callback');
          }
        } catch (error) {
          console.error('Error in session callback:', error);
        }
      }
      return session;
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
