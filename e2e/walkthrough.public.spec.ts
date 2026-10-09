import { test, expect } from './fixtures';
import { TOUR_SESSION_TOKEN } from './magicLinks';

// WIS-371: a fresh account gets the guided walkthrough, can skip it, is told
// where to find it again, and doesn't see it again on reload.

// The skip is stored on the one seeded account, so a retry would only find the
// tour already done. The first failure is the one to read.
test.describe.configure({ retries: 0 });

test('a fresh account sees the tour, skips it, and it stays gone on reload', async ({ page }) => {
  await page.context().addCookies([
    {
      name: 'authjs.session-token',
      value: TOUR_SESSION_TOKEN,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/');

  // The one tour, from its first step: New list is on Home, so it points there.
  const step = page.getByRole('dialog', { name: 'Lists for every occasion' });
  await expect(step).toBeVisible();
  await expect(step).toContainText(/^1 of [67]/);

  const skipped = page.waitForResponse(
    (r) => r.url().endsWith('/api/users/me') && r.request().method() === 'PATCH'
  );
  await step.getByRole('button', { name: 'Skip tour' }).click();
  expect((await skipped).ok()).toBe(true);
  await expect(step).toHaveCount(0);
  await expect(page.getByText('You can take the tour again any time in Settings')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Settings' })).toHaveAttribute(
    'href',
    '/settings#tour'
  );

  // The account remembers it, so the next visit has nothing due.
  const status = page.waitForResponse(
    (r) => r.url().endsWith('/api/users/me') && r.request().method() === 'GET'
  );
  await page.reload();
  expect((await (await status).json()).data.walkthrough.due).toBeNull();
  await expect(page.getByRole('button', { name: 'New list' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
