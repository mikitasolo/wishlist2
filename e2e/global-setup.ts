import type { FullConfig } from '@playwright/test';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { spawn, type ChildProcess } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { E2E_BLOB_ENV } from './blobEnv';
import { E2E_PORT } from '../playwright.config';
import User from '../models/User';
import Wishlist from '../models/Wishlist';
import Item from '../models/Item';
import WishlistMember from '../models/WishlistMember';
import {
  E2E_AUTH_SECRET,
  FRIEND_API_SESSION_TOKEN,
  FRIEND_SESSION_TOKEN,
  MAGIC_LINKS,
} from './magicLinks';

const BASE_URL = `http://localhost:${E2E_PORT}`;

// Handles stashed for global-teardown (same Playwright process).
declare global {
  var __E2E__: { mongo?: MongoMemoryServer; server?: ChildProcess } | undefined;
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env, stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    p.on('error', reject);
  });
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`E2E: server at ${url} did not become ready in ${timeoutMs}ms`);
}

export default async function globalSetup(_config: FullConfig) {
  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('e2e');

  // Seed a signed-in user + content, and a database session the way the Auth.js
  // MongoDB adapter would, then write a Playwright storageState carrying its
  // cookie so the "authed" project is logged in without the magic-link flow.
  await mongoose.connect(uri);
  const user = await User.create({
    email: 'e2e-user@example.com',
    username: 'e2euser',
    defaultCurrency: 'USD',
  });
  const wishlist = await Wishlist.create({
    name: 'E2E Birthday List',
    owners: [user._id],
    visibility: 'everyone',
    slug: 'e2e-birthday',
    currency: 'USD',
  });
  await Item.create({ wishlist: wishlist._id, name: 'E2E Gift', status: 'available' });

  // Someone else's list the E2E user is a member of, so specs can take the
  // member side (proposing an item).
  const friend = await User.create({
    email: 'e2e-friend@example.com',
    username: 'e2efriend',
    defaultCurrency: 'USD',
  });
  const friendList = await Wishlist.create({
    name: 'E2E Friend List',
    owners: [friend._id],
    visibility: 'everyone',
    slug: 'e2e-friend',
    currency: 'USD',
  });
  await WishlistMember.create({ wishlist: friendList._id, user: user._id });

  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await mongoose.connection.collection('sessions').insertMany([
    { sessionToken, userId: user._id, expires },
    // For the spec that signs up while signed in as someone else (magicLinks.ts).
    { sessionToken: FRIEND_SESSION_TOKEN, userId: friend._id, expires },
    // For a spec that acts as the friend through the API (magicLinks.ts).
    { sessionToken: FRIEND_API_SESSION_TOKEN, userId: friend._id, expires },
  ]);

  // Unused magic links (see magicLinks.ts), stored the way Auth.js stores the
  // token it emails, so the sign-up spec can follow one without any email.
  await mongoose.connection.collection('verification_tokens').insertMany(
    Object.values(MAGIC_LINKS).map(({ email, token }) => ({
      identifier: email,
      token: createHash('sha256').update(`${token}${E2E_AUTH_SECRET}`).digest('hex'),
      expires,
    }))
  );
  await mongoose.disconnect();

  const storageState = {
    cookies: [
      {
        name: 'authjs.session-token', // Auth.js v5 default on http (non-secure)
        value: sessionToken,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
        expires: Math.floor(expires.getTime() / 1000),
      },
    ],
    origins: [],
  };
  const authDir = path.join(process.cwd(), 'e2e', '.auth');
  await mkdir(authDir, { recursive: true });
  await writeFile(path.join(authDir, 'user.json'), JSON.stringify(storageState, null, 2));

  // Build once and run a production server (fast, stable page loads vs. dev's
  // on-demand compilation). Dummy env; E2E never sends mail, so the console
  // transport stands in for SMTP (which also proves the app runs without it).
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MONGODB_URI: uri,
    NEXTAUTH_SECRET: E2E_AUTH_SECRET,
    NEXTAUTH_URL: BASE_URL,
    AUTH_TRUST_HOST: 'true',
    EMAIL_TRANSPORT: 'console',
    EMAIL_FROM: 'e2e@example.com',
    MIGRATION_SECRET: 'e2e-migration',
    // Turnstile off and no rate-limit store, whatever a local .env holds (one
    // pulled from Vercel carries the KV_* store): an empty value counts as set,
    // so Next's env loading doesn't fill it in from a file. The sign-in spec
    // sends a magic link, and its fail-closed limiters would otherwise count
    // every workspace's runs from localhost against one shared store.
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: '',
    TURNSTILE_SECRET_KEY: '',
    UPSTASH_REDIS_REST_URL: '',
    UPSTASH_REDIS_REST_TOKEN: '',
    KV_REST_API_URL: '',
    KV_REST_API_TOKEN: '',
    // Never the real Blob store, whatever a local .env holds (WIS-221).
    ...E2E_BLOB_ENV,
  };

  // Call the local next binary directly (package-manager agnostic).
  const nextBin = path.join(process.cwd(), 'node_modules', '.bin', 'next');
  await run(nextBin, ['build'], env);
  const server = spawn(nextBin, ['start', '-p', String(E2E_PORT)], {
    env,
    stdio: 'inherit',
  });

  globalThis.__E2E__ = { mongo, server };

  await waitForServer(BASE_URL, 90_000);
}
