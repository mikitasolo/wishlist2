import { test, expect } from './fixtures';

// WIS-46: discreet mode ("No spoiler mode") is a device switch in the header, one tap from any
// page. It fits a 320px phone, survives a reload, and covers Reserved until Show.
test('discreet mode: on from the header, kept across a reload, covers Reserved', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/booked');
  await expect(page.getByRole('heading', { name: 'Reserved by you' })).toBeVisible();
  const toggle = page.getByRole('switch', { name: 'No spoiler mode' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(toggle).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: /^Account menu/ })).toBeInViewport({ ratio: 1 });

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: 'Show' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
  ).toBe(0);

  await page.reload();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByRole('button', { name: 'Show' })).toHaveCount(0);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});
