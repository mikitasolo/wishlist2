import { test, expect, type Page } from '@playwright/test';

// The seeded owner list has no members, so one is added to the members GET in
// the browser, and removing them is answered there too: nothing reaches the database.
const member = {
  _id: '0000000000000000000e2e89',
  user: { _id: '0000000000000000000e2e90', username: 'e2emember', image: null },
  role: 'member',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

// regression: ConfirmDialog had no pending state, and confirmKickMember only
// closes it once the request settles, so a double click on Remove sent two
// DELETEs. The second got a 404, and its error toast followed the success one.
test('regression: a double click on Remove Member sends one request', async ({ page }) => {
  let removed = false;
  await page.route('**/api/wishlists/*/members', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    if (removed || !body.success) return route.fulfill({ response, json: body });
    await route.fulfill({ response, json: { ...body, data: [...body.data, member] } });
  });

  // Every DELETE is held until `answer()`, so both clicks land while the first
  // is in flight. Then they're answered the way the server would: the first
  // removes the member, any later one finds no membership.
  let deletes = 0;
  let answer!: () => void;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  await page.route(`**/api/wishlists/*/members/${member._id}`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    deletes += 1;
    const first = deletes === 1;
    await answered;
    if (!first) {
      return route.fulfill({
        status: 404,
        json: { success: false, error: 'Membership not found' },
      });
    }
    removed = true;
    await route.fulfill({ json: { success: true } });
  });

  await page.goto('/wishlists/e2e-birthday');
  await page.getByRole('button', { name: 'Manage wishlist' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();

  const confirm = page.getByRole('alertdialog');
  await confirm.getByRole('button', { name: 'Remove', exact: true }).dblclick();

  // While the request runs, the dialog says so and takes no more clicks. Soft,
  // so the request count below is checked either way.
  await expect.poll(() => deletes).toBeGreaterThan(0);
  await expect.soft(confirm.getByRole('button', { name: 'Removing...' })).toBeDisabled();
  await expect.soft(confirm.getByRole('button', { name: 'Cancel' })).toBeDisabled();

  answer();
  await expect(toast(page, 'Member removed successfully')).toBeVisible();
  expect(deletes).toBe(1);
  // Counted the moment the success shows: toasts dismiss themselves after 4s.
  expect(await toast(page, 'Membership not found').count()).toBe(0);
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('link', { name: '@e2emember' })).toBeHidden();
});
