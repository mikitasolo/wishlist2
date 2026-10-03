import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// The dashboard on a phone (WIS-254): each section's lists are compact rows,
// not 16:9 cards, and archived lists fold into one "Archived (n)" row. The
// seeded user has no archived list, so one is added to the page's read of its
// lists in the browser: nothing reaches the seeded database.

async function addArchivedList(page: Page) {
  await page.route(/\/api\/wishlists$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (!body.success) return route.fulfill({ response, json: body });
    const [own] = body.data.owned;
    const archived = {
      ...own,
      _id: '0000000000000000000e2254',
      name: 'E2E Old List',
      slug: 'e2e-old-list',
      archived: true,
      featured: false,
      occasion: null,
    };
    return route.fulfill({
      response,
      json: { ...body, data: { ...body.data, owned: [...body.data.owned, archived] } },
    });
  });
}

test('Home shows lists as rows at 390px, with the archived ones folded away', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await addArchivedList(page);
  await page.goto('/');

  const section = (name: string) =>
    page.locator('section').filter({ has: page.getByRole('heading', { level: 2, name }) });
  const own = section('Your wishlists');
  const shared = section('Shared with you');

  // One row per list, each one link: the cover square, the name, the meta line.
  const birthday = own.getByRole('link', { name: /E2E Birthday List/ });
  await expect(birthday).toBeVisible();
  await expect(birthday).toHaveAttribute('href', '/wishlists/e2e-birthday');
  await expect(birthday).toContainText('1 item');
  const friend = shared.getByRole('link', { name: /E2E Friend List/ });
  await expect(friend).toContainText('@e2efriend · 0 items');

  // About 72px tall, and as wide as the page between its 16px gutters.
  const row = (await birthday.boundingBox())!;
  expect(row.height).toBeGreaterThanOrEqual(70);
  expect(row.height).toBeLessThanOrEqual(74);
  const thumb = (await birthday.locator('> *').first().boundingBox())!;
  expect(thumb.width).toBeCloseTo(56, 0);
  expect(thumb.height).toBeCloseTo(56, 0);

  // No cards: none in the DOM, and no card's heading.
  await expect(page.locator('main [data-wishlist-cards]')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(0);

  // The archived list is behind one closed row at the end of the page.
  const archived = page.getByRole('button', { name: 'Archived (1)' });
  await expect(archived).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('link', { name: /E2E Old List/ })).toHaveCount(0);

  await archived.click();
  await expect(archived).toHaveAttribute('aria-expanded', 'true');
  const old = page.getByRole('link', { name: /E2E Old List/ });
  await expect(old).toBeVisible();
  await expect(old).toHaveAttribute('href', '/wishlists/e2e-old-list');
  // It's below the other sections.
  expect((await old.boundingBox())!.y).toBeGreaterThan((await friend.boundingBox())!.y);

  await archived.click();
  await expect(archived).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('link', { name: /E2E Old List/ })).toHaveCount(0);
});

test('Home keeps its cards from sm up', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const own = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Your wishlists' }) });
  await expect(own.getByRole('heading', { level: 3, name: 'E2E Birthday List' })).toBeVisible();
  await expect(page.locator('main [data-wishlist-rows]')).toHaveCount(0);
});
