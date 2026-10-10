import { test, expect } from './fixtures';
import { TOUR_SESSION_TOKEN } from './magicLinks';

// WIS-371: a fresh account gets the guided walkthrough, can skip it, is told
// where to find it again, and doesn't see it again on reload. WIS-436: the
// tour takes them to the page a step is about and moves on when they use the
// control it points at (with no list of their own, the practice list).

// The skip is stored on the one seeded account, so a retry would only find the
// tour already done. The first failure is the one to read.
test.describe.configure({ retries: 0 });

test('a fresh account tries the tour, skips it, and it stays gone on reload', async ({ page }) => {
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
  const first = page.getByRole('dialog', { name: 'Lists for every occasion' });
  await expect(first).toBeVisible();
  await expect(first).toContainText(/^1 of [89]/);
  await first.getByRole('button', { name: 'Next' }).click();

  // No list of their own: adding items is tried on the practice list's owner view.
  await expect(page).toHaveURL(/\/tour\/mine$/);
  const adding = page.getByRole('dialog', { name: 'Adding items' });
  await expect(adding).toContainText('Tap Add item to try it.');
  await page.getByRole('button', { name: 'Add item', exact: true }).first().click();
  // The tour steps aside for the dialog the tile opened, and moves on once it closes.
  const addDialog = page.getByRole('dialog', { name: 'Add item' });
  await expect(addDialog).toBeVisible();
  await expect(adding).toHaveCount(0);
  await addDialog.getByRole('button', { name: 'Cancel' }).click();
  const sharing = page.getByRole('dialog', { name: 'Sharing' });
  await expect(sharing).toBeVisible();

  // Skipping on the practice list goes Home.
  const skipped = page.waitForResponse(
    (r) => r.url().endsWith('/api/users/me') && r.request().method() === 'PATCH'
  );
  await sharing.getByRole('button', { name: 'Skip tour' }).click();
  expect((await skipped).ok()).toBe(true);
  await expect(sharing).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('You can take the tour again any time in Settings')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Settings' })).toHaveAttribute(
    'href',
    '/settings#tour'
  );

  // The account remembers it, so the next visit has nothing due. (Asked
  // directly: the skip's own page change can still be loading Home's reads.)
  const status = await page.request.get('/api/users/me');
  expect((await status.json()).data.walkthrough.due).toBeNull();
  await page.reload();
  await expect(page.getByRole('button', { name: 'New list' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
