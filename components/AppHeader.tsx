'use client';

import Link from 'next/link';
import { ReactNode, useState } from 'react';
import { useSession } from 'next-auth/react';
import Icon from '@/components/Icon';
import Logo from '@/components/Logo';
import GlobalSearch from '@/components/GlobalSearch';
import CreateWishlistModal from '@/components/CreateWishlistModal';
import NotificationBell from '@/components/NotificationBell';

interface AppHeaderProps {
  /** Right-aligned actions (e.g. AuthButton, wishlist-scoped buttons). */
  actions?: ReactNode;
  /** Whether to show the unified search (default true). */
  search?: boolean;
}

/**
 * Sticky, frosted-glass application shell header used across all pages.
 */
export default function AppHeader({ actions, search = true }: AppHeaderProps) {
  const { data: session } = useSession();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <header className="glass sticky top-0 z-40 border-b border-border">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="group flex items-center gap-2.5 transition-opacity hover:opacity-90"
          aria-label="Wishlist home"
        >
          <Logo className="h-8 w-8 rounded-[9px] shadow-[0_4px_12px_-3px_rgba(94,92,230,0.6)] transition-transform group-hover:scale-105" />
          <span className="text-[17px] font-semibold tracking-tight text-foreground">Wishlist</span>
        </Link>
        <div className="flex items-center gap-2 sm:gap-3">
          {search && <GlobalSearch />}
          {session?.user && (
            <button
              onClick={() => setShowCreate(true)}
              aria-label="New wishlist"
              title="New wishlist"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground shadow-xs transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <Icon name="plus" size={18} />
            </button>
          )}
          <NotificationBell />
          {actions}
        </div>
      </div>
      {session?.user && (
        <CreateWishlistModal isOpen={showCreate} onClose={() => setShowCreate(false)} />
      )}
    </header>
  );
}
