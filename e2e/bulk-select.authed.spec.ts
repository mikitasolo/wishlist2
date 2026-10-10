import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// WIS-386: an owner's Select mode. Every bulk request is answered in the
// browser and the list read is patched to match, so nothing reaches the
// seeded database and the other specs keep their items.

const DRAFT_ID = '0000000000000000000e2e86';
/** A list of the owner's that only the browser sees, for Move to list (WIS-434). */
const TARGET_ID = '0000000000000000000e2434';

interface Fake {
  /** The draft added to the owner's list, until it's published. */
  draftStatus: 'draft' | 'available';
  /** Seeded items the browser has "deleted". */
  deleted: Set<string>;
  bulk: Array<{ action: string; itemIds: string[]; targetWishlistId?: string }>;
}

async function fakeList(page: Page): Promise<Fake> {
  const fake: Fake = { draftStatus: 'draft', deleted: new Set(), bulk: [] };
  await page.route('**/api/wishlists/*/items', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (!body.success) return route.fulfill({ response, json: body });
    const draft = {
      _id: DRAFT_ID,
      wishlist: body.data[0]?.wishlist ?? '',
      name: 'E2E Draft',
      status: fake.draftStatus,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const data = [draft, ...body.data].filter(
      (item: { _id: string }) => !fake.deleted.has(item._id)
    );
    return route.fulfill({ response, json: { ...body, data } });
  });
  // The owner's lists, plus one more to move items to.
  await page.route('**/api/wishlists', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (!body.success) return route.fulfill({ response, json: body });
    const extra = { _id: TARGET_ID, name: 'E2E Elsewhere', itemCount: 0, archived: false };
    return route.fulfill({
      response,
      json: { ...body, data: { ...body.data, owned: [...body.data.owned, extra] } },
    });
  });
  await page.route('**/api/wishlists/*/items/bulk', async (route) => {
    const body = route.request().postDataJSON() as Fake['bulk'][number];
    fake.bulk.push(body);
    if (body.action === 'publish') fake.draftStatus = 'available';
    if (body.action === 'delete' || body.action === 'move') {
      for (const id of body.itemIds) fake.deleted.add(id);
    }
    const items =
      body.action === 'publish'
        ? [
            {
              _id: DRAFT_ID,
              name: 'E2E Draft',
              status: 'available',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ]
        : [];
    return route.fulfill({
      json: {
        success: true,
        data: { done: body.itemIds, skipped: [], gone: [], failed: [], items },
      },
    });
  });
  return fake;
}

const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const bar = (page: Page) => page.getByRole('region', { name: 'Selected items' });

test('select a draft and publish it, in one request', async ({ page }) => {
  const fake = await fakeList(page);
  await page.goto('/wishlists/e2e-birthday');
  const draft = page.getByRole('article', { name: 'Item: E2E Draft' });
  await expect(draft).toHaveAttribute('data-status', 'draft');

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select E2E Draft' }).click();
  await expect(bar(page).getByText('1 selected')).toBeVisible();
  await bar(page).getByRole('button', { name: 'Publish' }).click();

  await expect(toast(page, '1 item published')).toBeVisible();
  await expect(draft).toHaveAttribute('data-status', 'available');
  expect(fake.bulk).toEqual([{ action: 'publish', itemIds: [DRAFT_ID] }]);
});

test('a bulk delete offers Undo, and sends one request only once it has passed', async ({
  page,
}) => {
  const fake = await fakeList(page);
  await page.goto('/wishlists/e2e-birthday');
  const gift = page.getByRole('article', { name: 'Item: E2E Gift' });
  const draft = page.getByRole('article', { name: 'Item: E2E Draft' });
  await expect(gift).toBeVisible();

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select E2E Gift' }).click();
  await page.getByRole('checkbox', { name: 'Select E2E Draft' }).click();
  await bar(page).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(gift).toBeHidden();
  await expect(draft).toBeHidden();

  await toast(page, '2 items deleted').getByRole('button', { name: 'Undo' }).click();
  await expect(gift).toBeVisible();
  await expect(draft).toBeVisible();
  // Past the Undo window: still nothing sent.
  await page.waitForTimeout(5500);
  expect(fake.bulk).toHaveLength(0);

  await page.getByRole('checkbox', { name: 'Select E2E Draft' }).click();
  await bar(page).getByRole('button', { name: 'Delete' }).click();
  await expect(draft).toBeHidden();
  // Dismissing the toast sends it at once.
  await toast(page, '1 item deleted').getByRole('button', { name: 'Dismiss notification' }).click();
  await expect.poll(() => fake.bulk).toEqual([{ action: 'delete', itemIds: [DRAFT_ID] }]);
  await expect(draft).toBeHidden();
  await expect(gift).toBeVisible();
});

test('move to another list: always the same warning, then Undo, then one request', async ({
  page,
}) => {
  const fake = await fakeList(page);
  await page.goto('/wishlists/e2e-birthday');
  const draft = page.getByRole('article', { name: 'Item: E2E Draft' });
  await expect(draft).toBeVisible();

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select E2E Draft' }).click();
  await bar(page).getByRole('button', { name: 'Move to list' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move 1 item to another list' });
  await expect(dialog.getByText(/keep it on their Reserved page/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Move', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: /E2E Elsewhere/ }).click();
  await dialog.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(draft).toBeHidden();

  await toast(page, '1 item moved to E2E Elsewhere')
    .getByRole('button', { name: 'Dismiss notification' })
    .click();
  await expect
    .poll(() => fake.bulk)
    .toEqual([{ action: 'move', itemIds: [DRAFT_ID], targetWishlistId: TARGET_ID }]);
  await expect(draft).toBeHidden();
});
