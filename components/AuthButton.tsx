'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { signIn, signOut, useSession } from 'next-auth/react';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import { useTheme } from '@/components/ThemeProvider';

export default function AuthButton() {
  const { data: session, status } = useSession();
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
          aria-label="Account menu"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Avatar name={displayName} src={image} size="sm" />
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
                      theme === t ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
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
      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-700"
    >
      Sign in
    </button>
  );
}
