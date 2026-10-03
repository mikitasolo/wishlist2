'use client';

import { ReactNode, useState } from 'react';
import { useSession } from 'next-auth/react';
import Icon from '@/components/Icon';
import BrandLink from '@/components/BrandLink';
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
 *
 * Below `sm` it has to fit a 320px phone, so the brand is just its logo there
 * (the link keeps its accessible name) and `AuthButton` just its avatar, beside
 * the round 40px search, New wishlist and bell buttons. None of those can
 * shrink, so a new action has to fit in what's left at 320px
 * (`e2e/header-mobile.authed.spec.ts`). From `sm` up the account button shrinks
 * instead, truncating the name, when the open search needs the room.
 */
export default function AppHeader({ actions, search = true }: AppHeaderProps) {
  const { data: session } = useSession();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <header className="glass sticky top-0 z-40 border-b border-border">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <BrandLink />
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
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
