import type { FullConfig } from '@playwright/test';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { E2E_PORT } from '../playwright.config';
import User from '../models/User';
import Wishlist from '../models/Wishlist';
import Item from '../models/Item';

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
    owner: user._id,
    visibility: 'everyone',
    isPublic: true,
    slug: 'e2e-birthday',
    currency: 'USD',
  });
  await Item.create({ wishlist: wishlist._id, name: 'E2E Gift', status: 'available' });

  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await mongoose.connection.collection('sessions').insertOne({
    sessionToken,
    userId: user._id,
    expires,
  });
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
  // on-demand compilation). Dummy env — E2E never sends mail.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MONGODB_URI: uri,
    NEXTAUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0',
    NEXTAUTH_URL: BASE_URL,
    AUTH_TRUST_HOST: 'true',
    SMTP_HOST: 'localhost',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: 'e2e',
    SMTP_PASSWORD: 'e2e',
    EMAIL_FROM: 'e2e@example.com',
    MIGRATION_SECRET: 'e2e-migration',
  };

  await run('npm', ['run', 'build'], env);
  const server = spawn('npm', ['run', 'start', '--', '-p', String(E2E_PORT)], {
    env,
    stdio: 'inherit',
  });

  globalThis.__E2E__ = { mongo, server };

  await waitForServer(BASE_URL, 90_000);
}
