import type { Locator, Page } from '@playwright/test';
import { test, expect, failedRequest } from './fixtures';

// The seeded list has one owner, and "Make member" only shows on a co-owner's
// row when there's more than one. So a co-owner is added in the browser, to the
// wishlist's `owners` and to the members GET, and the demotion is answered there
// too: nothing reaches the database, so the other specs keep their lists.
const coOwnerId = '0000000000000000000e2115';
const coOwner = { _id: coOwnerId, username: 'e2ecoowner', image: null };

const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const SECOND_ANSWER = 'Already done';

/**
 * Show the co-owner on the page. Once `isDemoted()` they come back from the
 * members GET as a plain member, and the wishlist GET no longer lists them as an
 * owner, the way the server answers after a demotion.
 */
async function addCoOwner(page: Page, isDemoted: () => boolean) {
  await page.route('**/api/wishlists/e2e-birthday', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    if (!body.success) return route.fulfill({ response, json: body });
    const owners = isDemoted() ? body.data.owners : [...body.data.owners, coOwnerId];
    await route.fulfill({ response, json: { ...body, data: { ...body.data, owners } } });
  });
  await page.route('**/api/wishlists/*/members', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    if (!body.success) return route.fulfill({ response, json: body });
    const row = isDemoted()
      ? { _id: '0000000000000000000e2116', user: coOwner, role: 'member' }
      : { _id: coOwnerId, user: coOwner, role: 'owner' };
    const data = [...body.data, { ...row, createdAt: '2026-01-01T00:00:00.000Z' }];
    await route.fulfill({ response, json: { ...body, data } });
  });
}

async function openOwners(page: Page) {
  await page.goto('/wishlists/e2e-birthday');
  await page.getByRole('button', { name: 'Manage wishlist' }).click();
  await expect(page.getByRole('link', { name: `@${coOwner.username}` })).toBeVisible();
}

// regression: "Make member" had no confirmation and no in-flight guard, so a
// double click sent two demotions before the refresh moved the row. The first
// demoted the co-owner; the second found they were no longer an owner, and its
// error toast followed the success. The second variant clicks twice in one
// task, before React has rendered the button disabled, so only the handler's
// own guard can turn it away.
for (const variant of [
  { name: 'a double click', click: (button: Locator) => button.dblclick() },
  {
    name: 'two clicks before the page re-renders',
    click: (button: Locator) =>
      button.evaluate((el: HTMLElement) => {
        el.click();
        el.click();
      }),
  },
]) {
  test(`regression: ${variant.name} on Make member sends one demotion`, async ({ page }) => {
    // Every PATCH is held until `answer()`, so both clicks land while the first
    // is in flight. Then they're answered the way the server would: the first
    // succeeds, any later one finds nobody left to demote.
    let requests = 0;
    let demoted = false;
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    await addCoOwner(page, () => demoted);
    await page.route(`**/api/wishlists/*/owners/${coOwnerId}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      requests += 1;
      const first = requests === 1;
      await answered;
      if (!first) {
        return route.fulfill({ status: 404, json: { success: false, error: SECOND_ANSWER } });
      }
      demoted = true;
      await route.fulfill({ json: { success: true } });
    });

    await openOwners(page);
    // In the header and on the signed-in user's own row, while there are two owners.
    const leave = page.getByRole('button', { name: 'Leave', exact: true });
    await expect(leave).toHaveCount(2);
    const makeMember = page.getByRole('button', { name: 'Make member' });
    await variant.click(makeMember);

    // While the demotion runs, the row takes no more clicks. Soft, so the request
    // count below is checked either way.
    await expect.poll(() => requests).toBeGreaterThan(0);
    await expect.soft(makeMember).toBeDisabled();
    await expect.soft(page.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled();

    answer();
    await expect(toast(page, 'Owner is now a member')).toBeVisible();
    expect(requests).toBe(1);
    // Counted the moment the success shows: toasts dismiss themselves after 4s.
    expect(await toast(page, SECOND_ANSWER).count()).toBe(0);
    // The refresh moved them to Members, where the row offers "Make owner".
    await expect(makeMember).toBeHidden();
    await expect(page.getByRole('button', { name: 'Make owner' })).toBeVisible();
    // The signed-in user is the only owner left, so they can't leave: the
    // header's Leave is gone, and the one left on their own row explains why.
    await expect(leave).toHaveCount(1);
    await leave.click();
    await expect(page.getByRole('alertdialog', { name: "You're the only owner" })).toBeVisible();
  });
}

test('a failed demotion gives the buttons back, so it can be retried', async ({
  page,
  consoleErrors,
}) => {
  // The demotion failed on purpose (the page only toasts it).
  consoleErrors.allow(failedRequest(new RegExp(`/api/wishlists/[^/]+/owners/${coOwnerId}`)));
  let requests = 0;
  let demoted = false;
  await addCoOwner(page, () => demoted);
  await page.route(`**/api/wishlists/*/owners/${coOwnerId}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    requests += 1;
    if (requests === 1) {
      return route.fulfill({ status: 500, json: { success: false, error: 'Try again later' } });
    }
    demoted = true;
    await route.fulfill({ json: { success: true } });
  });

  await openOwners(page);
  const makeMember = page.getByRole('button', { name: 'Make member' });
  await makeMember.click();

  await expect(toast(page, 'Try again later')).toBeVisible();
  await expect(makeMember).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Remove', exact: true })).toBeEnabled();

  await makeMember.click();
  await expect(toast(page, 'Owner is now a member')).toBeVisible();
  expect(requests).toBe(2);
  await expect(makeMember).toBeHidden();
  // Make member goes as soon as the page counts one owner, before the members
  // refresh lands: wait for that to move them to Members, so the test doesn't
  // end with the refresh still in the route above.
  await expect(page.getByRole('button', { name: 'Make owner' })).toBeVisible();
});
