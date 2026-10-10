import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// Groups (WIS-27): tag someone you follow into a group from their profile, see
// it in Settings → Groups, and unfollowing takes them out. Everything made here
// is put back (the follow, the group), since the seeded user is shared by every
// spec.

test('tag someone you follow into a new group, and unfollowing takes them out', async ({
  page,
}) => {
  await page.goto('/users/e2efriend');
  // Only people you follow can be tagged.
  await expect(page.getByRole('button', { name: 'Follow @e2efriend' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tag @e2efriend into groups' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Follow @e2efriend' }).click();

  await page.getByRole('button', { name: 'Tag @e2efriend into groups' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tag @e2efriend into groups' });
  await dialog.getByLabel('New group').fill('E2E family');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog.getByRole('checkbox', { name: 'E2E family' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.goto('/settings#groups');
  const group = page.getByRole('region', { name: 'E2E family' });
  await expect(group.getByRole('link', { name: '@e2efriend' })).toBeVisible();

  // Unfollowing takes them out of the group. It waits out an Undo window
  // (WIS-387): dismissing its toast sends it now.
  await page.goto('/users/e2efriend');
  await page.getByRole('button', { name: 'Unfollow @e2efriend' }).click();
  await expect(page.getByRole('button', { name: 'Follow @e2efriend' })).toBeVisible();
  await sendNow(page, /\/api\/users\/[^/]+\/follow$/);
  await page.goto('/settings#groups');
  await expect(group.getByText('0 people')).toBeVisible();
  await expect(group.getByRole('link', { name: '@e2efriend' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Actions for E2E family' }).click();
  await page.getByRole('menuitem', { name: 'Delete group' }).click();
  await expect(page.getByRole('region', { name: 'E2E family' })).toHaveCount(0);
  await sendNow(page, /\/api\/users\/me\/groups\/[^/]+$/);
});

/** Dismisses the Undo toast, which sends its DELETE at once, and waits for it to land. */
async function sendNow(page: Page, url: RegExp) {
  const sent = page.waitForResponse(
    (res) => url.test(new URL(res.url()).pathname) && res.request().method() === 'DELETE'
  );
  await page
    .getByRole('status')
    .filter({ has: page.getByRole('button', { name: 'Undo' }) })
    .getByRole('button', { name: 'Dismiss notification' })
    .click();
  expect((await sent).ok()).toBe(true);
}
