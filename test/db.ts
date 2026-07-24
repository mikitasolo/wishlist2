import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

/**
 * Spins up an in-memory MongoDB and connects mongoose to it. API tests mock
 * `@/lib/mongodb` so the route's `connectDB()` becomes a no-op — this shared
 * mongoose connection is what actually backs the models.
 */
let mongod: MongoMemoryServer | null = null;

export async function connectTestDB(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}

export async function disconnectTestDB(): Promise<void> {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
  mongod = null;
}

/** Wipe every collection between tests for isolation. */
export async function clearTestDB(): Promise<void> {
  const { collections } = mongoose.connection;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}
