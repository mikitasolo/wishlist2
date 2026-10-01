import { test, expect, type Page, type Request, type Route } from '@playwright/test';
import { randomBytes } from 'crypto';
import { ITEM_REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MESSAGE } from '../lib/utils/requestTimeout';

// The wishlist page polls its items every 5 s (and whenever the tab becomes
// visible), replacing the whole list with the server's, and reads the list
// again straight away when a read turns out stale. These specs pin the order in
// which a read and an add, proposal, delete or update land, and that the page
// itself sends the read that follows a stale one, so the page is told it's
// hidden from the start (it skips every timer tick) and each poll is fired by
// hand with a visibilitychange. A tick would read the list on its own, and hide
// whether the page did.
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

type ListedItem = { _id: string; name: string } & Record<string, unknown>;

interface HeldRead {
  /** Answer the read, and give the page a moment to apply (or drop) it. */
  land(): Promise<void>;
}

// From here on, every items read the page sends is held until the spec lands
// it, so the spec decides the order in which reads and writes land. Each read
// gets the server's list as `serve` shapes it once the server has answered: the
// spec answers its writes in the browser, so nothing reaches the seeded
// database, and `serve` lists them the way the server would.
async function holdItemReads(page: Page, serve: (items: ListedItem[]) => ListedItem[]) {
  let sent = 0;
  let taken = 0;
  const ready: HeldRead[] = [];
  const waiting: Array<(read: HeldRead) => void> = [];
  await page.route('**/api/wishlists/*/items', async (route: Route) => {
    const request = route.request();
    if (request.method() !== 'GET') return route.fallback();
    sent += 1;
    const response = await route.fetch();
    const body = await response.json();
    if (body.success) body.data = serve(body.data);
    const answer = deferred();
    const read: HeldRead = {
      async land() {
        const finished = page.waitForEvent('requestfinished', (r) => r === request);
        answer.resolve();
        await finished;
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)));
      },
    };
    const next = waiting.shift();
    if (next) next(read);
    else ready.push(read);
    await answer.promise;
    await route.fulfill({ response, json: body });
  });
  return {
    /** The next read the page sends, once the server has answered it. */
    next(): Promise<HeldRead> {
      taken += 1;
      const read = ready.shift();
      if (read) return Promise.resolve(read);
      return new Promise<HeldRead>((resolve, reject) => {
        const take = (sent: HeldRead) => {
          clearTimeout(timer);
          resolve(sent);
        };
        const timer = setTimeout(() => {
          waiting.splice(waiting.indexOf(take), 1);
          reject(new Error('The page sent no items read within 10 s'));
        }, 10_000);
        waiting.push(take);
      });
    },
    /** Reads the page has sent that the spec hasn't taken with `next()`. */
    get untaken() {
      return sent - taken;
    },
  };
}

