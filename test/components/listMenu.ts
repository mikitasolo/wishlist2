import { screen, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';

type User = ReturnType<typeof userEvent.setup>;

/** The ⋯ menu's trigger in a wishlist's header (`LIST_MENU_LABEL`). */
export const listMenuTrigger = () => screen.queryByRole('button', { name: 'More list actions' });

/** Open the header's ⋯ menu and return its items' labels, then close it again. */
export async function listMenuItems(user: User): Promise<string[]> {
  const trigger = listMenuTrigger();
  if (!trigger) return [];
  await user.click(trigger);
  const menu = await screen.findByRole('menu');
  const labels = within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '');
  await user.keyboard('{Escape}');
  return labels;
}

/** Pick `label` from the header's ⋯ menu, once the page has drawn it. */
export async function pickFromListMenu(user: User, label: string | RegExp) {
  await user.click(await screen.findByRole('button', { name: 'More list actions' }));
  const menu = await screen.findByRole('menu');
  await user.click(within(menu).getByRole('menuitem', { name: label }));
}

/** Leave list…, from the header's ⋯ menu. */
export const pickLeave = (user: User) => pickFromListMenu(user, 'Leave list…');

/** An owner's tab under the list's title: Items, People (with its count) or Settings. */
export const listTab = (name: 'Items' | 'People' | 'Settings') =>
  screen.findByRole('tab', { name: new RegExp(`^${name}`) });

/** Open an owner's tab, once the page has drawn the tabs. */
export async function openListTab(user: User, name: 'Items' | 'People' | 'Settings') {
  await user.click(await listTab(name));
}

/** The ⋯ menu on `username`'s row on People. */
export const rowMenuTrigger = (username: string) =>
  screen.queryByRole('button', { name: `Actions for @${username}` });

/** Open `username`'s row menu on People and return its items' labels, then close it again. */
export async function rowMenuItems(user: User, username: string): Promise<string[]> {
  const trigger = rowMenuTrigger(username);
  if (!trigger) return [];
  await user.click(trigger);
  const menu = await screen.findByRole('menu');
  const labels = within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent ?? '');
  await user.keyboard('{Escape}');
  return labels;
}

/** Pick `label` from `username`'s row menu on People. */
export async function pickRowAction(user: User, username: string, label: string) {
  await user.click(await screen.findByRole('button', { name: `Actions for @${username}` }));
  const menu = await screen.findByRole('menu');
  await user.click(within(menu).getByRole('menuitem', { name: label }));
}

/** The row item `label` in `username`'s menu, which is opened for it (to check it's held). */
export async function rowMenuItem(user: User, username: string, label: string) {
  await user.click(await screen.findByRole('button', { name: `Actions for @${username}` }));
  const menu = await screen.findByRole('menu');
  return within(menu).getByRole('menuitem', { name: label });
}
