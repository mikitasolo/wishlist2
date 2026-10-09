import { test, expect } from './fixtures';
import { FRIEND_API_SESSION_TOKEN } from './magicLinks';

// WIS-362: a member starts a group gift on an item of the friend's list, and
// the owner still sees it as plain available. e2e-friend has no items (other
// specs rely on that), so the owner (the friend) adds one through the API and
// takes it away again.

test('a member starts a group gift and the owner still sees the item as available', async ({
  page,
  playwright,
  baseURL,
}) => {
  const owner = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: `authjs.session-token=${FRIEND_API_SESSION_TOKEN}` },
  });
  let itemId: string | null = null;
  try {
    const created = await owner.post('/api/wishlists/e2e-friend/items', {
      data: {
        name: 'E2E Group Gift Bike',
        status: 'available',
        price: { value: 30000, currency: 'USD' },
      },
    });
    expect(created.ok()).toBe(true);
    itemId = (await created.json()).data._id as string;

    await page.goto('/wishlists/e2e-friend');
    const card = page.getByRole('article', { name: 'Item: E2E Group Gift Bike' });
    await card.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Start a group gift' }).click();

    const dialog = page.getByRole('dialog', { name: 'Start a group gift' });
    await expect(dialog.getByLabel('Target')).toHaveValue('300.00');
    await dialog.getByLabel('Your pledge').fill('75');
    await dialog.getByRole('button', { name: 'Start group gift' }).click();

    await expect(card.getByText('Group gift · 25% funded')).toBeVisible();
    await expect(card.getByText('$75.00 of $300.00 pledged')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Change your pledge' })).toBeVisible();

    // The owner's answer says nothing of it: the item is just available.
    const read = await owner.get('/api/wishlists/e2e-friend/items');
    const seen = (await read.json()).data.find((i: { _id: string }) => i._id === itemId);
    expect(seen.status).toBe('available');
    expect(JSON.stringify(seen)).not.toMatch(/groupGift|bookedBy|pledge/i);

    // Cancelling gives it back.
    await card.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Cancel group gift' }).click();
    await page.getByRole('button', { name: 'Cancel group gift' }).last().click();
    await expect(card.getByRole('button', { name: 'Reserve this item' })).toBeVisible();
    // Wait for the server's answer (the cancel is shown at once) before the item goes.
    await expect(
      page.getByText('Group gift cancelled. The item is available again.')
    ).toBeVisible();
  } finally {
    if (itemId) await owner.delete(`/api/items/${itemId}`);
    await owner.dispose();
  }
});
