import { test, expect, type Page, type Request, type Route } from '@playwright/test';
import { randomBytes } from 'crypto';

// The wishlist page polls its items every 5 s (and whenever the tab becomes
// visible), replacing the whole list with the server's. These specs pin the
// order in which a poll and an add, proposal or delete land, so the page is
// told it's hidden from the start (it skips every timer tick) and each poll is
// fired by hand with a visibilitychange. Concurrent item reads share one
// request, so a stray tick would also swallow the poll a spec fires.
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

// The create request is answered here, never by the server, so nothing reaches
// the seeded database: the reply is the submitted item, as the server would
// return it once saved (a proposal carries its proposer, which is what keeps it
// under the member's "Proposed by You" filter).
async function signedInUserId(page: Page): Promise<string> {
  const session = await (await page.request.get('/api/auth/session')).json();
  return session.user.id;
}

function createdItem(request: Request, userId: string) {
  const body = request.postDataJSON();
  const now = new Date().toISOString();
  return {
    _id: randomBytes(12).toString('hex'),
    wishlist: 'e2e',
    ...body,
    status: body.status ?? 'available',
    mostWanted: body.mostWanted ?? false,
    bookedBy: null,
    ...(body.status === 'proposed' ? { proposedBy: userId } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
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
    const userId = await signedInUserId(page);
    await takeOverPolling(page);
    await page.goto(`/wishlists/${flow.list}`);
    // Wait out the initial load, so the poll a spec fires is a request of its own.
    await expect(
      page.getByRole('article').or(page.getByText('No items found')).first()
    ).toBeVisible();
    await page.getByRole('button', { name: flow.open }).click();
    const dialog = page.getByRole('dialog', { name: flow.title });
    await dialog.getByLabel('Item Name').fill(name);
    return { submit: dialog.getByRole('button', { name: flow.submit, exact: true }), userId };
  }

  // regression: the add/propose paths prepended the new item without bumping
  // lastMutationAt, so a poll whose GET started before the POST settled resolved
  // afterwards with the old list and hid the item until the next poll.
  test(`regression: a poll that read before the ${flow.as}'s new item was saved doesn't hide it`, async ({
    page,
  }) => {
    const name = `E2E Hidden ${flow.as}`;
    const card = page.getByRole('article', { name: `Item: ${name}` });
    const { submit, userId } = await openAndFill(page, name);

    // The poll reads the list now, before the item exists, but only hands it
    // to the page once the add has settled.
    const pollRead = deferred<Request>();
    const deliverPoll = deferred();
    await page.route('**/api/wishlists/*/items', async (route: Route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        return route.fulfill({
          status: 201,
          json: { success: true, data: createdItem(request, userId) },
        });
      }
      const response = await route.fetch();
      pollRead.resolve(request);
      await deliverPoll.promise;
      await route.fulfill({ response });
    });
    await pollOnce(page);
    const pollRequest = await pollRead.promise;

    await submit.click();
    await expect(page.getByRole('status').getByText(flow.done)).toBeVisible();
    await expect(card).toHaveCount(1);

    const delivered = page.waitForEvent('requestfinished', (r) => r === pollRequest);
    deliverPoll.resolve();
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
    const name = `E2E Doubled ${flow.as}`;
    const card = page.getByRole('article', { name: `Item: ${name}` });
    const { submit, userId } = await openAndFill(page, name);

    // The item is "saved" as soon as the POST arrives, but its response is held
    // until a poll has listed it.
    let saved: ReturnType<typeof createdItem> | undefined;
    const postArrived = deferred();
    const answerPost = deferred();
    await page.route('**/api/wishlists/*/items', async (route: Route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        saved = createdItem(request, userId);
        postArrived.resolve();
        await answerPost.promise;
        return route.fulfill({ status: 201, json: { success: true, data: saved } });
      }
      const response = await route.fetch();
      const body = await response.json();
      if (saved) body.data = [saved, ...body.data];
      await route.fulfill({ response, json: body });
    });
    await submit.click();
    await postArrived.promise;

    await pollOnce(page);
    await expect(card).toHaveCount(1);

    answerPost.resolve();
    await expect(page.getByRole('status').getByText(flow.done)).toBeVisible();
    // The toast and the list update are set in the same callback, so they
    // render together: a one-off count here sees the merged list.
    expect(await card.count()).toBe(1);
  });
}

// Owners can't create proposals, so the review flow's one is added to the
// owner's list in the browser.
const polledProposal = {
  _id: '0000000000000000000e2e02',
  wishlist: 'e2e',
  name: 'E2E Polled Proposal',
  status: 'proposed',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

for (const flow of [
  {
    from: 'edit',
    item: 'E2E Gift',
    open: 'Edit item',
    title: 'Edit Item',
    done: 'Item deleted successfully',
  },
  {
    from: 'review',
    item: polledProposal.name,
    open: 'Review proposed item',
    title: 'Review Proposed Item',
    done: 'Proposed item deleted',
  },
]) {
  // regression: the delete handlers filtered the item out without bumping
  // lastMutationAt, so a poll whose GET started before the DELETE settled
  // resolved afterwards with the old list and brought the deleted item back
  // until the next poll (and deleting it again got a 404).
  test(`regression: a poll that read before a delete from the ${flow.from} modal doesn't bring the item back`, async ({
    page,
  }) => {
    const card = page.getByRole('article', { name: `Item: ${flow.item}` });

    // The DELETE is answered here, so nothing reaches the seeded database;
    // reads made after it leave the item out, as the server would.
    let deleted = false;
    await page.route('**/api/items/*', (route: Route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      deleted = true;
      return route.fulfill({ json: { success: true } });
    });

    // Every read lists the proposal. The poll a spec fires reads the list
    // while the item still exists, but only hands it to the page once the
    // delete has settled.
    let holdNextRead = false;
    const pollRead = deferred<Request>();
    const deliverPoll = deferred();
    await page.route('**/api/wishlists/*/items', async (route: Route) => {
      const request = route.request();
      if (request.method() !== 'GET') return route.fallback();
      const isPoll = holdNextRead;
      holdNextRead = false;
      const response = await route.fetch();
      const body = await response.json();
      if (body.success) {
        body.data = [polledProposal, ...body.data].filter(
          (item: { name: string }) => !(deleted && item.name === flow.item)
        );
      }
      if (isPoll) {
        pollRead.resolve(request);
        await deliverPoll.promise;
      }
      await route.fulfill({ response, json: body });
    });

    await takeOverPolling(page);
    await page.goto('/wishlists/e2e-birthday');
    // Once the card can be opened the initial load is done, so the poll below
    // is a request of its own.
    await card.getByRole('button', { name: flow.open }).click();
    await page
      .getByRole('dialog', { name: flow.title })
      .getByRole('button', { name: 'Delete Item' })
      .click();

    holdNextRead = true;
    await pollOnce(page);
    const pollRequest = await pollRead.promise;

    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(page.getByRole('status').getByText(flow.done)).toBeVisible();
    await expect(card).toHaveCount(0);

    const delivered = page.waitForEvent('requestfinished', (r) => r === pollRequest);
    deliverPoll.resolve();
    await delivered;
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)));

    // The page has had the stale list for a while now, and no later poll can
    // run to take the item out again, so this count is the settled state.
    expect(await card.count()).toBe(0);
  });
}
