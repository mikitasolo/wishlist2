import { test, expect } from './fixtures';

// Reserved's View on list (WIS-263) opens the list at `?item=`, which scrolls
// to that item and highlights it. The member's list (e2e-friend) has no items,
// and other specs rely on that, so the gifter's reservations and the list's
// items are answered in the browser, as the APIs give them to a member.

test('View on list lands on the reserved item, highlighted', async ({ page }) => {
  const session = await (await page.request.get('/api/auth/session')).json();
  const me = session.user.id as string;

  const at = '2026-01-01T00:00:00.000Z';
  const item = (n: number, name: string, fields: Record<string, unknown> = {}) => ({
    _id: `e2e-deep-${n}`,
    wishlist: 'e2e-friend',
    name,
    status: 'available',
    price: null,
    priceInUsdCents: null,
    createdAt: at,
    updatedAt: at,
    ...fields,
  });
  const items = [
    ...Array.from({ length: 11 }, (_, i) => item(i, `E2E Filler ${i}`)),
    item(11, 'E2E Telescope', { status: 'booked', bookedBy: me }),
  ];
  await page.route('**/api/wishlists/e2e-friend/items', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { success: true, data: items } })
      : route.fallback()
  );
  await page.route('**/api/users/me/reservations', (route) =>
    route.fulfill({
      json: {
        success: true,
        data: [
          {
            _id: 'e2e-res-telescope',
            itemId: 'e2e-deep-11',
            itemName: 'E2E Telescope',
            itemImage: null,
            itemPrice: null,
            wishlistName: 'E2E Friend List',
            wishlistId: 'e2e-friend',
            wishlistSlug: 'e2e-friend',
            wishlistOccasion: null,
            wishlistOwnerUsername: 'e2efriend',
            itemLink: null,
            itemNotes: null,
            itemStatus: 'booked',
            stillReserved: true,
            listOpen: true,
            listArchived: false,
          },
        ],
      },
    })
  );

  await page.goto('/booked');
  const card = page.getByRole('article', { name: 'E2E Telescope' });
  await card.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'View on list' }).click();

  await expect(page).toHaveURL(/\/wishlists\/e2e-friend\?item=e2e-deep-11$/);
  const target = page.getByRole('article', { name: 'Item: E2E Telescope' });
  await expect(target).toHaveAttribute('data-highlighted', 'true');
  await expect(target).toBeInViewport();
});
