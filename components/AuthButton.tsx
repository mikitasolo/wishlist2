'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { signIn, signOut, useSession } from 'next-auth/react';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import Button from '@/components/Button';
import Menu, { type MenuEntry } from '@/components/Menu';
import { useTheme } from '@/components/ThemeProvider';
import { isAuthOnlyPath } from '@/lib/utils/callbackUrl';

export default function AuthButton() {
  const { data: session, status } = useSession();
  const userId = session?.user?.id;
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  // The account whose latest check found pending invitations (null: none did).
  // Another account signing in from another tab leaves `status` 'authenticated',
  // so the dot is tied to the account it was checked for: the previous account's
  // dot is gone in the same render that shows the new account, and a check still
  // on its way for the previous account can't bring it back.
  const [invitesFoundFor, setInvitesFoundFor] = useState<string | null>(null);
  const hasInvites = invitesFoundFor === userId;
  // Checks are numbered as they're sent. One that lands at or below
  // `checksOutdatedUpTo` is dropped: a later check has already landed, or it was
  // sent before signing out.
  const checksSent = useRef(0);
  const checksOutdatedUpTo = useRef(0);

  // Whether there are pending invitations, for the header dot indicator.
  const checkInvites = useCallback(async () => {
    if (!userId) return;
    const check = ++checksSent.current;
    try {
      const res = await fetch('/api/users/me/invites', { cache: 'no-store' });
      const json = await res.json();
      if (!json.success || check <= checksOutdatedUpTo.current) return;
      checksOutdatedUpTo.current = check;
      setInvitesFoundFor((json.data?.length ?? 0) > 0 ? userId : null);
    } catch {
      /* ignore — the dot is best-effort */
    }
  }, [userId]);

  // Check on sign-in, whenever another account signs in, and whenever the tab
  // regains focus (no polling).
  useEffect(() => {
    if (status === 'unauthenticated') {
      // Signed out: hide the dot, and drop every check still on its way, so
      // signing back in shows only what a check sent after it finds.
      checksOutdatedUpTo.current = checksSent.current;
      setInvitesFoundFor(null);
      return;
    }
    // 'loading' is the first session read, or an `update()` (settings, welcome),
    // which keeps the account: the dot keeps what it found, and is checked again
    // once the session is back.
    if (status !== 'authenticated') return;
    checkInvites();
    const refresh = () => checkInvites();
    window.addEventListener('focus', refresh);
    // Fired by pages that change invites (e.g. accept/decline) for an instant update.
    window.addEventListener('invites-changed', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('invites-changed', refresh);
    };
  }, [status, checkInvites]);

  // Also re-check right when the menu is opened.
  useEffect(() => {
    if (open && status === 'authenticated') checkInvites();
  }, [open, status, checkInvites]);

  if (status === 'loading') {
    return <div className="skeleton h-10 w-10 rounded-full" />;
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
      {
        label: 'Invitations',
        icon: 'inbox',
        href: '/invites',
        trailing: hasInvites && (
          <span className="ml-auto h-2 w-2 rounded-full bg-red-500" aria-hidden />
        ),
      },
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
        label={`Account menu${hasInvites ? ' — new invitations' : ''}`}
        menuLabel="Account"
        className="relative min-w-0"
        triggerClassName="flex max-w-full items-center gap-1.5 rounded-full p-1 text-sm font-semibold text-foreground transition-colors hover:bg-muted sm:pr-2"
        menuWidthClassName="w-64"
        onOpenChange={setOpen}
        trigger={(menuOpen) => (
          <>
            <span className="relative inline-flex">
              <Avatar name={displayName} src={image} size="sm" />
              {hasInvites && (
                <span
                  className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-surface"
                  aria-hidden
                />
              )}
            </span>
            <span className="hidden max-w-[10rem] truncate sm:block">{displayName}</span>
            <Icon
              name="chevron-down"
              size={15}
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
