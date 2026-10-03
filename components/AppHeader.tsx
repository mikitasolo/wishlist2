'use client';

import { ReactNode, useState } from 'react';
import { useSession } from 'next-auth/react';
import BrandLink from '@/components/BrandLink';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import GlobalSearch from '@/components/GlobalSearch';
import CreateWishlistModal from '@/components/CreateWishlistModal';
import NotificationBell from '@/components/NotificationBell';
import { HeaderNav, TabBar } from '@/components/AppNav';
import { Skeleton } from '@/components/Skeleton';

interface AppHeaderProps {
  /** Right-aligned actions (e.g. AuthButton, wishlist-scoped buttons). */
  actions?: ReactNode;
  /** Whether to show the unified search (default true). */
  search?: boolean;
}

/**
 * New list's size and shape at every width, for the button and its
 * placeholder alike: a labelled `sm` pill from `md` up, a round 40px icon
 * button at `sm` (like the search and the bell beside it), and not in the
 * header at all on a phone, where New list lives on Home (WIS-242, WIS-251).
 */
const NEW_LIST_WIDTHS = 'max-sm:hidden max-md:h-10 max-md:w-10 max-md:px-0';

function NewListContent() {
  return (
    <>
      <Icon name="plus" size={18} className="md:hidden" />
      <Icon name="plus" size={16} className="max-md:hidden" />
      <span className="max-md:sr-only">New list</span>
    </>
  );
}

/**
 * Sticky, frosted-glass application shell header used across all pages, and,
 * for someone signed in, the app's navigation (`components/AppNav.tsx`): the
 * header's Home · Reserved · Activity links from `sm` up, and the phone's tab
 * bar below it, rendered beside the header (outside it: the header's backdrop
 * filter would pin a fixed bar to the header instead of the screen).
 *
 * Below `sm` it has to fit a 320px phone, so the brand is just its logo there
 * (the link keeps its accessible name) and `AuthButton` just its avatar, beside
 * the round 40px search and bell. None of those can shrink, so a new action
 * has to fit in what's left at 320px (`e2e/header-mobile.authed.spec.ts`).
 * From `sm` up the open search needs the room the links take below `lg`, so
 * they step aside while it's open.
 *
 * While the session loads, the row holds the shape it's about to take, so
 * nothing in it moves when the session lands (WIS-209): the signed-in one
 * (New list, the bell, the account button, the links and the tab bar) where
 * the session hint says this browser is signed in, and Sign in's otherwise
 * (`lib/utils/sessionHint.ts`). A signed-out visitor sees the header they
 * always did, and no tab bar.
 */
export default function AppHeader({ actions, search = true }: AppHeaderProps) {
  const { data: session, status } = useSession();
  const [showCreate, setShowCreate] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // An `update()` puts a known session back through loading: it's still signed in.
  const signedIn = !!session?.user;
  const pending = !signedIn && status === 'loading';
  const username = session?.user?.username ?? null;

  return (
    <>
      <header className="glass sticky top-0 z-40 border-b border-border">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-4 lg:gap-6">
            <BrandLink />
            {signedIn ? (
              <HeaderNav
                username={username}
                className={`flex max-sm:hidden ${searchOpen ? 'max-lg:hidden' : ''}`}
              />
            ) : pending ? (
              <HeaderNav
                pending
                className={`hidden ${searchOpen ? 'lg:session-hint:flex' : 'sm:session-hint:flex'}`}
              />
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {search && <GlobalSearch onOpenChange={setSearchOpen} />}
            {signedIn ? (
              // "New list", so it can't be read as adding to the list on
              // screen. One button at every width (its label is only visually
              // hidden below md), so its name is "New list" either way.
              <Button
                variant="secondary"
                size="sm"
                shape="pill"
                title="New list"
                onClick={() => setShowCreate(true)}
                className={`${NEW_LIST_WIDTHS} max-md:border-border max-md:text-muted-foreground max-md:hover:text-foreground`}
              >
                <NewListContent />
              </Button>
            ) : pending ? (
              <span aria-hidden="true" className="contents">
                <Skeleton
                  as="span"
                  className={`hidden flex-shrink-0 items-center justify-center gap-1.5 rounded-full border border-transparent px-3.5 text-sm font-semibold text-transparent sm:session-hint:inline-flex h-9 ${NEW_LIST_WIDTHS}`}
                >
                  <NewListContent />
                </Skeleton>
              </span>
            ) : null}
            <NotificationBell />
            {actions}
          </div>
        </div>
        {signedIn && (
          <CreateWishlistModal isOpen={showCreate} onClose={() => setShowCreate(false)} />
        )}
      </header>
      {signedIn ? <TabBar username={username} /> : pending ? <TabBar pending /> : null}
    </>
  );
}
