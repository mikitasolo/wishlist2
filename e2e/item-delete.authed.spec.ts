import type { Page } from '@playwright/test';
import { test, expect, failedRequest } from './fixtures';

// Every DELETE here is answered in the browser, so nothing reaches the seeded
// database and the other specs keep their items.
async function answerItemDelete(page: Page, onDelete?: () => void) {
  await page.route('**/api/items/*', (route) => {
    if (route.request().method() !== 'DELETE') return route.continue();
    if (!onDelete) {
      return route.fulfill({
        status: 500,
        json: { success: false, error: 'Something went wrong' },
      });
    }
    onDelete();
    return route.fulfill({ json: { success: true } });
  });
}

// Owners can't create proposals and specs can't reach the database, so the
// owner's item list gets a proposal added in the browser (until `listed` says
// it's gone, the way the server would stop returning a deleted item).
async function addProposal(page: Page, listed: () => boolean = () => true) {
  await page.route('**/api/wishlists/*/items', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (!listed() || !body.success) return route.fulfill({ response, json: body });
    const proposal = {
      _id: '0000000000000000000e2e01',
      wishlist: body.data[0]?.wishlist ?? '',
      name: 'E2E Proposal',
      status: 'proposed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    return route.fulfill({ response, json: { ...body, data: [proposal, ...body.data] } });
  });
}

const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

// Toasts dismiss themselves after a few seconds, so a retrying `toHaveCount(0)`
// would pass once a wrong one had come and gone. Count the moment the expected
// one shows.
async function expectNoToast(page: Page, text: string) {
  expect(await toast(page, text).count(), `"${text}" toast`).toBe(0);
}

// A delete waits out its Undo window (WIS-387); dismissing the toast sends it at once.
async function sendNow(page: Page, text: string) {
  await toast(page, text).getByRole('button', { name: 'Dismiss notification' }).click();
}

// WIS-387: Delete and Decline ask nothing. The item goes at once, with Undo,
// and nothing is sent until the Undo window has passed.
for (const flow of [
  {
    from: 'edit',
    item: 'E2E Gift',
    open: 'Edit item',
    title: 'Edit item',
    remove: 'Delete item',
    success: 'Item deleted',
  },
  {
    from: 'review',
    item: 'E2E Proposal',
    open: 'Review proposed item',
    title: 'Someone proposed an item',
    remove: 'Decline',
    success: 'Proposal declined',
  },
]) {
  test(`Undo after a delete from the ${flow.from} modal keeps the item and sends nothing`, async ({
    page,
  }) => {
    let deletes = 0;
    await addProposal(page);
    await answerItemDelete(page, () => {
      deletes += 1;
    });
    await page.goto('/wishlists/e2e-birthday');

    const card = page.getByRole('article', { name: `Item: ${flow.item}` });
    await card.getByRole('button', { name: flow.open }).click();
    const dialog = page.getByRole('dialog', { name: flow.title });
    await dialog.getByRole('button', { name: flow.remove, exact: true }).click();

    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(dialog).toBeHidden();
    await expect(card).toBeHidden();
    await toast(page, flow.success).getByRole('button', { name: 'Undo' }).click();
    await expect(card).toBeVisible();
    // Past the Undo window: still nothing sent.
    await page.waitForTimeout(5500);
    expect(deletes).toBe(0);
    await expect(card).toBeVisible();
  });

  // regression: the delete handlers ignored useDeleteItem's `false`, so a failed
  // delete still dropped the item from the list. Deferred, it comes back.
  test(`regression: a failed delete from the ${flow.from} modal puts the item back`, async ({
    page,
    consoleErrors,
  }) => {
    // The failed DELETE, and the app's log line for it.
    consoleErrors.allow(failedRequest(/\/api\/items\/\w+/), /^Error deleting item: /);
    await addProposal(page);
    await answerItemDelete(page);
    await page.goto('/wishlists/e2e-birthday');

    const card = page.getByRole('article', { name: `Item: ${flow.item}` });
    await card.getByRole('button', { name: flow.open }).click();
    const dialog = page.getByRole('dialog', { name: flow.title });
    await dialog.getByRole('button', { name: flow.remove, exact: true }).click();
    await expect(card).toBeHidden();
    await sendNow(page, flow.success);

    await expect(toast(page, 'Something went wrong')).toBeVisible();
    await expect(card).toBeVisible();
  });
}

// regression: deleting a proposal toasted twice, the hook's generic "Item
// deleted successfully" on top of the page's own (now "Proposal declined").
test('regression: declining a proposal removes it and says so once', async ({ page }) => {
  let deleted = false;
  await addProposal(page, () => !deleted);
  await answerItemDelete(page, () => {
    deleted = true;
  });
  await page.goto('/wishlists/e2e-birthday');

  const card = page.getByRole('article', { name: 'Item: E2E Proposal' });
  await card.getByRole('button', { name: 'Review proposed item' }).click();
  const dialog = page.getByRole('dialog', { name: 'Someone proposed an item' });
  await dialog.getByRole('button', { name: 'Decline', exact: true }).click();

  await expect(toast(page, 'Proposal declined')).toBeVisible();
  await expectNoToast(page, 'Item deleted');
  await expect(dialog).toBeHidden();
  await expect(card).toBeHidden();
  await sendNow(page, 'Proposal declined');
  await expect.poll(() => deleted).toBe(true);
  await expect(card).toBeHidden();
});
