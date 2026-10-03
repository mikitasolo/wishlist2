'use client';

import { ReactNode, useState } from 'react';
import { useSession } from 'next-auth/react';
import BrandLink from '@/components/BrandLink';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
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
 * the round 40px search, New list and bell buttons. None of those can
 * shrink, so a new action has to fit in what's left at 320px
 * (`e2e/header-mobile.authed.spec.ts`). From `sm` up the account button shrinks
 * instead, truncating the name, when the open search needs the room; from `md`
 * up New list is a labelled pill.
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
            // New list, so it can't be read as adding to the list on screen:
            // a labelled `sm` pill from md up, and below that just its icon,
            // in a round 40px button like the search and the bell beside it
            // (at sm, the open search needs the room: header-mobile spec). One
            // button either way (its label is only visually hidden), so its
            // name is "New list" at every width.
            <Button
              variant="secondary"
              size="sm"
              shape="pill"
              title="New list"
              onClick={() => setShowCreate(true)}
              className="max-md:h-10 max-md:w-10 max-md:border-border max-md:px-0 max-md:text-muted-foreground max-md:hover:text-foreground"
            >
              <Icon name="plus" size={18} className="md:hidden" />
              <Icon name="plus" size={16} className="max-md:hidden" />
              <span className="max-md:sr-only">New list</span>
            </Button>
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
