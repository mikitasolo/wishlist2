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
