import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    globals: true,
    // Vitest owns test/**; Playwright specs live in e2e/** (see playwright.config.ts).
    include: ['test/**/*.test.{ts,tsx}'],
    // Default to node; component tests opt into jsdom via a
    // `// @vitest-environment jsdom` docblock at the top of the file.
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    // next-auth's ESM imports `next/server` without an extension, which Node's
    // own resolver refuses; letting Vite process it resolves it, so a test can
    // run the real Auth.js route handlers (test/api/authSession.test.ts).
    server: { deps: { inline: ['next-auth'] } },
    // Dummy env so modules that read env at import time (e.g. lib/mongodb) don't
    // throw. API tests mock lib/mongodb and use an in-memory server instead.
    env: {
      MONGODB_URI: 'mongodb://127.0.0.1:27017/test',
      NEXTAUTH_URL: 'http://localhost:3000',
      NEXTAUTH_SECRET: 'test-secret',
      EMAIL_FROM: 'test@example.com',
      // Pinned so a dev shell exporting EMAIL_TRANSPORT=console can't change
      // what the suite runs; tests that need console mode stub it themselves.
      EMAIL_TRANSPORT: 'smtp',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USER: 'test',
      SMTP_PASSWORD: 'test',
      MIGRATION_SECRET: 'test-migration-secret',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html'],
      // Measure the surface our harness can exercise directly: API route
      // handlers, components, pure lib logic, and models. Full-page components
      // (app/**/page.tsx) are covered by Playwright E2E, not unit tests, so
      // they're intentionally out of scope here.
      include: ['app/api/**/*.ts', 'components/**/*.tsx', 'lib/**/*.ts', 'models/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        'test/**',
        // Infra with no branching logic of our own to cover.
        'lib/mongodb.ts',
        'lib/auth.ts',
        'app/api/auth/**',
      ],
      thresholds: {
        // A non-regression *ratchet*, set just under today's actuals — not an
        // aspiration. Coverage can only go up from here without failing `npm run verify`.
        // Measured on 2026-10-01 with Vitest 5's v8 provider: statements 81.05,
        // branches 78.08, functions 77.17, lines 81.72. Vitest 4 changed how v8
        // coverage is counted (from the code's structure, every function and
        // logical branch included), so don't compare against numbers from
        // Vitest 3. Raise these as real coverage grows; never lower them to make
        // a change pass.
        lines: 81,
        statements: 80,
        functions: 76,
        branches: 77,
      },
    },
    // mongodb-memory-server can take a moment to boot on first run.
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
