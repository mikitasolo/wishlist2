import { test, expect } from './fixtures';

// The desktop bookmarklet (WIS-367): the Settings card's button carries the
// code with this deployment's origin; run on a product page it opens
// /items/new on the app with the product in the fragment.

const STORE = 'https://shop.example.com/p/mug';

test('the Settings button, run on a product page, opens the add flow with the product', async ({
  page,
  context,
}) => {
  await page.goto('/settings');
  const link = page.getByRole('link', { name: 'Add to wishlist' });
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^javascript:/);
  const code = decodeURIComponent(href!.slice('javascript:'.length));
  const origin = new URL(page.url()).origin;
  expect(code).toContain(origin);

  // A stand-in store page; nothing leaves the machine.
  await context.route(STORE, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><head><title>Mug</title>
<script type="application/ld+json">{"@type":"Product","name":"E2E Mug","offers":{"@type":"Offer","price":"24.90","priceCurrency":"EUR"}}</script>
</head><body>Mug</body></html>`,
    })
  );
  const store = await context.newPage();
  await store.goto(STORE);

  const popup = store.waitForEvent('popup');
  await store.evaluate((src) => new Function(src)(), code);
  const opened = await popup;

  await expect(opened.getByRole('dialog', { name: 'Add to a wishlist' })).toBeVisible();
  expect(new URL(opened.url()).origin).toBe(origin);
  // The store page itself was not navigated or changed.
  expect(store.url()).toBe(STORE);
});
