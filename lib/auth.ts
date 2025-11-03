import { NextAuthOptions } from 'next-auth';
import EmailProvider from 'next-auth/providers/email';
import connectDB from './mongodb';
import User from '@/models/User';
import { sendMagicLinkEmail } from './email';
import { adapter } from './authAdapter';

export const authOptions: NextAuthOptions = {
  adapter,
  providers: [
    EmailProvider({
      server: '', // We'll use custom sendVerificationRequest
      from: process.env.EMAIL_FROM || 'noreply@wishlist.app',
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
        const existingUser = await User.findOne({ email: user.email.toLowerCase() });

        // Only allow sign in if user is invited
        if (!existingUser || !existingUser.isInvited) {
          return false;
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
            session.user.role = dbUser.role;
            session.user.id = dbUser._id?.toString();
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
  secret: process.env.NEXTAUTH_SECRET,
};

