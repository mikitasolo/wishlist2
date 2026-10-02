import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// The prompt's suggestion comes from the browser's time zone. The seeded user
// is on USD and hasn't answered it yet. Like the sign-up specs' magic links,
// this works once per run: the answer it records stays (nothing clears it).
test.use({ timezoneId: 'Europe/Warsaw' });

const prompt = (page: Page) => page.getByRole('region', { name: 'Show prices in PLN?' });

/** How far the page scrolls sideways: 0 when it fits the screen. */
const sidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('the dashboard offers a USD user their time zone’s currency once, and “Choose another…” opens the picker', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await expect(prompt(page)).toBeVisible();
  expect(await sidewaysScroll(page)).toBe(0);

  await prompt(page).getByRole('button', { name: 'Choose another…' }).click();
  await expect(page).toHaveURL(/\/settings#currency$/);
  await expect(page.getByRole('combobox', { name: 'Default currency' })).toBeFocused();

  // Answered, so a fresh session no longer offers it.
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Account menu/ })).toBeVisible();
  await expect(page.locator('.skeleton')).toHaveCount(0);
  await expect(prompt(page)).toHaveCount(0);
});
