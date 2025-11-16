import { MongoClient } from 'mongodb';
import { MongoDBAdapter } from '@auth/mongodb-adapter';

// MONGODB_URI is validated by validateEnvVars() in lib/env.ts
const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error('MONGODB_URI environment variable is not set');
}
const options = {};

let client: MongoClient;
let clientPromise: Promise<MongoClient>;

type GlobalWithMongo = typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
};

if (process.env.NODE_ENV === 'development') {
  // In development mode, use a global variable to preserve the client across hot reloads
  const globalWithMongo: GlobalWithMongo = global;

  if (!globalWithMongo._mongoClientPromise) {
    client = new MongoClient(uri, options);
    globalWithMongo._mongoClientPromise = client.connect();
  }
  clientPromise = globalWithMongo._mongoClientPromise;
} else {
  // In production mode, create a new client
  client = new MongoClient(uri, options);
  clientPromise = client.connect();
}

export const adapter = MongoDBAdapter(clientPromise);