const cardOf = (page: Page, name: string) => page.getByRole('article', { name: `Item: ${name}` });

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
  // The create request is answered in the browser, and reads the server
  // answers after it list the item, as the server would.
  async function answerCreate(page: Page, userId: string) {
    const created: { item?: ListedItem } = {};
    await page.route('**/api/wishlists/*/items', (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      created.item = createdItem(route.request(), userId);
      return route.fulfill({ status: 201, json: { success: true, data: created.item } });
    });
    return (items: ListedItem[]) => (created.item ? [created.item, ...items] : items);
  }

  async function fillIn(page: Page, name: string) {
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
    const name = `E2E Hidden ${flow.as}`;
    const card = cardOf(page, name);
    const userId = await signedInUserId(page);
    await takeOverPolling(page);
    await page.goto(`/wishlists/${flow.list}`);
    // Wait out the initial load, so the poll a spec fires is a request of its own.
    await expect(
      page.getByRole('article').or(page.getByText('No items found')).first()
    ).toBeVisible();
    const submit = await fillIn(page, name);
    const reads = await holdItemReads(page, await answerCreate(page, userId));

    // The poll reads the list now, before the item exists, but only hands it
    // to the page once the add has settled.
    await pollOnce(page);
    const poll = await reads.next();

    await submit.click();
    await expect(page.getByRole('status').getByText(flow.done)).toBeVisible();
    await expect(card).toHaveCount(1);

    await poll.land();
    // The page has had the stale list for a while now, and the read it sends
    // in its place is held, so this count is the settled state.
    expect(await card.count()).toBe(1);

    await (await reads.next()).land();
    expect(await card.count()).toBe(1);
  });

  // regression: the POST response was prepended unconditionally, so when a read
  // made after the server's write had already listed the item, the same _id
  // showed up twice until the next poll. A poll that lands while the POST is in
  // flight is dropped, but the initial load always lands, so that's the read
  // that lists it here.
  test(`regression: a read that already listed the ${flow.as}'s new item doesn't get it doubled`, async ({
    page,
  }) => {
    const name = `E2E Doubled ${flow.as}`;
    const card = cardOf(page, name);
    const userId = await signedInUserId(page);

    // The item is "saved" as soon as the POST arrives, but its response is held
    // until the initial load, which waits for the save, has listed it.
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
      await postArrived.promise;
      const response = await route.fetch();
      const body = await response.json();
      body.data = [saved, ...body.data];
      await route.fulfill({ response, json: body });
    });
    await takeOverPolling(page);
    await page.goto(`/wishlists/${flow.list}`);
    // The button shows before the items have loaded.
    await (await fillIn(page, name)).click();
    await postArrived.promise;

    await expect(card).toHaveCount(1);

    // The initial load landed while the POST was in flight, so the page reads
    // the list again once it settles.
    const reread = page.waitForEvent(
      'requestfinished',
      (r) => r.method() === 'GET' && new URL(r.url()).pathname.endsWith('/items')
    );
    answerPost.resolve();
    await expect(page.getByRole('status').getByText(flow.done)).toBeVisible();
    // The toast and the list update are set in the same callback, so they
    // render together: a one-off count here sees the merged list.
    expect(await card.count()).toBe(1);

    await reread;
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 250)));
    expect(await card.count()).toBe(1);
  });

  // regression: only a background read was checked against the page's own
  // writes, so the initial load, sent before an add and landing after it,
  // replaced the list without the new item, and nothing read it again until
  // the next poll.
  test(`regression: the ${flow.as}'s item saved while the list is loading shows once it has loaded`, async ({
    page,
  }) => {
    const name = `E2E Early ${flow.as}`;
    const card = cardOf(page, name);
    const userId = await signedInUserId(page);
    const reads = await holdItemReads(page, await answerCreate(page, userId));
    await takeOverPolling(page);
    await page.goto(`/wishlists/${flow.list}`);
    const load = await reads.next();

    // The button shows before the items have loaded.
    await (await fillIn(page, name)).click();
    await expect(page.getByRole('status').getByText(flow.done)).toBeVisible();

    // The load from before the add still lands, so the list isn't left empty,
    // and the page reads it again straight away: no tick can run here.
    await load.land();
    await expect(
      page.getByRole('article').or(page.getByText('No items found')).first()
    ).toBeVisible();
    const reread = await reads.next();

    await reread.land();
    await expect(card).toHaveCount(1);
    expect(reads.untaken).toBe(0);
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
    const card = cardOf(page, flow.item);

    // The DELETE is answered here, so nothing reaches the seeded database;
    // reads the server answers after it leave the item out, as it would.
    let deleted = false;
    await page.route('**/api/items/*', (route: Route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      deleted = true;
      return route.fulfill({ json: { success: true } });
    });
    const reads = await holdItemReads(page, (items) =>
      [polledProposal, ...items].filter((item) => !(deleted && item.name === flow.item))
    );

    await takeOverPolling(page);
    await page.goto('/wishlists/e2e-birthday');
    await (await reads.next()).land();
    await card.getByRole('button', { name: flow.open }).click();
    await page
      .getByRole('dialog', { name: flow.title })
      .getByRole('button', { name: 'Delete Item' })
      .click();

    // The poll reads the list while the item still exists, but only hands it
    // to the page once the delete has settled.
    await pollOnce(page);
    const poll = await reads.next();

    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(page.getByRole('status').getByText(flow.done)).toBeVisible();
    await expect(card).toHaveCount(0);

    await poll.land();
    // The page has had the stale list for a while now, and the read it sends
    // in its place is held, so this count is the settled state.
    expect(await card.count()).toBe(0);

    await (await reads.next()).land();
    expect(await card.count()).toBe(0);
  });
}

