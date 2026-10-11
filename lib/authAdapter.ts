import { MongoClient } from 'mongodb';
import { MongoDBAdapter } from '@auth/mongodb-adapter';
import type { Adapter } from 'next-auth/adapters';
import { createUserAccount } from './utils/userAccount';

// MONGODB_URI is validated by validateEnvVars() in lib/env.ts
const MONGODB_URI_ENV = process.env.MONGODB_URI;
if (!MONGODB_URI_ENV) {
  throw new Error('MONGODB_URI environment variable is not set');
}
const uri: string = MONGODB_URI_ENV;

type GlobalWithMongo = typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient> | null;
};

// On the global so development's hot reloads share one client.
const cache: GlobalWithMongo = global;

/**
 * The adapter's client, connected on its first use and shared after that. A
 * failed connect is dropped so the next call starts over: the driver closes a
 * client whose connect failed for good ("Topology is closed"). The connect used
 * to start at import, so when a cold start's connect timed out nothing was
 * awaiting it (an unhandled rejection, Sentry WISHLIST-3/4), and its rejected
 * promise failed every sign-in on that instance after it.
 */
function connectedClient(): Promise<MongoClient> {
  cache._mongoClientPromise ??= new MongoClient(uri).connect().catch((error: unknown) => {
    cache._mongoClientPromise = null;
    throw error;
  });
  return cache._mongoClientPromise;
}

// Accounts are created through our own `createUser`, on the first verified
// sign-in: it gives the row the User model's defaults and a generated username
// (see lib/utils/userAccount.ts).
export const adapter: Adapter = {
  ...MongoDBAdapter(connectedClient),
  createUser: createUserAccount,
};
