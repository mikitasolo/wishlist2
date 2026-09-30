import { test, expect, type Page } from '@playwright/test';

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

// Toasts dismiss themselves after 4s, so a retrying `toHaveCount(0)` would pass
// once a wrong one had come and gone. Count the moment the expected one shows.
async function expectNoToast(page: Page, text: string) {
  expect(await toast(page, text).count(), `"${text}" toast`).toBe(0);
}

// regression: the delete handlers ignored useDeleteItem's `false`, so a failed
// delete still dropped the item from the list and closed its modal, and the
// review modal's path toasted "Proposed item deleted" right after the error.
for (const flow of [
  {
    from: 'edit',
    item: 'E2E Gift',
    open: 'Edit item',
    title: 'Edit Item',
    success: 'Item deleted successfully',
  },
  {
    from: 'review',
    item: 'E2E Proposal',
    open: 'Review proposed item',
    title: 'Review Proposed Item',
    success: 'Proposed item deleted',
  },
]) {
  test(`regression: a failed delete from the ${flow.from} modal keeps the item and the modal`, async ({
    page,
  }) => {
    await addProposal(page);
    await answerItemDelete(page);
    await page.goto('/wishlists/e2e-birthday');

    const card = page.getByRole('article', { name: `Item: ${flow.item}` });
    await card.getByRole('button', { name: flow.open }).click();
    const dialog = page.getByRole('dialog', { name: flow.title });
    await dialog.getByRole('button', { name: 'Delete Item' }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();

    await expect(toast(page, 'Something went wrong')).toBeVisible();
    await expectNoToast(page, flow.success);
    await expect(page.getByRole('alertdialog')).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Delete Item' })).toBeEnabled();
    await expect(card).toBeVisible();
  });
}

// regression: deleting a proposal toasted twice, the hook's generic "Item
// deleted successfully" on top of the page's "Proposed item deleted".
test('regression: deleting a proposal removes it and says so once', async ({ page }) => {
  let deleted = false;
  await addProposal(page, () => !deleted);
  await answerItemDelete(page, () => {
    deleted = true;
  });
  await page.goto('/wishlists/e2e-birthday');

  const card = page.getByRole('article', { name: 'Item: E2E Proposal' });
  await card.getByRole('button', { name: 'Review proposed item' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review Proposed Item' });
  await dialog.getByRole('button', { name: 'Delete Item' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(toast(page, 'Proposed item deleted')).toBeVisible();
  await expectNoToast(page, 'Item deleted successfully');
  await expect(dialog).toBeHidden();
  await expect(card).toBeHidden();
});
