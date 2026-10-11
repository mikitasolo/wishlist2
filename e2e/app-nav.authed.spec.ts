import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { FRIEND_API_SESSION_TOKEN } from './magicLinks';

// The app's navigation (WIS-251, D3): Home, Reserved, Activity and Me, in a
// tab bar at the bottom of a phone's screen, and as header links from `sm` up.

const tabBar = (page: Page) => page.locator('nav[data-tab-bar]');
const tab = (page: Page, name: string) => tabBar(page).getByRole('link', { name, exact: true });
const accountButton = (page: Page) => page.getByRole('button', { name: /^Account menu/ });

test('a phone gets from Home to Reserved, Activity and Me through the tab bar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(tab(page, 'Home')).toHaveAttribute('aria-current', 'page');
  await expect(tabBar(page)).toBeInViewport({ ratio: 1 });
  // The header has no nav of its own on a phone, and no New list (it's on Home).
  await expect(page.getByRole('banner').getByRole('navigation')).toBeHidden();
  await expect(page.getByRole('banner').getByRole('button', { name: 'New list' })).toBeHidden();

  for (const [name, url, heading] of [
    ['Reserved', '/booked', 'Reserved by you'],
    ['Activity', '/notifications', 'Activity'],
    ['Me', '/users/e2euser', 'e2euser'],
    ['Home', '/', /Good (morning|afternoon|evening)/],
  ] as const) {
    await tab(page, name).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(tab(page, name)).toHaveAttribute('aria-current', 'page');
    await expect(tabBar(page).locator('[aria-current="page"]')).toHaveCount(1);
  }
});

/**
 * Makes Home long: twenty more lists of your own in the page's read of them,
 * so the page runs well past the screen. Nothing reaches the seeded database.
 */
async function manyLists(page: Page) {
  await page.route(/\/api\/wishlists$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (!body.success) return route.fulfill({ response, json: body });
    const [own] = body.data.owned;
    const more = Array.from({ length: 20 }, (_, i) => ({
      ...own,
      _id: `0000000000000000000e${String(i).padStart(4, '0')}`,
      name: `E2E Extra List ${i + 1}`,
      slug: `e2e-extra-${i + 1}`,
      featured: false,
      occasion: null,
    }));
    return route.fulfill({
      response,
      json: { ...body, data: { ...body.data, owned: [...body.data.owned, ...more] } },
    });
  });
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('not laid out');
  return b;
}

test("the end of a long page scrolls clear of the tab bar, and Home's sections end in See all", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await manyLists(page);
  await page.goto('/');
  const seeAll = page.getByRole('link', { name: 'See all (21)' });
  await expect(seeAll).toHaveAttribute('href', '/wishlists/mine');
  await expect(page.getByRole('link', { name: 'All items' })).toHaveAttribute('href', '/items');

  // Well past one screen (the dashboard's top no longer has its stat tiles, WIS-252).
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(
    844 * 1.5
  );
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

  // The page's last element (the last list, Shared with you's) ends above the bar.
  const last = page.locator('main a:visible').last();
  await expect(last).toBeInViewport({ ratio: 1 });
  const bar = await box(tabBar(page));
  expect((await box(last)).y + (await box(last)).height).toBeLessThanOrEqual(bar.y);
  expect(bar.y + bar.height).toBeCloseTo(844, 0);
});

test('from sm up the header links Home · Reserved · Activity, and there is no tab bar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/booked');
  const nav = page.getByRole('banner').getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText(['Home', 'Reserved', 'Activity']);
  await expect(nav.getByRole('link', { name: 'Reserved' })).toHaveAttribute('aria-current', 'page');
  await expect(tabBar(page)).toBeHidden();

  await nav.getByRole('link', { name: 'Activity' }).click();
  await expect(page).toHaveURL('/notifications');
  await expect(nav.getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'page');
});

// WIS-302: the header's bell duplicated Activity, so it's gone, and Activity
// carries the unread signal: a dot on the tab's icon, the count beside the header's link (WIS-415).
test('Activity badges what’s unread on the tab and the header link, and clears once visited', async ({
  page,
  playwright,
  baseURL,
}) => {
  const me = (await (await page.request.get('/api/auth/session')).json()).user.id;
  // The friend follows the E2E user: a real unread notification.
  const friend = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: `authjs.session-token=${FRIEND_API_SESSION_TOKEN}` },
  });
  try {
    expect((await friend.post(`/api/users/${me}/follow`)).ok()).toBe(true);
    const unreadName = /^Activity, \d+ unread$/;

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/booked');
    const header = page.getByRole('banner');
    const link = header.getByRole('navigation', { name: 'Main' }).getByRole('link', {
      name: unreadName,
    });
    await expect(link.locator('[data-badge]')).toHaveText(/^([1-9]|9\+)$/);
    await expect(header.getByRole('link', { name: /notification/i })).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    const activityTab = tabBar(page).getByRole('link', { name: unreadName });
    await expect(activityTab.locator('[data-dot]')).toBeInViewport({ ratio: 1 });
    await expect(activityTab.locator('[data-badge]')).toHaveCount(0);

    // Visiting Activity marks everything read, and the badge follows.
    await activityTab.click();
    await expect(page).toHaveURL('/notifications');
    await expect(tab(page, 'Activity')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-badge], [data-dot]')).toHaveCount(0);
  } finally {
    await friend.delete(`/api/users/${me}/follow`);
    await friend.dispose();
  }
});

/**
 * Holds `GET /api/auth/session` until `release` is called, so the page stays
 * in the state it's in before the session arrives for as long as the spec needs.
 */
async function holdSession(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/api\/auth\/session/, async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

// regression (WIS-209): while the session loaded the header had only the
// search and a 40px circle, and the bell, New list and the wider account
// button appeared when it landed, so the search jumped ~100px left on a phone
// and up to ~290px on a wide screen, on every page load.
for (const width of [360, 1280]) {
  test(`regression: the header doesn't move when the session arrives, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    // A first visit, so the browser knows it's signed in (the session hint).
    await page.goto('/booked');
    await expect(accountButton(page)).toBeVisible();

    const release = await holdSession(page);
    await page.reload();
    const search = page.getByRole('button', { name: 'Search', exact: true });
    await expect(search).toBeVisible();
    await expect(accountButton(page)).toHaveCount(0);
    const header = page.getByRole('banner');
    const before = {
      search: await box(search),
      header: await box(header),
      // The account button's place (its avatar), the row's last thing.
      last: await box(header.locator('.skeleton:visible').last()),
    };

    release();
    await expect(accountButton(page)).toBeVisible();
    const after = {
      search: await box(search),
      header: await box(header),
      last: await box(accountButton(page).locator('> *').first()),
    };
    expect(Math.abs(after.search.x - before.search.x), 'search moved sideways').toBeLessThanOrEqual(
      1
    );
    expect(after.search.y).toBeCloseTo(before.search.y, 0);
    expect(after.header.height).toBeCloseTo(before.header.height, 0);
    expect(Math.abs(after.last.x - before.last.x), 'avatar moved sideways').toBeLessThanOrEqual(1);
    if (width < 640) {
      // The tab bar's place was held too.
      await expect(tabBar(page)).toBeInViewport({ ratio: 1 });
    }
  });
}
