import { test, expect, type Page } from '@playwright/test';

// The add/propose modals only close once the create request succeeds. The POST
// is failed in the browser, so nothing reaches the seeded database.
async function failItemCreate(page: Page) {
  await page.route('**/api/wishlists/*/items', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 500, json: { success: false, error: 'Something went wrong' } })
      : route.continue()
  );
}

// regression: the page closed the add modal whatever the outcome, and swallowed
// a failed proposal so its modal closed too — the user's input was thrown away.
for (const flow of [
  {
    as: 'owner',
    list: 'e2e-birthday',
    open: '+ Add Item',
    title: 'Add New Item',
    submit: 'Add Item',
  },
  {
    as: 'member',
    list: 'e2e-friend',
    open: '+ Propose Item',
    title: 'Propose New Item',
    submit: 'Propose Item',
  },
]) {
  test(`regression: the ${flow.as}'s "${flow.title}" modal keeps the input when the request fails`, async ({
    page,
  }) => {
    await failItemCreate(page);
    await page.goto(`/wishlists/${flow.list}`);
    await page.getByRole('button', { name: flow.open }).click();

    const dialog = page.getByRole('dialog', { name: flow.title });
    await dialog.getByLabel('Item Name').fill('E2E Bike');
    await dialog.getByLabel('Price').fill('120');
    await dialog.getByRole('button', { name: flow.submit, exact: true }).click();

    await expect(page.getByRole('status').getByText('Something went wrong')).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Item Name')).toHaveValue('E2E Bike');
    await expect(dialog.getByLabel('Price')).toHaveValue('120');
    await expect(dialog.getByRole('button', { name: flow.submit, exact: true })).toBeEnabled();
  });
}
