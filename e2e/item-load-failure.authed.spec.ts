import { test, expect, type Page, type Request, type Response, type Route } from '@playwright/test';

// Every failing items read here is answered in the browser, so nothing reaches
// the seeded database.
const ITEMS = '**/api/wishlists/*/items';

// Fire a background poll now rather than waiting out the 5 s tick: the page
// also re-reads its items whenever it becomes visible, which it already is.
async function pollOnce(page: Page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

const isItemsRead = (request: Request) =>
  request.method() === 'GET' && request.url().endsWith('/items');

// The page's timer keeps ticking here, and concurrent item reads share one
// request, so the poll a spec fires can join a tick's read that was sent before
// the route started failing them. Each failure therefore waits for a read that
// actually failed (the next tick's, at worst), not just for the next read.
const failures = [
  {
    kind: 'a network error',
    fail: (route: Route) => route.abort('internetdisconnected'),
    failed: (page: Page) => page.waitForEvent('requestfailed', isItemsRead),
  },
  {
    kind: 'a 500',
    fail: (route: Route) =>
      route.fulfill({ status: 500, json: { success: false, error: 'Something went wrong' } }),
    failed: (page: Page) =>
      page.waitForResponse(
        (response: Response) => isItemsRead(response.request()) && response.status() === 500
      ),
  },
];

// regression: useFetchItems caught every failure and resolved [], and the page
// applied it, so one failed poll (briefly offline, a failing GET) emptied the
// list and showed "No items found" until a later poll landed.
for (const failure of failures) {
  test(`regression: a poll that fails with ${failure.kind} keeps the list`, async ({ page }) => {
    const card = page.getByRole('article', { name: 'Item: E2E Gift' });
    await page.goto('/wishlists/e2e-birthday');
    await expect(card).toBeVisible();

    await page.route(ITEMS, (route) =>
      route.request().method() === 'GET' ? failure.fail(route) : route.continue()
    );
    const failed = failure.failed(page);
    await pollOnce(page);
    await failed;
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)));

    // Every read fails from here on, so no later poll can put the list back:
    // these counts are the settled state.
    expect(await card.count()).toBe(1);
    expect(await page.getByRole('heading', { name: 'No items found' }).count()).toBe(0);
  });
}

// regression: with the hook resolving [] on failure, the page's "Failed to load
// items" toast was unreachable and a failed first load showed the empty state.
test('regression: a failed first load says so, not that the list is empty', async ({ page }) => {
  let failing = true;
  await page.route(ITEMS, (route) =>
    failing && route.request().method() === 'GET'
      ? route.fulfill({ status: 500, json: { success: false, error: 'Something went wrong' } })
      : route.continue()
  );
  await page.goto('/wishlists/e2e-birthday');

  await expect(page.getByRole('status').getByText('Failed to load items')).toBeVisible();
  const loadError = page.getByRole('heading', { name: 'Failed to load items' });
  await expect(loadError).toBeVisible();
  // Exclusive with the error panel, so checking it while that shows is enough.
  await expect(page.getByRole('heading', { name: 'No items found' })).toHaveCount(0);

  // The poll keeps retrying, and the first read that lands fills the list in.
  failing = false;
  await pollOnce(page);
  await expect(page.getByRole('article', { name: 'Item: E2E Gift' })).toBeVisible();
  await expect(loadError).toHaveCount(0);
});
