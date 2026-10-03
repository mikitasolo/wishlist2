import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// The seeded owner list has no members, so one is added to the members GET in
// the browser. Every confirmed request is answered there too: nothing reaches
// the database, so the other specs keep their lists.
const member = {
  _id: '0000000000000000000e2e89',
  user: { _id: '0000000000000000000e2e90', username: 'e2emember', image: null },
  role: 'member',
  createdAt: '2026-01-01T00:00:00.000Z',
};

async function addMember(page: Page) {
  await page.route('**/api/wishlists/*/members', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    if (!body.success) return route.fulfill({ response, json: body });
    await route.fulfill({ response, json: { ...body, data: [...body.data, member] } });
  });
}

async function openManage(page: Page) {
  await page.getByRole('button', { name: 'Manage wishlist' }).click();
}

const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const SECOND_ANSWER = 'Already done';

// regression: ConfirmDialog had no pending state, and Remove member / owner,
// Leave and Delete wishlist only close it once their request settles, so a
// double click sent the request twice. The second one failed, and its error
// toast followed the success. ("Make owner" closed before sending, so it showed
// nothing while the invite went out; it now waits in its dialog like the rest.)
for (const flow of [
  {
    name: 'Remove member',
    title: 'Remove @e2emember?',
    path: '/wishlists/e2e-birthday',
    open: async (page: Page) => {
      await addMember(page);
      await openManage(page);
      await page.getByRole('button', { name: 'Remove', exact: true }).click();
    },
    confirm: 'Remove',
    pending: 'Removing...',
    method: 'DELETE',
    url: `**/api/wishlists/*/members/${member._id}`,
    success: 'Member removed successfully',
  },
  {
    name: 'Make owner',
    title: 'Make owner?',
    path: '/wishlists/e2e-birthday',
    open: async (page: Page) => {
      await addMember(page);
      await openManage(page);
      await page.getByRole('button', { name: 'Make owner' }).click();
    },
    confirm: 'Send owner invite',
    pending: 'Sending...',
    method: 'POST',
    url: `**/api/wishlists/*/owners/${member.user._id}`,
    success: 'Invitation sent',
  },
  {
    name: 'Leave',
    title: 'Leave “E2E Friend List”?',
    path: '/wishlists/e2e-friend',
    open: async (page: Page) => {
      await page.getByRole('button', { name: 'Leave', exact: true }).click();
    },
    confirm: 'Leave',
    pending: 'Leaving...',
    method: 'DELETE',
    url: '**/api/wishlists/*/members/me',
    success: 'You left “E2E Friend List”',
  },
  {
    name: 'Delete wishlist',
    title: 'Delete “E2E Birthday List”?',
    path: '/wishlists/e2e-birthday',
    open: async (page: Page) => {
      await openManage(page);
      await page.getByRole('button', { name: 'Delete wishlist' }).click();
    },
    confirm: 'Delete',
    pending: 'Deleting...',
    method: 'DELETE',
    url: '**/api/wishlists/*',
    success: 'Wishlist deleted successfully',
  },
]) {
  test(`regression: a double click on ${flow.name}'s confirmation sends one request`, async ({
    page,
  }) => {
    // Every request is held until `answer()`, so both clicks land while the
    // first is in flight. Then they're answered the way the server would: the
    // first succeeds, any later one finds nothing left to do.
    let requests = 0;
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    await page.route(flow.url, async (route) => {
      if (route.request().method() !== flow.method) return route.fallback();
      requests += 1;
      const first = requests === 1;
      await answered;
      if (!first) {
        return route.fulfill({ status: 404, json: { success: false, error: SECOND_ANSWER } });
      }
      await route.fulfill({ json: { success: true } });
    });

    await page.goto(flow.path);
    await flow.open(page);
    const dialog = page.getByRole('alertdialog', { name: flow.title });
    await dialog.getByRole('button', { name: flow.confirm, exact: true }).dblclick();

    // While the request runs, the dialog says so and takes no more clicks. Soft,
    // so the request count below is checked either way.
    await expect.poll(() => requests).toBeGreaterThan(0);
    await expect.soft(dialog.getByRole('button', { name: flow.pending })).toBeDisabled();
    await expect.soft(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    answer();
    await expect(toast(page, flow.success)).toBeVisible();
    expect(requests).toBe(1);
    // Counted the moment the success shows: toasts dismiss themselves after 4s.
    expect(await toast(page, SECOND_ANSWER).count()).toBe(0);
    await expect(dialog).toBeHidden();
  });
}
