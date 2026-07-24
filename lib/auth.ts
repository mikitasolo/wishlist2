import NextAuth from 'next-auth';
import Nodemailer from 'next-auth/providers/nodemailer';
import connectDB from './mongodb';
import User from '@/models/User';
import { sendMagicLinkEmail } from './email';
import { adapter } from './authAdapter';
import { getEnvVars } from './env';
import { generateUniqueUsername } from './utils/username';

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
    // sends the mail via lib/email, so this transport is never actually dialed —
    // but v5 validates that `server` is present at init, so we point it at the
    // real SMTP config from env (harmless, and correct if the custom sender is
    // ever removed).
    Nodemailer({
      server: {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT),
        secure: env.SMTP_SECURE === 'true',
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      },
      from: env.EMAIL_FROM,
      async sendVerificationRequest({ identifier: email, url }) {
        await sendMagicLinkEmail(email, url);
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;

      try {
        await connectDB();
        let existingUser = await User.findOne({ email: user.email.toLowerCase() });

        // If user doesn't exist, create them (open registration) with a
        // generated username derived from their email.
        if (!existingUser) {
          const username = await generateUniqueUsername(user.email.toLowerCase());
          existingUser = await User.create({
            email: user.email.toLowerCase(),
            username,
          });
        }

        return true;
      } catch (error) {
        console.error('Error in signIn callback:', error);
        return false;
      }
    },
    async session({ session, user }) {
      if (session.user && user?.email) {
        try {
          await connectDB();
          const dbUser = await User.findOne({ email: user.email.toLowerCase() });

          if (dbUser) {
            // Lazily backfill a username for legacy users who predate the field.
            if (!dbUser.username) {
              dbUser.username = await generateUniqueUsername(dbUser.email);
              await dbUser.save();
            }
            // Always set identity fields when the user exists
            session.user.id = dbUser._id.toString();
            session.user.email = user.email;
            session.user.username = dbUser.username || undefined;
            session.user.image = dbUser.image || undefined;
            session.user.defaultCurrency = dbUser.defaultCurrency || 'USD';
          } else {
            // This shouldn't happen, but handle gracefully
            console.error('User not found in database during session callback:', user.email);
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
  },
  session: {
    strategy: 'database',
  },
  secret: env.NEXTAUTH_SECRET,
});
