import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// The top of the dashboard (WIS-252, D4): the greeting with New list, Needs
// you, Coming up, and Pin to top on your own lists. The seeded user has no
// invitation, occasion or changed reservation, so those are added to the
// page's reads in the browser: nothing of them reaches the seeded database.
// Pin to top is the real round trip, and is undone before the spec ends.

// USD's own time zone: no currency prompt in Needs you.
test.use({ timezoneId: 'America/New_York' });

const pad = (n: number) => String(n).padStart(2, '0');
/** A yearly occasion on the browser's today, stored on the placeholder year. */
async function todayYearly(page: Page) {
  const today = await page.evaluate(() => {
    const d = new Date();
    return { m: d.getMonth() + 1, d: d.getDate() };
  });
  return `2000-${pad(today.m)}-${pad(today.d)}`;
}

async function withNeedsYou(page: Page) {
  await page.route(/\/api\/users\/me\/invites$/, (route) =>
    route.fulfill({
      json: {
        success: true,
        data: [
          {
            _id: '0000000000000000000e0252',
            role: 'owner',
            wishlistId: '0000000000000000000e0253',
            wishlistName: 'E2E Family Christmas',
            wishlistSlug: 'e2e-family-christmas',
            invitedByUsername: 'e2efriend',
            invitedByImage: null,
            preview: null,
            yourReservations: 1,
          },
        ],
      },
    })
  );
  await page.route(/\/api\/users\/me\/reservations\/summary$/, (route) =>
    route.fulfill({ json: { success: true, data: { changed: 2 } } })
  );
}

async function withOccasionToday(page: Page) {
  const date = await todayYearly(page);
  await page.route(/\/api\/wishlists$/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (!body.success) return route.fulfill({ response, json: body });
    const member = body.data.member.map((w: { slug: string }) =>
      w.slug === 'e2e-friend'
        ? { ...w, occasion: { kind: 'birthday', date, recurrence: 'yearly' } }
        : w
    );
    return route.fulfill({ response, json: { ...body, data: { ...body.data, member } } });
  });
}

test('the dashboard opens on the greeting, what needs you and what is coming up', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  // Before anything is added: the real summary is read, and the seeded user has
  // nothing that needs them, so there's no Needs you at all.
  const summary = await page.request.get('/api/users/me/reservations/summary');
  expect(await summary.json()).toEqual({ success: true, data: { changed: 0 } });
  await expect(page.getByRole('heading', { level: 2, name: 'Your wishlists' })).toBeVisible();
  await expect(page.locator('main .skeleton')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Needs you' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Coming up' })).toHaveCount(0);
  // No stat tiles, no Featured, no follower counts.
  await expect(page.getByRole('link', { name: /^Reserved by you/ })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Featured wishlist' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /followers?$/ })).toHaveCount(0);

  await withNeedsYou(page);
  await withOccasionToday(page);
  await page.reload();

  const greeting = page.getByRole('heading', { level: 1 });
  await expect(greeting).toHaveText(/^Good (morning|afternoon|evening), e2euser$/);
  await expect(page.locator('main header').getByRole('button', { name: 'New list' })).toBeVisible();

  const needsYou = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Needs you' }) });
  await expect(needsYou.getByRole('listitem')).toHaveCount(2);
  const invite = needsYou.getByRole('listitem').first();
  await expect(invite).toContainText('E2E Family Christmas');
  await expect(invite).toContainText('Co-owner');
  await expect(invite).toContainText(
    'You’ve reserved 1 gift here. Co-owners can’t see reservations, so accepting releases it.'
  );
  await expect(invite.getByRole('button', { name: 'Accept' })).toBeVisible();
  await expect(invite.getByRole('button', { name: 'Decline' })).toBeVisible();
  await expect(needsYou.getByText('2 reservations changed')).toBeVisible();
  await expect(needsYou.getByRole('link', { name: 'See all in Activity' })).toHaveAttribute(
    'href',
    '/notifications'
  );

  const comingUp = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Coming up' }) });
  await expect(comingUp.getByRole('listitem')).toHaveCount(1);
  await expect(comingUp).toContainText(/Today · /);
  await expect(comingUp).toContainText('Birthday · @e2efriend');
  // On a phone the row scrolls sideways inside itself: the page never does.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(comingUp.getByRole('listitem')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
  ).toBe(0);

  await comingUp.getByRole('link', { name: 'Find a gift on E2E Friend List' }).click();
  await expect(page).toHaveURL('/wishlists/e2e-friend?show=available');
});

test('Pin to top pins your list, and Unpin takes it off again', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const own = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Your wishlists' }) });
  const card = own.locator('div.relative').filter({
    has: page.getByRole('heading', { level: 3, name: 'E2E Birthday List' }),
  });

  try {
    await card.getByRole('button', { name: 'Pin to top', pressed: false }).click();
    await expect(card.getByRole('button', { name: 'Pin to top', pressed: true })).toBeVisible();
    // The pressed pin is the one sign it's pinned (WIS-302): no Pinned badge.
    await expect(card.getByText('Pinned')).toHaveCount(0);

    // It's the server's: a fresh read still has it pinned.
    await page.reload();
    await expect(card.getByRole('button', { name: 'Pin to top', pressed: true })).toBeVisible();

    await card.getByRole('button', { name: 'Pin to top', pressed: true }).click();
    await expect(card.getByRole('button', { name: 'Pin to top', pressed: false })).toBeVisible();
  } finally {
    // The seeded list is every spec's: never leave it pinned, whatever failed.
    const lists = await (await page.request.get('/api/wishlists')).json();
    const seeded = lists.data.owned.find((w: { slug: string }) => w.slug === 'e2e-birthday');
    await page.request.patch(`/api/wishlists/${seeded._id}`, { data: { featured: false } });
  }

  // And on a phone, the row's pin.
  await page.setViewportSize({ width: 390, height: 844 });
  const row = own.getByRole('listitem').filter({ hasText: 'E2E Birthday List' });
  await expect(row.getByRole('button', { name: 'Pin to top', pressed: false })).toBeVisible();
});
