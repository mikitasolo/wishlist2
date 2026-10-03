import { defineConfig, devices } from '@playwright/test';
import { workspacePorts } from './scripts/dev-port.mjs';

// The app server + ephemeral MongoDB are started in global-setup.ts (Playwright
// evaluates this config as CJS, so no top-level await / webServer with a
// dynamic DB URI). Port is decided here and reused there: 3100 in the main
// checkout, and in an agent workspace one above its own dev port
// (scripts/dev-port.mjs), so parallel worktrees don't collide. `E2E_PORT`
// overrides it.
export const E2E_PORT = workspacePorts(process.env, __dirname).e2e;
const BASE_URL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'public',
      testMatch: /.*\.public\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: { cookies: [], origins: [] } },
    },
    {
      name: 'authed',
      testMatch: /.*\.authed\.spec\.ts/,
      // Signed-in via the session cookie written by global-setup.
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
    },
  ],
});
