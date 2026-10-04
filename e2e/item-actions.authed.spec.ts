import type { Locator } from '@playwright/test';
import { test, expect } from './fixtures';

// An item card's actions: one row of the same height (the primary action, the
// product link or its "no link" marker, the "More actions" menu), and a menu
// that works from the keyboard. Nothing here confirms a change, so nothing
// reaches the seeded database.

async function boxes(controls: Locator[]) {
  return Promise.all(controls.map(async (control) => (await control.boundingBox())!));
}

for (const width of [375, 1280]) {
  test(`the owner's card lays its actions out as one row at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/wishlists/e2e-birthday');
    const card = page.getByRole('article', { name: 'Item: E2E Gift' });
    const noLink = card.getByRole('button', { name: 'Add product link' });
    // On a phone the link (or its "+ link") is left to the menu (WIS-245).
    const row = [
      card.getByRole('button', { name: 'Edit item' }),
      ...(width < 640 ? [] : [noLink]),
      card.getByRole('button', { name: 'More actions' }),
    ];
    for (const control of row) await expect(control).toBeVisible();
    if (width < 640) await expect(noLink).toHaveCount(0);

    const [primary, ...squares] = await boxes(row);
    for (const box of squares) {
      expect(box.y).toBeCloseTo(primary.y, 0);
      expect(box.height).toBeCloseTo(primary.height, 0);
      // Square, beside the primary action rather than under it.
      expect(box.width).toBeCloseTo(box.height, 0);
      expect(box.x).toBeGreaterThan(primary.x + primary.width);
    }
    // The primary action takes the rest of the row.
    expect(primary.width).toBeGreaterThan(squares[0].width * 2);
  });
}

test("the owner's card menu works from the keyboard and gives focus back", async ({ page }) => {
  await page.goto('/wishlists/e2e-birthday');
  const card = page.getByRole('article', { name: 'Item: E2E Gift' });
  const more = card.getByRole('button', { name: 'More actions' });
  const menu = card.getByRole('menu');

  await more.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('menuitem', { name: 'Mark as received' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Move to draft' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();

  // Shift+Tab closes it and moves on from the trigger, back along the row.
  await page.keyboard.press('ArrowUp');
  await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(menu).toBeHidden();
  await expect(card.getByRole('button', { name: 'Add product link' })).toBeFocused();

  // A confirmation opened from the menu gives focus back to the menu's button.
  await more.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog', { name: 'Mark as received?' });
  await expect(dialog).toBeVisible();
  await expect(menu).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(more).toBeFocused();
});

test("the owner's card menu closes on a click outside it", async ({ page }) => {
  await page.goto('/wishlists/e2e-birthday');
  const card = page.getByRole('article', { name: 'Item: E2E Gift' });
  await card.getByRole('button', { name: 'More actions' }).click();
  const menu = card.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Mark as received',
    'Move to draft',
    'Mark as most wanted',
    'Save to my list',
    'Delete',
  ]);
  // Inside the viewport, above its button when there's no room below it.
  const box = (await menu.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);

  // The page's margin, well clear of the menu, whichever side of its button it opened on.
  await page.mouse.click(2, 400);
  await expect(menu).toBeHidden();
});

// WIS-258: the card's body opens the item's details, a bottom sheet on a phone.
for (const width of [390, 1280]) {
  test(`the card's body opens the item sheet, and Escape closes it, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/wishlists/e2e-birthday');
    const card = page.getByRole('article', { name: 'Item: E2E Gift' });
    const body = card.getByRole('button', { name: 'E2E Gift' });

    await body.click();
    const sheet = page.getByRole('dialog', { name: 'E2E Gift' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Edit item' })).toBeVisible();
    if (width < 640) {
      // Flush with the screen's bottom, once it has risen into place.
      await expect
        .poll(async () => {
          const box = (await sheet.boundingBox())!;
          return [Math.round(box.y + box.height), Math.round(box.width)];
        })
        .toEqual([900, width]);
    }

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(body).toBeFocused();
  });
}
