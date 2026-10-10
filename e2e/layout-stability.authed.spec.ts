import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';

// On USD's own time zone the dashboard offers no other currency, so the
// currency prompt can't appear between the skeleton and the lists.
test.use({ timezoneId: 'America/New_York' });

type Box = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  if (!b) throw new Error('not laid out');
  return b;
}

/** Equal to the pixel, whatever the subpixel layout. */
function expectSameBox(actual: Box, expected: Box, keys: (keyof Box)[], what: string) {
  for (const key of keys) {
    expect(Math.abs(actual[key] - expected[key]), `${what}: ${key}`).toBeLessThanOrEqual(1);
  }
}

/**
 * Holds `GET /api/wishlists` until `release` is called, so the page shows its
 * skeleton for as long as the spec needs.
 */
async function holdWishlists(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/api\/wishlists$/, async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

/**
 * The page's sections of lists as shown at this width: compact rows on a phone,
 * card grids from `sm` up (WIS-254), each one in its skeleton too.
 */
const listSections = (page: Page, width: number) =>
  page.locator(width < 640 ? 'main [data-wishlist-rows]' : 'main [data-wishlist-cards]');

// regression: the loading grid was `gap-4 sm:gap-6` where the cards' is
// `gap-5`, and the dashboard's skeleton had no Featured row and tiles of its
// own heights, so the page jumped when the lists landed (DS-13). The
// dashboard's skeleton is now its greeting row and a section of lists (WIS-252).
for (const width of [390, 1280]) {
  for (const { name, url } of [
    { name: 'Mine', url: '/wishlists/mine' },
    { name: 'Shared', url: '/wishlists/shared' },
    { name: 'the dashboard', url: '/' },
  ]) {
    test(`${name} doesn't move when its skeleton is replaced, at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const release = await holdWishlists(page);
      await page.goto(url);
      // Signed in, and the lists still on their way.
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      // (The first visible one: a phone's skeleton rows are in the page at 1280, hidden.)
      await expect(page.locator('main .skeleton:visible').first()).toBeVisible();

      const grid = listSections(page, width).first();
      const before = {
        grid: await box(grid),
        card: await box(grid.locator('> *').first()),
      };

      release();
      await expect(grid.locator('a').first()).toBeVisible();
      await expect(page.locator('main .skeleton')).toHaveCount(0);

      // Where the cards start, and how wide each one is. A card's height
      // depends on its description, so it isn't held to its skeleton's; a
      // phone's row is as tall as its skeleton while its meta line fits on one
      // line, as the seeded lists' do.
      expectSameBox(await box(grid), before.grid, ['x', 'y', 'width'], 'grid');
      expectSameBox(
        await box(grid.locator('> *').first()),
        before.card,
        width < 640 ? ['x', 'y', 'width', 'height'] : ['x', 'y', 'width'],
        'first card'
      );
    });
  }
}

/**
 * At least 32×32px, the smallest a clear or close button may be. Polled: a
 * toast scales in, so its button starts out smaller.
 */
async function expectHitArea(locator: Locator) {
  await expect
    .poll(async () => {
      const { width, height } = await box(locator);
      return Math.min(width, height);
    })
    .toBeGreaterThanOrEqual(32);
}

// regression: the search's clear button was 24px, a toast's close about 20px
// and the header search's close 28px (DS-17).
test('the clear and close buttons are at least 32px square', async ({ page }) => {
  await page.goto('/wishlists/e2e-birthday');

  // The list's item search, with something typed.
  await page.getByRole('textbox', { name: 'Search items' }).fill('zz');
  await expectHitArea(page.getByRole('button', { name: 'Clear search' }));

  // The header's search, opened.
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expectHitArea(page.getByRole('button', { name: 'Close search' }));
  await page.getByRole('button', { name: 'Close search' }).click();

  // A toast: copying the list's link says so, and writes nothing.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page
    .getByRole('group', { name: 'List actions' })
    .getByRole('button', { name: 'Share' })
    .click();
  await page.getByRole('menuitem', { name: 'Copy link' }).click();
  const toast = page.getByRole('status').filter({ hasText: 'Link copied to clipboard' });
  await expect(toast).toBeVisible();
  await expectHitArea(toast.getByRole('button', { name: 'Dismiss notification' }));
});
