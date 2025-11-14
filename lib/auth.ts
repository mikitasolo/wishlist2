import { NextAuthOptions } from 'next-auth';
import EmailProvider from 'next-auth/providers/email';
import connectDB from './mongodb';
import User from '@/models/User';
import { sendMagicLinkEmail } from './email';
import { adapter } from './authAdapter';
import { getEnvVars } from './env';

// Get validated environment variables
const env = getEnvVars();

export const authOptions: NextAuthOptions = {
  adapter,
  providers: [
    EmailProvider({
      server: '', // We'll use custom sendVerificationRequest
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

        // If user doesn't exist, create them (open registration)
        if (!existingUser) {
          existingUser = await User.create({
            email: user.email.toLowerCase(),
          });
        }

        return true;
      } catch (error) {
        console.error('Error in signIn callback:', error);
        return false;
      }
    },
    async session({ session, user }) {
      if (session.user && user.email) {
        try {
          await connectDB();
          const dbUser = await User.findOne({ email: user.email.toLowerCase() });
          
          if (dbUser) {
            // Always set id and email when user exists
            session.user.id = dbUser._id.toString();
            session.user.email = user.email;
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
};

