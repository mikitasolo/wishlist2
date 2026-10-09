import { test, expect } from './fixtures';

// The bookmarklet's landing page (WIS-365): the product is in the URL's
// fragment, you pick a list, review the prefilled form, and save. The save is
// answered in the browser, so nothing reaches the seeded database.

const FRAGMENT =
  '#name=E2E%20Mug&price=24.90&currency=EUR&link=https%3A%2F%2Fshop.example.com%2Fmug';

test('opens a prefilled form for the picked list and saves it', async ({ page }) => {
  let posted: Record<string, unknown> | null = null;
  await page.route('**/api/wishlists/*/items', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posted = route.request().postDataJSON();
    return route.fulfill({
      json: { success: true, data: { _id: '0000000000000000000e2e02', name: 'E2E Mug' } },
    });
  });

  await page.goto(`/items/new${FRAGMENT}`);

  const picker = page.getByRole('dialog', { name: 'Add to a wishlist' });
  // The product is out of the address bar once read.
  await expect(picker).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');

  await picker
    .getByRole('button', { name: /Birthday/ })
    .first()
    .click();
  const form = page.getByRole('dialog', { name: /^Add to / });
  await expect(form.getByLabel('Item name *')).toHaveValue('E2E Mug');
  await expect(form.getByLabel('Product link')).toHaveValue('https://shop.example.com/mug');
  await expect(form.getByLabel('Price', { exact: true })).toHaveValue('24.90');

  await form.getByRole('button', { name: 'Add to list' }).click();
  await expect(page).toHaveURL(/\/wishlists\/e2e-birthday$/);
  expect(posted).toMatchObject({
    name: 'E2E Mug',
    price: { value: 2490, currency: 'EUR' },
    link: 'https://shop.example.com/mug',
  });
});

test('opens the plain add flow for an empty fragment', async ({ page }) => {
  await page.goto('/items/new');
  const picker = page.getByRole('dialog', { name: 'Add to a wishlist' });
  await picker
    .getByRole('button', { name: /Birthday/ })
    .first()
    .click();
  await expect(
    page.getByRole('dialog', { name: /^Add to / }).getByLabel('Item name *')
  ).toHaveValue('');
});
