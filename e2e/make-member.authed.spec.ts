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
  // The list's own read, by slug or (once loaded) by id: the page addresses it by
  // its id after the first read (WIS-285).
  await page.route(/\/api\/wishlists\/[^/?]+(\?.*)?$/, async (route) => {
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
  await page.goto('/wishlists/e2e-birthday?tab=people');
  await expect(rowMenu(page)).toBeVisible();
}

/** The ⋯ menu on the co-owner's row, on People. */
const rowMenu = (page: Page) =>
  page.getByRole('button', { name: `Actions for @${coOwner.username}` });

/** Open the co-owner's row menu and return its item `name`. */
async function rowItem(page: Page, name: string) {
  await rowMenu(page).click();
  return page.getByRole('menuitem', { name });
}
/** The dialog Make member asks in before anything is sent. */
const demoteDialog = (page: Page) =>
  page.getByRole('alertdialog', { name: `Make @${coOwner.username} a member?` });
const DEMOTED = `@${coOwner.username} is now a member`;

/** Leave list…, from the ⋯ menu in the list's header. */
async function pickLeave(page: Page) {
  await page.getByRole('button', { name: 'More list actions' }).click();
  await page.getByRole('menuitem', { name: 'Leave list…' }).click();
}

/** Open the co-owner's Make member dialog and confirm it. */
async function demote(page: Page) {
  await (await rowItem(page, 'Make member…')).click();
  await demoteDialog(page).getByRole('button', { name: 'Make member' }).click();
}

/** Their row's menu offers `name`, and can act on it; closed again after. */
async function expectRowOffers(page: Page, name: string) {
  const item = await rowItem(page, name);
  await expect(item).toBeVisible();
  await expect(item).not.toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
}

// regression: "Make member" had no confirmation and no in-flight guard, so a
// double click sent two demotions before the refresh moved the row. The first
// demoted the co-owner; the second found they were no longer an owner, and its
// error toast followed the success. It now asks first, so the clicks land on
// its dialog's confirm. The second variant clicks twice in one task, before
// React has rendered the button disabled, so only the handlers' own guards can
// turn it away.
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
    // While there are two owners, Leave list… asks to confirm stepping down.
    await pickLeave(page);
    const leaveDialog = page.getByRole('alertdialog', { name: 'Leave “E2E Birthday List”?' });
    await leaveDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(leaveDialog).toBeHidden();
    await (await rowItem(page, 'Make member…')).click();
    const dialog = demoteDialog(page);
    await expect(dialog).toContainText('Making them an owner again needs their acceptance.');
    await variant.click(dialog.getByRole('button', { name: 'Make member' }));

    // While the demotion runs, the dialog says so, and takes no more clicks.
    // Soft, so the request count below is checked either way.
    await expect.poll(() => requests).toBeGreaterThan(0);
    await expect.soft(dialog.getByRole('button', { name: 'Making member…' })).toBeDisabled();
    await expect.soft(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    answer();
    await expect(toast(page, DEMOTED)).toBeVisible();
    expect(requests).toBe(1);
    // Counted the moment the success shows: toasts dismiss themselves after 4s.
    expect(await toast(page, SECOND_ANSWER).count()).toBe(0);
    await expect(dialog).toBeHidden();
    // The refresh moved them to Members, where the row offers "Make owner…".
    await expectRowOffers(page, 'Make owner…');
    // The signed-in user is the only owner left, so they can't leave: their
    // Leave list… explains why instead.
    await pickLeave(page);
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
  await demote(page);

  await expect(toast(page, 'Try again later')).toBeVisible();
  await expect(demoteDialog(page)).toBeHidden();
  await expectRowOffers(page, 'Make member…');
  await expectRowOffers(page, 'Remove…');

  await demote(page);
  await expect(toast(page, DEMOTED)).toBeVisible();
  expect(requests).toBe(2);
  // Wait for the members refresh to move them to Members, so the test doesn't
  // end with the refresh still in the route above.
  await expectRowOffers(page, 'Make owner…');
});
