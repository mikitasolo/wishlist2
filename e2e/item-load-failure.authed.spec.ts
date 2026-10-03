import type { Page, Request, Response, Route } from '@playwright/test';
import { test, expect, failedRequest } from './fixtures';

// Every failing items read here is answered in the browser, so nothing reaches
// the seeded database.
const ITEMS = '**/api/wishlists/*/items';

// Every test here fails item reads on purpose: the browser logs each one, and
// the page logs its own line for it.
test.beforeEach(({ consoleErrors }) => {
  consoleErrors.allow(
    failedRequest(/\/api\/wishlists\/e2e-birthday\/items/),
    /^Error fetching items: /
  );
});

// Fire a background poll now rather than waiting out the 5 s tick: the page
// also re-reads its items whenever it becomes visible, which it already is.
async function pollOnce(page: Page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

// Any of the page's answers for a list with no items to show: that the list is
// empty, or that the filters hide every item.
const emptyList = (page: Page) =>
  page.getByRole('heading', { name: /^(Your list is empty|No items found)$/ });

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
    expect(await emptyList(page).count()).toBe(0);
  });
}

// regression: with the hook resolving [] on failure, a failed first load showed
// the empty state; then it showed stat cards (now chips) reading 0 above an error with no
// way to retry but a reload, and a toast.
test('regression: a failed first load says so, not that the list is empty', async ({ page }) => {
  let failing = true;
  await page.route(ITEMS, (route) =>
    failing && route.request().method() === 'GET'
      ? route.fulfill({ status: 500, json: { success: false, error: 'Something went wrong' } })
      : route.continue()
  );
  await page.goto('/wishlists/e2e-birthday');

  const loadError = page.getByRole('heading', { name: 'Couldn’t load this list’s items' });
  await expect(loadError).toBeVisible();
  // Exclusive with the error panel, so checking these while it shows is enough.
  await expect(emptyList(page)).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Search items by name' })).toHaveCount(0);
  await expect(page.getByRole('radiogroup', { name: 'Show items' })).toHaveCount(0);
  await expect(page.getByRole('status').getByText('Failed to load items')).toHaveCount(0);

  // Try again reads them afresh.
  failing = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('article', { name: 'Item: E2E Gift' })).toBeVisible();
  await expect(loadError).toHaveCount(0);
});

test('a poll that lands after a failed first load fills the list in', async ({ page }) => {
  let failing = true;
  await page.route(ITEMS, (route) =>
    failing && route.request().method() === 'GET'
      ? route.fulfill({ status: 500, json: { success: false, error: 'Something went wrong' } })
      : route.continue()
  );
  await page.goto('/wishlists/e2e-birthday');
  const loadError = page.getByRole('heading', { name: 'Couldn’t load this list’s items' });
  await expect(loadError).toBeVisible();

  failing = false;
  await pollOnce(page);
  await expect(page.getByRole('article', { name: 'Item: E2E Gift' })).toBeVisible();
  await expect(loadError).toHaveCount(0);
});
