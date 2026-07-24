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
    // Default to node; component tests opt into jsdom via a
    // `// @vitest-environment jsdom` docblock at the top of the file.
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    // Dummy env so modules that read env at import time (e.g. lib/mongodb) don't
    // throw. API tests mock lib/mongodb and use an in-memory server instead.
    env: {
      MONGODB_URI: 'mongodb://127.0.0.1:27017/test',
      NEXTAUTH_URL: 'http://localhost:3000',
      NEXTAUTH_SECRET: 'test-secret',
      EMAIL_FROM: 'test@example.com',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '587',
      SMTP_SECURE: 'false',
      SMTP_USER: 'test',
      SMTP_PASSWORD: 'test',
      MIGRATION_SECRET: 'test-migration-secret',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['lib/**/*.ts', 'components/**/*.tsx', 'app/api/**/*.ts'],
      exclude: ['**/*.d.ts', 'test/**'],
    },
    // mongodb-memory-server can take a moment to boot on first run.
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
