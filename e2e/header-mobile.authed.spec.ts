import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

const accountButton = (page: Page) => page.getByRole('button', { name: /^Account menu/ });
const homeLink = (page: Page) => page.getByRole('link', { name: 'Wishlist home' });

/** How far the page scrolls sideways: 0 when it fits the screen. */
const sidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Opens `path` once it's loaded: the session is in and no skeleton is left. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(accountButton(page)).toBeVisible();
  await expect(page.locator('.skeleton')).toHaveCount(0);
}

// regression: below `sm` the signed-in header still showed the "Wishlist"
// wordmark and the account button's name and chevron, next to three round
// buttons, and nothing in the row could shrink. It came out ~400px wide, so on
// a phone every signed-in page scrolled sideways (79px at 320px, 39px at 360px)
// and the account button was cut off at the right edge.
for (const width of [320, 360]) {
  test(`regression: signed-in pages fit a ${width}px-wide phone, account menu included`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const path of ['/', '/wishlists/e2e-birthday', '/booked']) {
      await open(page, path);
      expect(await sidewaysScroll(page), `${path} scrolls sideways`).toBe(0);
      await expect(homeLink(page), path).toBeInViewport({ ratio: 1 });
      await expect(accountButton(page), path).toBeInViewport({ ratio: 1 });

      await accountButton(page).click();
      await expect(page.getByRole('menu', { name: 'Account' }), path).toBeInViewport({ ratio: 1 });
    }
  });
}

// regression: from `sm` up the open search field sits in the header row, and
// the account button couldn't shrink to make room for it, so at 640px it was
// pushed past the right edge and the page scrolled sideways. The header's
// Home · Reserved · Activity links (WIS-251) step aside for it below `lg`, and
// from there there's room for both. (The header had New list too, until
// WIS-302 left it to Home and My wishlists.)
for (const width of [640, 768, 1024]) {
  test(`regression: at ${width}px the open search leaves the account button on screen`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await open(page, '/booked');
    // Closed, the search leaves room for the links too, at the narrowest.
    const links = page.getByRole('banner').getByRole('navigation', { name: 'Main' });
    expect(await sidewaysScroll(page)).toBe(0);
    await expect(links.getByRole('link', { name: 'Activity' })).toBeInViewport({ ratio: 1 });
    await expect(accountButton(page)).toBeInViewport({ ratio: 1 });
    const activity = (await links.getByRole('link', { name: 'Activity' }).boundingBox())!;
    const search = (await page.getByRole('button', { name: 'Search', exact: true }).boundingBox())!;
    expect(activity.x + activity.width).toBeLessThanOrEqual(search.x);

    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Search people and wishlists' })).toBeVisible();

    expect(await sidewaysScroll(page)).toBe(0);
    await expect(accountButton(page)).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('banner').getByRole('button', { name: 'New list' })).toHaveCount(0);
  });
}

// The account button is the avatar alone at every width (WIS-251: Me is the
// avatar), so it's one width whoever is signed in and its loading placeholder
// can hold that width.
test('a wide screen still shows the wordmark, and the account button is its avatar', async ({
  page,
}) => {
  await open(page, '/booked');
  await expect(homeLink(page).getByText('Wishlist', { exact: true })).toBeVisible();
  await expect(accountButton(page)).not.toContainText('e2euser');
});
