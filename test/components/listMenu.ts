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
