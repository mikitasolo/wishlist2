import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// The item grid on a phone (WIS-245): two cards a row, each with one row of
// [primary] [⋯], the product link folded into the menu. The seeded list has a
// single item with no link, so a linked one is added to its item list in the
// browser: nothing reaches the seeded database.

const LINK = 'https://shop.example/e2e-linked-gift';

async function addLinkedItem(page: Page) {
  await page.route('**/api/wishlists/*/items', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (!body.success) return route.fulfill({ response, json: body });
    const linked = {
      _id: '0000000000000000000e2e45',
      wishlist: body.data[0]?.wishlist ?? '',
      name: 'E2E Linked Gift',
      link: LINK,
      status: 'available',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    return route.fulfill({ response, json: { ...body, data: [...body.data, linked] } });
  });
}

test('two cards sit side by side at 390px, the link in each card’s menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await addLinkedItem(page);
  await page.goto('/wishlists/e2e-birthday');
  const gift = page.getByRole('article', { name: 'Item: E2E Gift' });
  const linked = page.getByRole('article', { name: 'Item: E2E Linked Gift' });
  await expect(gift).toBeVisible();
  await expect(linked).toBeVisible();

  const [a, b] = await Promise.all([gift.boundingBox(), linked.boundingBox()]);
  const [left, right] = a!.x < b!.x ? [a!, b!] : [b!, a!];
  // One row: the same top, the second to the right of the first, each about
  // half the width between the page's 16px gutters.
  expect(right.y).toBeCloseTo(left.y, 0);
  expect(right.x).toBeGreaterThan(left.x + left.width);
  for (const box of [left, right]) {
    expect(box.width).toBeGreaterThan(160);
    expect(box.width).toBeLessThan(180);
  }

  // [Edit] [⋯]: no link square, no "no link" marker.
  for (const card of [gift, linked]) {
    const edit = card.getByRole('button', { name: 'Edit item' });
    const more = card.getByRole('button', { name: 'More actions' });
    await expect(edit).toBeVisible();
    await expect(more).toBeVisible();
    await expect(card.getByRole('img', { name: 'No link provided' })).toHaveCount(0);
    const [editBox, moreBox] = await Promise.all([edit.boundingBox(), more.boundingBox()]);
    expect(moreBox!.y).toBeCloseTo(editBox!.y, 0);
    expect(moreBox!.x).toBeGreaterThan(editBox!.x + editBox!.width);
  }
  // The cover is the card's one link to the product page.
  await expect(linked.getByRole('link', { name: 'View E2E Linked Gift product page' })).toHaveCount(
    1
  );

  // ⋯ → Open product page, first in the menu, from the keyboard too.
  const more = linked.getByRole('button', { name: 'More actions' });
  await more.focus();
  await page.keyboard.press('Enter');
  const menu = linked.getByRole('menu');
  const open = menu.getByRole('menuitem', { name: 'Open product page' });
  await expect(open).toBeFocused();
  await expect(open).toHaveAttribute('href', LINK);
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Open product page',
    'Mark as received',
    'Move to draft',
    'Save to my list',
  ]);
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();

  // An item without a link has nothing to fold.
  await gift.getByRole('button', { name: 'More actions' }).click();
  await expect(gift.getByRole('menuitem')).toHaveText([
    'Mark as received',
    'Move to draft',
    'Save to my list',
  ]);
});

test('from sm up, the link is a square beside the primary again, not in the menu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await addLinkedItem(page);
  await page.goto('/wishlists/e2e-birthday');
  const linked = page.getByRole('article', { name: 'Item: E2E Linked Gift' });
  const square = linked.locator('a[title="View product page"]');
  await expect(square).toBeVisible();
  await expect(square).toHaveAttribute('href', LINK);

  await linked.getByRole('button', { name: 'More actions' }).click();
  await expect(linked.getByRole('menuitem')).toHaveText([
    'Mark as received',
    'Move to draft',
    'Save to my list',
  ]);

  // Down to a phone's width and back, without a reload.
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(square).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(square).toBeVisible();
});
