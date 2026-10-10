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

/**
 * The prompt's buttons whose label doesn't sit on one line inside them. The
 * buttons have a fixed height, so a label that wraps spills out of them.
 */
const crampedButtons = (page: Page) =>
  prompt(page).evaluate((region) =>
    Array.from(region.querySelectorAll('button'))
      .filter((button) => {
        const label = document.createRange();
        label.selectNodeContents(button);
        const text = label.getBoundingClientRect();
        const box = button.getBoundingClientRect();
        const oneLine = text.height < 1.5 * parseFloat(getComputedStyle(button).lineHeight);
        return !oneLine || text.left < box.left || text.right > box.right;
      })
      .map((button) => button.textContent)
  );

test('the dashboard offers a USD user their time zone’s currency once, and “Keep USD” answers it without leaving', async ({
  page,
}) => {
  // regression: the second button read "Choose another…", whose ellipsis looked
  // like a label cut off for lack of room; and the buttons were `sm` (a fixed
  // h-9) with nothing to stop a label wrapping out of them.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(prompt(page)).toBeVisible();
  expect(await crampedButtons(page)).toEqual([]);
  // No label ends in an ellipsis, which reads as text truncated by the layout.
  const labels = await prompt(page).getByRole('button').allTextContents();
  expect(labels.filter((label) => /(…|\.\.\.)\s*$/.test(label))).toEqual([]);

  // regression: WIS-402, a phone got a paragraph and three stacked controls
  // (~200px); it's a slim banner now, the question over one row of controls.
  await page.setViewportSize({ width: 390, height: 800 });
  expect((await prompt(page).boundingBox())!.height).toBeLessThan(120);

  await page.setViewportSize({ width: 320, height: 800 });
  await expect(prompt(page)).toBeVisible();
  expect(await sidewaysScroll(page)).toBe(0);
  expect(await crampedButtons(page)).toEqual([]);

  await prompt(page).getByRole('button', { name: 'Keep USD' }).click();
  await expect(prompt(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);

  // Answered, so a fresh session no longer offers it.
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Account menu/ })).toBeVisible();
  await expect(page.locator('.skeleton')).toHaveCount(0);
  await expect(prompt(page)).toHaveCount(0);
});
