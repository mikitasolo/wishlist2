'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { signIn, signOut, useSession } from 'next-auth/react';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import { useTheme } from '@/components/ThemeProvider';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Close on outside click + Escape; move focus into menu when opened.
  useEffect(() => {
    if (!open) return;

    const handlePointer = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);

    // Focus first actionable item for keyboard users.
    const firstButton = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    firstButton?.focus();

    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (status === 'loading') {
    return <div className="skeleton h-10 w-10 rounded-full" />;
  }

  if (session?.user) {
    const email = session.user.email || 'Account';
    const username = (session.user as { username?: string }).username;
    const image = session.user.image || null;
    const displayName = username || email.split('@')[0];
    return (
      <div className="relative" ref={containerRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          aria-label={`Account menu${hasInvites ? ' — new invitations' : ''}`}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <span className="relative inline-flex">
            <Avatar name={displayName} src={image} size="sm" />
            {hasInvites && (
              <span
                className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-surface"
                aria-hidden
              />
            )}
          </span>
          <span className="max-w-[10rem] truncate">{displayName}</span>
          <Icon
            name="chevron-down"
            size={15}
            className={`text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && (
          <div
            ref={menuRef}
            role="menu"
            aria-label="Account"
            className="animate-fade-in absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-surface py-1.5 shadow-lg"
          >
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Avatar name={displayName} src={image} size="md" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {username ? `@${username}` : displayName}
                </p>
                <p className="truncate text-xs text-muted-foreground">{email}</p>
              </div>
            </div>
            {username && (
              <Link
                role="menuitem"
                href={`/users/${username}`}
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Icon name="user" size={18} className="text-muted-foreground" />
                Your profile
              </Link>
            )}
            <Link
              role="menuitem"
              href="/booked"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Icon name="check-circle" size={18} className="text-muted-foreground" />
              Reserved by you
            </Link>
            <Link
              role="menuitem"
              href="/invites"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Icon name="inbox" size={18} className="text-muted-foreground" />
              Invitations
              {hasInvites && (
                <span className="ml-auto h-2 w-2 rounded-full bg-red-500" aria-hidden />
              )}
            </Link>
            <Link
              role="menuitem"
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Icon name="settings" size={18} className="text-muted-foreground" />
              Settings
            </Link>

            {/* Theme slider */}
            <div className="px-4 py-2.5">
              <div className="relative flex rounded-xl border border-border bg-surface-2 p-1">
                <span
                  aria-hidden
                  className="absolute bottom-1 top-1 rounded-lg bg-surface shadow-sm transition-[left] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
                  style={{
                    width: 'calc((100% - 0.5rem) / 2)',
                    left: `calc(${theme === 'light' ? 0 : 1} * ((100% - 0.5rem) / 2) + 0.25rem)`,
                  }}
                />
                {(['light', 'dark'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="menuitemradio"
                    aria-checked={theme === t}
                    onClick={() => setTheme(t)}
                    className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-sm font-semibold transition-colors ${
                      theme === t
                        ? 'text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon name={t === 'light' ? 'sun' : 'moon'} size={15} />
                    {t === 'light' ? 'Light' : 'Dark'}
                  </button>
                ))}
              </div>
            </div>

            <div className="my-1 border-t border-border" />
            <button
              role="menuitem"
              onClick={() => signOut()}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Icon name="logout" size={18} className="text-muted-foreground" />
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => signIn()}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-primary-600 px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-700"
    >
      Sign in
    </button>
  );
}
