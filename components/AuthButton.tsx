'use client';

import { signIn, signOut, useSession } from 'next-auth/react';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import Button from '@/components/Button';
import Menu, { type MenuEntry } from '@/components/Menu';
import { Skeleton } from '@/components/Skeleton';
import { useTheme } from '@/components/ThemeProvider';
import { isAuthOnlyPath } from '@/lib/utils/callbackUrl';

/**
 * The header's account menu. It carries no signal of its own: pending
 * invitations live in Activity, and the bell's unread count is the one thing
 * in the header that says something new is waiting (D3).
 */
export default function AuthButton() {
  const { data: session, status } = useSession();
  const { theme, setTheme } = useTheme();

  if (status === 'loading') {
    return <Skeleton className="h-10 w-10 rounded-full" />;
  }

  if (session?.user) {
    const email = session.user.email || 'Account';
    const username = (session.user as { username?: string }).username;
    const image = session.user.image || null;
    const displayName = username || email.split('@')[0];

    const items: MenuEntry[] = [
      ...(username
        ? [{ label: 'Your profile', icon: 'user' as const, href: `/users/${username}` }]
        : []),
      { label: 'Reserved by you', icon: 'check-circle', href: '/booked' },
      { label: 'Settings', icon: 'settings', href: '/settings' },
      {
        type: 'radio-group',
        label: 'Theme',
        value: theme,
        options: [
          { value: 'light', label: 'Light', icon: 'sun' },
          { value: 'dark', label: 'Dark', icon: 'moon' },
        ],
        onChange: (t) => setTheme(t === 'dark' ? 'dark' : 'light'),
      },
      {
        label: 'Sign out',
        icon: 'logout',
        separated: true,
        onSelect: () =>
          // A page that needs an account would only send them on to the
          // sign-in form once it reloads signed out, so sign out to home
          // from there. Anywhere else, stay on the page, now signed out.
          signOut(isAuthOnlyPath(window.location.pathname) ? { redirectTo: '/' } : undefined),
      },
    ];

    // Below `sm` the trigger is just the avatar, a 40px circle the size of the
    // header's other buttons, so the header fits a 320px phone. From `sm` up
    // it can shrink, truncating the name (see AppHeader). The label names it
    // either way. The header is the account's own: only its owner sees the
    // email in it.
    return (
      <Menu
        label="Account menu"
        menuLabel="Account"
        className="relative min-w-0"
        triggerClassName="flex max-w-full items-center gap-1.5 rounded-full p-1 text-sm font-semibold text-foreground transition-colors hover:bg-muted sm:pr-2"
        menuWidthClassName="w-64"
        trigger={(menuOpen) => (
          <>
            <Avatar name={displayName} src={image} size="sm" />
            <span className="hidden max-w-[10rem] truncate sm:block">{displayName}</span>
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
