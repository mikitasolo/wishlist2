import type { AdapterUser } from 'next-auth/adapters';
import connectDB from '@/lib/mongodb';
import User, { type IUser } from '@/models/User';
import { duplicateKeyField } from './mongoErrors';
import { generateUniqueUsername } from './username';

function toAdapterUser(user: Pick<IUser, '_id' | 'email' | 'emailVerified' | 'image'>) {
  return {
    id: user._id.toString(),
    email: user.email,
    emailVerified: user.emailVerified ?? null,
    image: user.image ?? null,
  } satisfies AdapterUser;
}

/**
 * How many generated usernames to try. `generateUniqueUsername` checks each is
 * free, but another sign-up could take the same one before this insert lands.
 */
const MAX_USERNAME_ATTEMPTS = 3;

/**
 * The adapter's `createUser` (`lib/authAdapter.ts`), and so the one place an
 * account is created: Auth.js calls it on someone's first verified sign-in,
 * when the magic link they clicked names an email with no account yet. Doing
 * it here, rather than in the `signIn` callback (which also runs when the link
 * is merely requested), is what makes Auth.js treat the sign-in as a sign-up
 * and send the person to `pages.newUser` (the welcome page) exactly once.
 *
 * The row goes through the Mongoose model, so it gets the schema's defaults and
 * timestamps like every other account, and a username from
 * `generateUniqueUsername`, which never derives one from the email.
 *
 * Two first sign-ins for one email (two links clicked at once) race here, and
 * the loser's insert hits the unique email index: it resolves to the winner's
 * row instead of failing the sign-in. A generated username someone else took
 * in the meantime is drawn again. No error leaves with the database's own
 * duplicate-key message, which quotes the clashing value: Auth.js logs every
 * adapter error whole, and that value is an email.
 */
export async function createUserAccount(data: AdapterUser): Promise<AdapterUser> {
  await connectDB();
  const email = data.email.toLowerCase();
  for (let attempt = 1; ; attempt++) {
    const username = await generateUniqueUsername();
    try {
      const user = await User.create({
        email,
        emailVerified: data.emailVerified ?? null,
        username,
      });
      return toAdapterUser(user);
    } catch (error) {
      const field = duplicateKeyField(error);
      if (field === null) throw error;
      if (field === 'username' && attempt < MAX_USERNAME_ATTEMPTS) continue;
      if (field === 'email') {
        const existing = await User.findOne({ email });
        if (existing) return toAdapterUser(existing);
      }
      throw new Error(`Could not create the account (duplicate ${field})`);
    }
  }
}
