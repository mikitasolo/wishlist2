import { test, expect } from './fixtures';

// regression (WIS-340): an open dialog pins the page with `position: fixed;
// top: -scrollY` (useBodyScrollLock), so a print card printed after scrolling
// down to Share links landed above the paper and the PDF came out blank.
test('a link’s print card prints on the page after scrolling down to it', async ({ page }) => {
  // A phone, where Share links sits well below the fold.
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/wishlists/e2e-birthday?tab=people');

  await page.getByRole('button', { name: 'New link' }).click();
  await page
    .getByRole('dialog', { name: 'New link' })
    .getByRole('button', { name: 'Create link' })
    .click();
  await expect(page.getByRole('dialog', { name: 'New link' })).toBeHidden();

  const actions = page.getByRole('button', { name: /^Actions for / }).first();
  await actions.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await actions.click();
  await page.getByRole('menuitem', { name: 'QR code' }).click();
  await expect(page.getByRole('dialog', { name: 'QR code' })).toBeVisible();

  await page.emulateMedia({ media: 'print' });
  const card = page.getByTestId('qr-print-card');
  await expect(card).toBeVisible();
  // On the paper: its top at the page's top, not scrolled away above it.
  const box = await card.boundingBox();
  expect(box!.y + (await page.evaluate(() => window.scrollY))).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  await page.emulateMedia({ media: 'screen' });

  // Leave the list as it was: revoke the link.
  await page
    .getByRole('dialog', { name: 'QR code' })
    .getByRole('button', { name: /close/i })
    .first()
    .click();
  await actions.click();
  await page.getByRole('menuitem', { name: 'Revoke' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke link' }).click();
  await expect(page.getByText('No share links yet', { exact: false })).toBeVisible();
});
