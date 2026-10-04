import { test, expect } from './fixtures';

// The seeded owner list has no members, so one is added to the members GET in
// the browser (nothing reaches the database). Their row is the last one in the
// People panel, so its menu opens next to the panel's bottom edge.
const member = {
  _id: '0000000000000000000e2e89',
  user: { _id: '0000000000000000000e2e90', username: 'e2emember', image: null },
  role: 'member',
  createdAt: '2026-01-01T00:00:00.000Z',
};

// regression: the People list Panel was overflow-hidden (for its rounded
// corners), so the last row's menu, which opens downward in place, was cut off
// by the panel's bottom edge with room to spare in the viewport.
for (const size of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1280, height: 900 },
]) {
  test(`the last People row's menu is fully visible on a ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.route('**/api/wishlists/*/members', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const response = await route.fetch();
      const body = await response.json();
      if (!body.success) return route.fulfill({ response, json: body });
      await route.fulfill({ response, json: { ...body, data: [...body.data, member] } });
    });
    await page.goto('/wishlists/e2e-birthday?tab=people');
    await page.getByRole('button', { name: `Actions for @${member.user.username}` }).click();

    const items = page.getByRole('menuitem');
    await expect(items).toHaveCount(2);
    for (const item of await items.all()) {
      // A ratio of 1 means no part of it is clipped, by an ancestor or the screen.
      await expect(item).toBeInViewport({ ratio: 1 });
    }
  });
}
