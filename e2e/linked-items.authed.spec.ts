import { test, expect } from './fixtures';

// Linked items (WIS-29): a card's "Goes with" chip scrolls to its partner and
// highlights it. The items read is answered in the browser with two linked
// items, so nothing is written to the seeded database.

const DRILL = 'a1a1a1a1a1a1a1a1a1a1a1a1';
const BITS = 'b2b2b2b2b2b2b2b2b2b2b2b2';
const item = (id: string, name: string, partner: { id: string; name: string }) => ({
  _id: id,
  wishlist: 'e2e',
  name,
  status: 'available',
  priceInUsdCents: null,
  relatedItems: [partner],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

test('a "Goes with" chip goes to its item and highlights it', async ({ page }) => {
  await page.route('**/api/wishlists/*/items', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: {
            success: true,
            data: [
              item(DRILL, 'E2E Drill', { id: BITS, name: 'E2E Bits' }),
              item(BITS, 'E2E Bits', { id: DRILL, name: 'E2E Drill' }),
            ],
          },
        })
      : route.continue()
  );
  await page.goto('/wishlists/e2e-birthday');

  const drill = page.getByRole('article', { name: 'Item: E2E Drill' });
  const bits = page.getByRole('article', { name: 'Item: E2E Bits' });
  await expect(drill.getByText('Goes with')).toBeVisible();
  await drill.getByRole('button', { name: 'Go to E2E Bits' }).click();

  await expect(bits).toHaveAttribute('data-highlighted', 'true');
  await expect(bits).toBeInViewport();
});
