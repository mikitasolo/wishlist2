import { test, expect, type Page, type Request, type Route } from '@playwright/test';

// The wishlist page polls its items every 5 s (and whenever the tab becomes
// visible), replacing the whole list with the server's. These specs pin the
// order in which a poll and an add/proposal land, so the page is told it's
// hidden from the start (it skips every timer tick) and each poll is fired by
// hand with a visibilitychange. Concurrent item reads share one request, so a
// stray tick would also swallow the poll a spec fires.
async function takeOverPolling(page: Page) {
  await page.addInitScript(() => {
    let state: DocumentVisibilityState = 'hidden';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    });
    (window as unknown as { __pollOnce: () => void }).__pollOnce = () => {
      state = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
      state = 'hidden';
    };
  });
}

async function pollOnce(page: Page) {
  await page.evaluate(() => (window as unknown as { __pollOnce: () => void }).__pollOnce());
}

// Hold the next request of `method` to the items endpoint: it is sent to the
// server right away (so its response reflects the database at that moment) but
// only delivered to the page on release().
function holdNext(page: Page, method: 'GET' | 'POST') {
  let armed = true;
  let markHeld!: (request: Request) => void;
  const held = new Promise<Request>((resolve) => (markHeld = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));

  const handler = async (route: Route) => {
    if (!armed || route.request().method() !== method) return route.continue();
    armed = false;
    const response = await route.fetch();
    markHeld(route.request());
    await released;
    await route.fulfill({ response });
  };
  return { handler, held, release };
}

for (const flow of [
  {
    as: 'owner',
    list: 'e2e-birthday',
    open: '+ Add Item',
    title: 'Add New Item',
    submit: 'Add Item',
    done: 'Item added successfully',
  },
  {
    as: 'member',
    list: 'e2e-friend',
    open: '+ Propose Item',
    title: 'Propose New Item',
    submit: 'Propose Item',
    done: 'Item proposed successfully',
  },
]) {
  async function openAndFill(page: Page, name: string) {
    await takeOverPolling(page);
    await page.goto(`/wishlists/${flow.list}`);
    // Wait out the initial load, so the poll a spec fires is a request of its own.
    await expect(
      page.getByRole('article').or(page.getByText('No items found')).first()
    ).toBeVisible();
    await page.getByRole('button', { name: flow.open }).click();
    const dialog = page.getByRole('dialog', { name: flow.title });
    await dialog.getByLabel('Item Name').fill(name);
    return dialog.getByRole('button', { name: flow.submit, exact: true });
  }

  // regression: the add/propose paths prepended the new item without bumping
  // lastMutationAt, so a poll whose GET started before the POST settled resolved
  // afterwards with the old list and hid the item until the next poll.
  test(`regression: a poll that read before the ${flow.as}'s new item was saved doesn't hide it`, async ({
    page,
  }) => {
    const name = `E2E Hidden ${flow.as} ${Date.now()}`;
    const card = page.getByRole('article', { name: `Item: ${name}` });
    const submit = await openAndFill(page, name);

    const poll = holdNext(page, 'GET');
    await page.route('**/api/wishlists/*/items', poll.handler);
    await pollOnce(page);
    const pollRequest = await poll.held; // read the list before the item exists

    await submit.click();
    await expect(page.getByRole('status').getByText(flow.done)).toBeVisible();
    await expect(card).toHaveCount(1);

    const delivered = page.waitForEvent('requestfinished', (r) => r === pollRequest);
    poll.release();
    await delivered;
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)));

    // The page has had the stale list for a while now, and no later poll can
    // run to put the item back, so this count is the settled state.
    expect(await card.count()).toBe(1);
  });

  // regression: the POST response was prepended unconditionally, so when a poll
  // that read after the server's write had already listed the item, the same
  // _id showed up twice until the next poll.
  test(`regression: a poll that already listed the ${flow.as}'s new item doesn't get it doubled`, async ({
    page,
  }) => {
    const name = `E2E Doubled ${flow.as} ${Date.now()}`;
    const card = page.getByRole('article', { name: `Item: ${name}` });
    const submit = await openAndFill(page, name);

    const create = holdNext(page, 'POST');
    await page.route('**/api/wishlists/*/items', create.handler);
    await submit.click();
    await create.held; // the server has written the item; the page doesn't know yet

    await pollOnce(page);
    await expect(card).toHaveCount(1);

    create.release();
    await expect(page.getByRole('status').getByText(flow.done)).toBeVisible();
    // The toast and the list update are set in the same callback, so they
    // render together: a one-off count here sees the merged list.
    expect(await card.count()).toBe(1);
  });
}
