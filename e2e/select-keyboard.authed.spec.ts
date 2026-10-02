import { test, expect } from './fixtures';

// What the component tests can't show: the built app's own event handling
// (React's on `document` and on the portalled modal's <body>, beside the
// modal's Escape listener on `document`), and a real button, which clicks
// itself on Enter and on Space's keyup. Nothing here is saved: the sort choice
// lives in the browser, and the create-wishlist modal is closed without
// creating.

// Tall enough for the Sort menu, which opens below its trigger whatever the
// room there (WIS-214), to fit in the viewport for a click.
test.use({ viewport: { width: 1280, height: 1600 } });

// regression: on a page, the menu's options came after everything else in the
// Tab order, so the keyboard couldn't reach them.
test('regression: picks the sort order on the wishlist page from the keyboard', async ({
  page,
}) => {
  await page.goto('/wishlists/e2e-birthday');
  const sort = page.getByRole('combobox', { name: 'Sort items by' });
  const menu = page.getByRole('listbox', { name: 'Sort items by' });
  await expect(sort).toHaveText('Most Wanted First');

  await sort.focus();
  await page.keyboard.press('Space');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(sort).toHaveText('Name (A-Z)');
  await expect(sort).toBeFocused();

  // Escape and Tab close it without changing the value.
  await page.keyboard.press('ArrowDown');
  await expect(menu).toBeVisible();
  await page.keyboard.press('End');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(menu).toBeHidden();
  await expect(sort).not.toBeFocused();
  await expect(sort).toHaveText('Name (A-Z)');

  // The mouse works as it did.
  await sort.click();
  await menu.getByRole('option', { name: 'Price (Low to High)' }).click();
  await expect(menu).toBeHidden();
  await expect(sort).toHaveText('Price (Low to High)');
});

// regression: Escape on the open menu also closed the modal around it.
test('regression: Escape on the currency menu in the create-wishlist modal closes only the menu', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New wishlist' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create new wishlist' });
  const currency = dialog.getByRole('combobox', { name: 'Wishlist currency' });
  const menu = page.getByRole('listbox', { name: 'Wishlist currency' });

  await currency.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(currency).toBeFocused();

  // The next Escape is the modal's.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
