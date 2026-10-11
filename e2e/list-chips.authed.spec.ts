import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// A list's status chips (D7), from the member's side: the list opens on All,
// a chip narrows it, and All brings everything back. The member's list
// (e2e-friend) has no items, and other specs rely on that, so its items read
// is answered in the browser with a list as the items API gives it to a member.

async function signedInUserId(page: Page): Promise<string> {
  const session = await (await page.request.get('/api/auth/session')).json();
  return session.user.id;
}

function listed(name: string, day: number, fields: Record<string, unknown> = {}) {
  const at = `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`;
  return {
    _id: `e2e-chip-${day}`,
    wishlist: 'e2e-friend',
    name,
    status: 'available',
    price: null,
    priceInUsdCents: null,
    createdAt: at,
    updatedAt: at,
    ...fields,
  };
}

test('a member filters a list to Available and back to All', async ({ page }) => {
  const me = await signedInUserId(page);
  const items = [
    listed('E2E Lamp', 1),
    listed('E2E Scarf', 2, { status: 'booked', bookedBy: me }),
    listed('E2E Kettle', 3, { status: 'booked' }),
    listed('E2E Vase', 4, { status: 'completed' }),
  ];
  await page.route('**/api/wishlists/e2e-friend/items', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { success: true, data: items } })
      : route.fallback()
  );
  await page.goto('/wishlists/e2e-friend');

  const chips = page.getByRole('radiogroup', { name: 'Show items' });
  const cards = page.getByRole('article');
  const all = chips.getByRole('radio', { name: 'All 4' });
  const available = chips.getByRole('radio', { name: 'Available 1' });

  // Every item at first, the actionable ones before what's taken or received.
  await expect(all).toBeChecked();
  await expect(cards).toHaveCount(4);
  await expect(cards.first()).toHaveAccessibleName('Item: E2E Lamp');
  await expect(chips.getByRole('radio', { name: 'Reserved by you 1' })).toBeVisible();

  // regression: WIS-396 made the chips + toolbar row sticky under the header, and the
  // cards scrolled visibly through the stuck row (WIS-420). It scrolls with the page.
  const stuck = await chips.evaluate((el) => {
    for (let n: Element | null = el; n; n = n.parentElement) {
      if (getComputedStyle(n).position === 'sticky') return true;
    }
    return false;
  });
  expect(stuck).toBe(false);

  await available.click();
  await expect(available).toBeChecked();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAccessibleName('Item: E2E Lamp');
  await expect(page).toHaveURL(/\?show=available$/);

  // A refresh comes back to the chip.
  await page.reload();
  await expect(available).toBeChecked();
  await expect(cards).toHaveCount(1);

  await all.click();
  await expect(all).toBeChecked();
  await expect(cards).toHaveCount(4);
  await expect(page).toHaveURL(/\/wishlists\/e2e-friend$/);
});

// Tag chips (WIS-385): any picked tag matches, and the status chips' counts stay.
test('a member filters a list by tags', async ({ page }) => {
  const items = [
    listed('E2E Novel', 1, { tags: ['Books'] }),
    listed('E2E Pan', 2, { tags: ['Kitchen'] }),
    listed('E2E Lamp', 3),
  ];
  await page.route('**/api/wishlists/e2e-friend/items', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { success: true, data: items } })
      : route.fallback()
  );
  await page.goto('/wishlists/e2e-friend');

  const tags = page.getByRole('group', { name: 'Filter by tag' });
  const cards = page.getByRole('article');
  await expect(cards).toHaveCount(3);

  // The cards name their tags (WIS-452), display only: no chip on the untagged one.
  const novel = page.getByRole('article', { name: 'Item: E2E Novel' });
  await expect(novel.getByRole('list', { name: 'Tags' }).getByText('Books')).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'Item: E2E Lamp' }).getByRole('list', { name: 'Tags' })
  ).toHaveCount(0);

  await tags.getByRole('button', { name: 'Books' }).click();
  await expect(tags.getByRole('button', { name: 'Books' })).toHaveAttribute('aria-pressed', 'true');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAccessibleName('Item: E2E Novel');

  await tags.getByRole('button', { name: 'Kitchen' }).click();
  await expect(cards).toHaveCount(2);
  // The status chips' counts never move with a tag.
  await expect(
    page.getByRole('radiogroup', { name: 'Show items' }).getByRole('radio', { name: 'All 3' })
  ).toBeChecked();
});
