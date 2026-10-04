'use client';

import { signIn, signOut, useSession } from 'next-auth/react';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import Button from '@/components/Button';
import Menu, { type MenuEntry } from '@/components/Menu';
import { Skeleton } from '@/components/Skeleton';
import { useTheme } from '@/components/ThemeProvider';
import { parseThemeChoice } from '@/lib/utils/theme';
import { isAuthOnlyPath } from '@/lib/utils/callbackUrl';
import { meHref } from '@/lib/utils/appNav';
import { rememberSessionHint } from '@/lib/utils/sessionHint';

/**
 * The account button: its avatar, and the padding and chevron around it from
 * `sm` up. The same for the button and its placeholder, so neither is wider.
 */
const ACCOUNT_TRIGGER_BOX = 'items-center gap-1.5 rounded-full p-1 sm:pr-2';

/**
 * The header's account menu, which is also Me on a wide screen (D3): the
 * avatar opens your profile (the menu's header and first item), Settings, the
 * theme and Sign out. Pages you go to are in the navigation (`AppNav`), not
 * here. It carries no signal of its own: pending invitations live in Activity,
 * and Activity's unread badge is the one thing in the navigation that says
 * something new is waiting.
 */
export default function AuthButton() {
  const { data: session, status } = useSession();
  const { theme, setTheme } = useTheme();
  const user = session?.user;

  // While the session loads, the shape it's about to take (see AppHeader): the
  // account button's where this browser was signed in last time, Sign in's
  // otherwise. An `update()` keeps a known session's menu up.
  if (status === 'loading' && !user) {
    return (
      <span aria-hidden="true" className="contents">
        <span className={`hidden flex-shrink-0 session-hint:flex ${ACCOUNT_TRIGGER_BOX}`}>
          <Skeleton className="h-8 w-8 rounded-full" />
          <span className="hidden h-4 w-4 sm:block" />
        </span>
        <Skeleton
          as="span"
          className="inline-flex h-10 flex-shrink-0 items-center rounded-full px-4 text-sm font-semibold text-transparent session-hint:hidden"
        >
          Sign in
        </Skeleton>
      </span>
    );
  }

  if (user) {
    const email = user.email || 'Account';
    const username = user.username;
    const image = user.image || null;
    const displayName = username || email.split('@')[0];

    const items: MenuEntry[] = [
      ...(username
        ? [{ label: 'Your profile', icon: 'user' as const, href: meHref(username) }]
        : []),
      { label: 'Settings', icon: 'settings', href: '/settings' },
      {
        type: 'radio-group',
        label: 'Theme',
        value: theme,
        options: [
          { value: 'light', label: 'Light', icon: 'sun' },
          { value: 'dark', label: 'Dark', icon: 'moon' },
          { value: 'system', label: 'System', icon: 'monitor' },
        ],
        onChange: (t) => setTheme(parseThemeChoice(t)),
      },
      {
        label: 'Sign out',
        icon: 'logout',
        separated: true,
        onSelect: () => {
          // Forgotten first: signOut reloads the page before the session
          // reads as signed out here, so the next load would otherwise hold
          // the signed-in header's shape and then jump (WIS-209).
          rememberSessionHint(false);
          // A page that needs an account would only send them on to the
          // sign-in form once it reloads signed out, so sign out to home
          // from there. Anywhere else, stay on the page, now signed out.
          signOut(isAuthOnlyPath(window.location.pathname) ? { redirectTo: '/' } : undefined);
        },
      },
    ];

    // Below `sm` the trigger is just the avatar, a 40px circle the size of the
    // header's other buttons, so the header fits a 320px phone; from `sm` up
    // a chevron follows it. It's the avatar alone, with no name beside it, so
    // it's one width whoever is signed in, and its placeholder can hold that
    // width while the session loads (WIS-209). The label names it either way.
    // The menu's header is the account's own: only its owner sees the email.
    return (
      <Menu
        label="Account menu"
        menuLabel="Account"
        className="relative flex-shrink-0"
        triggerClassName={`flex text-sm font-semibold text-foreground transition-colors hover:bg-muted ${ACCOUNT_TRIGGER_BOX}`}
        menuWidthClassName="w-64"
        trigger={(menuOpen) => (
          <>
            <Avatar name={displayName} src={image} size="sm" />
            <Icon
              name="chevron-down"
              size={16}
              className={`hidden text-muted-foreground transition-transform sm:block ${menuOpen ? 'rotate-180' : ''}`}
            />
          </>
        )}
        header={
          <div className="flex items-center gap-3">
            <Avatar name={displayName} src={image} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {username ? `@${username}` : displayName}
              </p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
            </div>
          </div>
        }
        items={items}
      />
    );
  }

  return (
    <Button size="md" shape="pill" onClick={() => signIn()}>
      Sign in
    </Button>
  );
}