// A member's list with something to book: added to its reads in the browser,
// like the owner's proposal above.
const polledBookable = {
  _id: '0000000000000000000e2e03',
  wishlist: 'e2e',
  name: 'E2E Polled Bookable',
  status: 'available',
  bookedBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

async function renameGift(page: Page) {
  await cardOf(page, 'E2E Gift').getByRole('button', { name: 'Edit item' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Item' });
  await dialog.getByLabel('Item Name').fill('E2E Renamed Gift');
  await dialog.getByRole('button', { name: 'Save Changes' }).click();
}

// Answers the item PATCH here as the server would, once `answer` resolves, so
// nothing reaches the seeded database. `served` is the list the page was last
// served, and `serve` lists the item as updated in every read the server
// answers after that.
async function answerUpdate(
  page: Page,
  userId: string,
  served: () => ListedItem[],
  answer: Promise<void> = Promise.resolve()
) {
  const arrived = deferred();
  let updated: ListedItem | undefined;
  await page.route('**/api/items/*', async (route: Route) => {
    const request = route.request();
    if (request.method() !== 'PATCH') return route.fallback();
    arrived.resolve();
    await answer;
    const id = new URL(request.url()).pathname.split('/').pop();
    const updates = request.postDataJSON();
    updated = {
      ...served().find((item) => item._id === id)!,
      ...updates,
      ...(updates.status === 'booked' ? { bookedBy: userId } : {}),
    };
    await route.fulfill({ json: { success: true, data: updated } });
  });
  return {
    arrived: arrived.promise,
    serve: (items: ListedItem[]) =>
      items.map((item) => (updated && item._id === updated._id ? updated : item)),
  };
}

for (const flow of [
  {
    during: 'an edit',
    list: 'e2e-birthday',
    extra: null,
    start: renameGift,
    changed: (page: Page) => cardOf(page, 'E2E Renamed Gift'),
    reverted: (page: Page) => cardOf(page, 'E2E Gift'),
    async settled(page: Page) {
      await expect(page.getByRole('dialog', { name: 'Edit Item' })).toBeHidden();
    },
  },
  {
    during: 'an approve',
    list: 'e2e-birthday',
    extra: polledProposal,
    async start(page: Page) {
      await cardOf(page, polledProposal.name)
        .getByRole('button', { name: 'Review proposed item' })
        .click();
      await page
        .getByRole('dialog', { name: 'Review Proposed Item' })
        .getByRole('button', { name: 'Approve Item' })
        .click();
    },
    // Only a published item has owner buttons; a proposal is reviewed instead.
    changed: (page: Page) =>
      cardOf(page, polledProposal.name).getByRole('button', { name: 'Edit item' }),
    reverted: (page: Page) =>
      cardOf(page, polledProposal.name).getByText('Proposed', { exact: true }),
    async settled(page: Page) {
      await expect(page.getByRole('status').getByText('Item approved successfully')).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Review Proposed Item' })).toBeHidden();
    },
  },
  {
    during: 'a booking',
    list: 'e2e-friend',
    extra: polledBookable,
    async start(page: Page) {
      await cardOf(page, polledBookable.name)
        .getByRole('button', { name: 'Book this item', exact: true })
        .click();
    },
    changed: (page: Page) => cardOf(page, polledBookable.name).getByText('Booked by you'),
    reverted: (page: Page) =>
      cardOf(page, polledBookable.name).getByRole('button', {
        name: 'Book this item',
        exact: true,
      }),
    async settled(page: Page) {
      await expect(
        cardOf(page, polledBookable.name).getByRole('button', { name: 'Unbook this item' })
      ).toBeEnabled();
    },
  },
]) {
  // regression: a poll was dropped only if the update's settle stamp was later
  // than the poll's start. One that started after the update did and resolved
  // before its PATCH settled was applied, so the server's copy from before the
  // write flipped the item back (the edit undone, the proposal "Proposed" again
  // under "Approving...", the booking un-booked) until the PATCH response landed.
  test(`regression: a poll that reads during ${flow.during} doesn't undo it before it settles`, async ({
    page,
  }) => {
    const userId = await signedInUserId(page);

    // Every read gets the server's list (plus the flow's extra item), so the
    // poll gets the item as it was before the update. The PATCH is held until
    // the poll has landed.
    let served: ListedItem[] = [];
    const answerPatch = deferred();
    const update = await answerUpdate(page, userId, () => served, answerPatch.promise);
    const reads = await holdItemReads(page, (items) => {
      served = update.serve(flow.extra ? [flow.extra, ...items] : items);
      return served;
    });

    await takeOverPolling(page);
    await page.goto(`/wishlists/${flow.list}`);
    await (await reads.next()).land();
    await flow.start(page);
    await update.arrived;
    await expect(flow.changed(page)).toBeVisible();

    // The poll starts after the update did and lands while its PATCH is held.
    await pollOnce(page);
    await (await reads.next()).land();

    // The page has had the poll's list for a while now, and the PATCH is still
    // held, so these counts are what it shows until the update settles. Nor
    // does it read the list again before then.
    expect(await flow.reverted(page).count()).toBe(0);
    expect(await flow.changed(page).count()).toBe(1);
    expect(reads.untaken).toBe(0);

    // Once the PATCH has settled, the page reads the list in place of the
    // dropped poll, and it lists the item as updated.
    answerPatch.resolve();
    await flow.settled(page);
    await (await reads.next()).land();
    await expect(flow.changed(page)).toBeVisible();
    expect(await flow.reverted(page).count()).toBe(0);
  });
}

// regression: a poll called while another items read was in flight joined that
// request instead of sending its own, but was judged by when it was called. So
// a read sent before an edit settled and landing after it was dropped by the
// poll that sent it but applied by the one that joined it, and the edit was
// undone until the next poll.
test("regression: a poll that joins a read sent before an edit settled doesn't undo the edit", async ({
  page,
}) => {
  const renamed = cardOf(page, 'E2E Renamed Gift');
  const original = cardOf(page, 'E2E Gift');
  const userId = await signedInUserId(page);
  let served: ListedItem[] = [];
  const update = await answerUpdate(page, userId, () => served);
  const reads = await holdItemReads(page, (items) => (served = update.serve(items)));

  await takeOverPolling(page);
  await page.goto('/wishlists/e2e-birthday');
  await (await reads.next()).land();

  // A poll reads the list before the edit, and is slow to answer.
  await pollOnce(page);
  const slowRead = await reads.next();

  await renameGift(page);
  await expect(page.getByRole('dialog', { name: 'Edit Item' })).toBeHidden();
  await expect(renamed).toBeVisible();

  // The next poll (the tab regaining focus, say) joins the read still in flight.
  await pollOnce(page);
  await slowRead.land();

  // Neither poll applied the read from before the edit, and the one the page
  // sends in its place is still held, so this is the settled state.
  expect(await original.count()).toBe(0);
  expect(await renamed.count()).toBe(1);

  await (await reads.next()).land();
  await expect(renamed).toBeVisible();
  expect(await original.count()).toBe(0);
  // Both polls asked for the one re-read, which read the list afresh.
  expect(reads.untaken).toBe(0);
});

// regression: after a failed update the page reconciles the list with a read,
// which was dropped if another item mutation was still in flight when it
// landed, and nothing read the list again until the next poll. The booking here
// fails as far as the page can tell (a gateway timeout), though the server did
// save it, so the page puts the item back at once and only that read shows it
// booked.
test("regression: a failed booking's reconcile read dropped behind a proposal is read again once it's saved", async ({
  page,
}) => {
  const bookable = cardOf(page, polledBookable.name);
  const bookedByMe = bookable.getByText('Booked by you');
  const bookButton = bookable.getByRole('button', { name: 'Book this item', exact: true });
  const userId = await signedInUserId(page);

  // Reads the server answers once the PATCH has arrived list the item booked.
  // The proposal is saved once its POST arrives, but its response is held until
  // the reconcile read has landed.
  let bookedOnServer = false;
  await page.route('**/api/items/*', (route: Route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    bookedOnServer = true;
    return route.fulfill({ status: 504, json: { success: false, error: 'Something went wrong' } });
  });
  let proposal: ListedItem | undefined;
  const postArrived = deferred();
  const answerPost = deferred();
  const reads = await holdItemReads(page, (items) => [
    ...(proposal ? [proposal] : []),
    bookedOnServer ? { ...polledBookable, status: 'booked', bookedBy: userId } : polledBookable,
    ...items,
  ]);
  await page.route('**/api/wishlists/*/items', async (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    postArrived.resolve();
    await answerPost.promise;
    proposal = createdItem(route.request(), userId);
    await route.fulfill({ status: 201, json: { success: true, data: proposal } });
  });

  await takeOverPolling(page);
  await page.goto('/wishlists/e2e-friend');
  await (await reads.next()).land();

  await bookButton.click();
  await expect(page.getByRole('status').getByText('Something went wrong')).toBeVisible();
  // The failed booking is put back without waiting for the reconcile read.
  const reconcile = await reads.next();
  await expect(bookButton).toBeVisible();
  expect(await bookedByMe.count()).toBe(0);

  await page.getByRole('button', { name: '+ Propose Item' }).click();
  const dialog = page.getByRole('dialog', { name: 'Propose New Item' });
  await dialog.getByLabel('Item Name').fill('E2E Proposed Meanwhile');
  await dialog.getByRole('button', { name: 'Propose Item', exact: true }).click();
  await postArrived.promise;

  // The reconcile read lands while the proposal's POST is in flight, so it's
  // dropped, and the page reads nothing more until the POST settles.
  await reconcile.land();
  expect(await bookedByMe.count()).toBe(0);
  expect(reads.untaken).toBe(0);

  answerPost.resolve();
  await expect(page.getByRole('status').getByText('Item proposed successfully')).toBeVisible();
  await (await reads.next()).land();
  await expect(bookedByMe).toBeVisible();
  expect(reads.untaken).toBe(0);
});

// regression: only an approve put the item back when its PATCH failed; any
// other update was undone by the reconcile read alone, and a failed read keeps
// the list. So a booking that failed because the network was down stayed on the
// card as "Booked by you" (on an item nobody booked) until a later poll got
// through.
test('regression: a booking that fails while offline is put back at once, though the reconcile read fails too', async ({
  page,
}) => {
  const bookable = cardOf(page, polledBookable.name);
  const bookedByMe = bookable.getByText('Booked by you');
  const bookButton = bookable.getByRole('button', { name: 'Book this item', exact: true });

  // The list loads, then the network goes down: the PATCH, held until the
  // booking shows, and every read after the first fail.
  const failPatch = deferred();
  await page.route('**/api/items/*', async (route: Route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    await failPatch.promise;
    await route.abort('internetdisconnected');
  });
  let loaded = false;
  await page.route('**/api/wishlists/*/items', async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (loaded) return route.abort('internetdisconnected');
    loaded = true;
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, data: [polledBookable, ...body.data] } });
  });

  await takeOverPolling(page);
  await page.goto('/wishlists/e2e-friend');
  await bookButton.click();
  await expect(bookedByMe).toBeVisible();

  const reconcileFailed = page.waitForEvent(
    'requestfailed',
    (r) => r.method() === 'GET' && new URL(r.url()).pathname.endsWith('/items')
  );
  failPatch.resolve();
  // Only the page can put the item back now: the reconcile read fails, and no
  // poll runs.
  await reconcileFailed;
  await expect(bookedByMe).toHaveCount(0);
  await expect(bookButton).toBeVisible();
});

