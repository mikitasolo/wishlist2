import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

/**
 * Spins up an in-memory MongoDB and connects mongoose to it. API tests mock
 * `@/lib/mongodb` so the route's `connectDB()` becomes a no-op — this shared
 * mongoose connection is what actually backs the models.
 */
let mongod: MongoMemoryServer | null = null;

/**
 * Runs `start` again when it fails on a port that's already in use. Every test
 * file starts its own server on a random free port, and with files running in
 * parallel another one can take that port before mongod binds it (WIS-413).
 */
export async function retryOnPortInUse<T>(start: () => Promise<T>, attempts = 5): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await start();
    } catch (error) {
      const portInUse = error instanceof Error && /already in use/i.test(error.message);
      if (!portInUse || attempt >= attempts) throw error;
    }
  }
}

export async function connectTestDB(): Promise<void> {
  mongod = await retryOnPortInUse(() => MongoMemoryServer.create());
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
