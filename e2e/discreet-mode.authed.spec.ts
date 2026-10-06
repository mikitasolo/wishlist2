import { test, expect } from './fixtures';

// WIS-46: discreet mode is a device switch, in the account menu. It survives a
// reload, the header says it's on (and fits a 320px phone), and Reserved is
// covered until Show.
test('discreet mode: on from the account menu, kept across a reload, covers Reserved', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/booked');
  await expect(page.getByRole('heading', { name: 'Reserved by you' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Discreet mode is on/ })).toHaveCount(0);

  await page.getByRole('button', { name: /^Account menu/ }).click();
  await page.getByRole('menuitem', { name: 'Turn on discreet mode' }).click();

  const indicator = page.getByRole('button', { name: /^Discreet mode is on/ });
  await expect(indicator).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Show' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
  ).toBe(0);

  await page.reload();
  await expect(indicator).toBeVisible();
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByRole('button', { name: 'Show' })).toHaveCount(0);

  await indicator.click();
  await expect(indicator).toHaveCount(0);
});