// Another owner's item, added to the list's reads in the browser while the
// spec's own request is stalled.
const coOwnersItem = {
  _id: '0000000000000000000e2e04',
  wishlist: 'e2e',
  name: "E2E Co-owner's Item",
  status: 'available',
  bookedBy: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// regression: item requests had no timeout, and the page holds off its polls
// while one is in flight. So a PATCH that stalled (on a dropped connection the
// browser takes minutes to notice) kept the modal on "Saving...", the card
// showing the unsaved edit, and the whole list frozen, until the browser gave
// up on it. The page's clock is faked, so the spec jumps past the timeout.
test('regression: a stalled edit is given up on, the item goes back to its server state, and polls land again', async ({
  page,
}) => {
  const renamed = cardOf(page, 'E2E Renamed Gift');
  const original = cardOf(page, 'E2E Gift');
  const coOwners = cardOf(page, coOwnersItem.name);
  const later = cardOf(page, 'E2E Added Later');

  // The PATCH never answers. Reads list what the co-owner has added so far.
  const patchArrived = deferred();
  await page.route('**/api/items/*', async (route: Route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    patchArrived.resolve();
    await new Promise(() => {});
  });
  const addedByCoOwner: ListedItem[] = [];
  const reads = await holdItemReads(page, (items) => [...addedByCoOwner, ...items]);

  await page.clock.install();
  await takeOverPolling(page);
  await page.goto('/wishlists/e2e-birthday');
  await (await reads.next()).land();

  await renameGift(page);
  await patchArrived.promise;
  const dialog = page.getByRole('dialog', { name: 'Edit Item' });
  await expect(dialog.getByRole('button', { name: 'Saving...' })).toBeVisible();
  await expect(renamed).toBeVisible();

  // A poll while the PATCH is stalled is dropped, so the co-owner's item
  // doesn't show, and nothing reads the list again yet.
  addedByCoOwner.push(coOwnersItem);
  await pollOnce(page);
  await (await reads.next()).land();
  expect(await coOwners.count()).toBe(0);
  expect(reads.untaken).toBe(0);

  await page.clock.fastForward(ITEM_REQUEST_TIMEOUT_MS);

  // Treated as a failure: the toast, the item put back as the server has it,
  // and the modal kept open with the user's edit.
  await expect(page.getByRole('status').getByText(REQUEST_TIMEOUT_MESSAGE)).toBeVisible();
  await expect(original).toBeVisible();
  expect(await renamed.count()).toBe(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Item Name')).toHaveValue('E2E Renamed Gift');
  await expect(dialog.getByRole('button', { name: 'Save Changes' })).toBeEnabled();

  // The reconcile read, which the dropped poll's re-read joins, lands.
  await (await reads.next()).land();
  await expect(coOwners).toBeVisible();
  await expect(original).toBeVisible();
  expect(reads.untaken).toBe(0);

  // And a later poll lands too.
  addedByCoOwner.push({
    ...coOwnersItem,
    _id: '0000000000000000000e2e05',
    name: 'E2E Added Later',
  });
  await pollOnce(page);
  await (await reads.next()).land();
  await expect(later).toBeVisible();
});

// A proposal given up on may still have been saved. The member is told it
// failed, keeps what they typed, and the next poll lists it if it went through,
// so they can see it before proposing it again.
test('a stalled proposal is given up on, keeping the modal open, and the next poll shows it if it was saved', async ({
  page,
}) => {
  const name = 'E2E Stalled Proposal';
  const card = cardOf(page, name);
  const userId = await signedInUserId(page);

  // The server saves the proposal as its POST arrives, but never answers it.
  let saved: ListedItem | undefined;
  const postArrived = deferred();
  await page.route('**/api/wishlists/*/items', async (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    saved = createdItem(route.request(), userId);
    postArrived.resolve();
    await new Promise(() => {});
  });
  const reads = await holdItemReads(page, (items) => (saved ? [saved, ...items] : items));

  await page.clock.install();
  await takeOverPolling(page);
  await page.goto('/wishlists/e2e-friend');
  await (await reads.next()).land();

  await page.getByRole('button', { name: '+ Propose Item' }).click();
  const dialog = page.getByRole('dialog', { name: 'Propose New Item' });
  await dialog.getByLabel('Item Name').fill(name);
  await dialog.getByRole('button', { name: 'Propose Item', exact: true }).click();
  await postArrived.promise;

  await page.clock.fastForward(ITEM_REQUEST_TIMEOUT_MS);
  await expect(page.getByRole('status').getByText(REQUEST_TIMEOUT_MESSAGE)).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Item Name')).toHaveValue(name);
  await expect(dialog.getByRole('button', { name: 'Propose Item', exact: true })).toBeEnabled();
  expect(await card.count()).toBe(0);

  await pollOnce(page);
  await (await reads.next()).land();
  await expect(card).toHaveCount(1);
});
