'use client';

import { ReactNode, useState } from 'react';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import BrandLink from '@/components/BrandLink';
import GlobalSearch from '@/components/GlobalSearch';
import { HeaderNav, TabBar } from '@/components/AppNav';
import { Skeleton } from '@/components/Skeleton';
import NoSpoilerSwitch from '@/components/NoSpoilerSwitch';
import { useUnreadNotifications } from '@/lib/hooks/useUnreadNotifications';

interface AppHeaderProps {
  /** Right-aligned actions (e.g. AuthButton, wishlist-scoped buttons). */
  actions?: ReactNode;
  /** Whether to show the unified search (default true). */
  search?: boolean;
  /**
   * Just the logo and `actions`: no navigation links, tab bar or search. For a
   * step the user is meant to finish (Welcome), which the app's own ways out
   * would only distract from.
   */
  minimal?: boolean;
}

/**
 * Sticky, frosted-glass application shell header used across all pages, and,
 * for someone signed in, the app's navigation (`components/AppNav.tsx`): the
 * header's Home · Reserved · Activity links from `sm` up, and the phone's tab
 * bar below it, rendered beside the header (outside it: the header's backdrop
 * filter would pin a fixed bar to the header instead of the screen). Activity
 * carries the unread count in both, read here once (`useUnreadNotifications`)
 * and handed to each.
 *
 * Signed in, the row is the logo, the links, the search and the avatar
 * (WIS-302): no bell, since Activity carries the count, and no New list, which
 * Home's greeting and My wishlists offer in place. Below `sm` it has to fit a
 * 320px phone, so the brand is just its logo there (the link keeps its
 * accessible name) and `AuthButton` just its avatar, beside the round 40px
 * search. None of those can shrink, so a new action has to fit in what's left
 * at 320px (`e2e/header-mobile.authed.spec.ts`). No spoiler mode's switch
 * shows its name only from `md` up, where it fits beside the links (WIS-355).
 * From `sm` up the open search needs the room the links and that name take
 * below `lg`, so both step aside while it's open.
 *
 * While the session loads, the row holds the shape it's about to take, so
 * nothing in it moves when the session lands (WIS-209): the signed-in one (the
 * links, the account button and the tab bar) where the session hint says this
 * browser is signed in, and Sign in's otherwise (`lib/utils/sessionHint.ts`).
 * A signed-out visitor sees the header they always did, and no tab bar.
 * Activity's badge comes with the count, after the session: on the tab it sits
 * over the icon, and in the header it widens the last of the links, so neither
 * moves anything else.
 */
export default function AppHeader({ actions, search = true, minimal = false }: AppHeaderProps) {
  const { data: session, status } = useKnownSession();
  const [searchOpen, setSearchOpen] = useState(false);
  // An `update()` puts a known session back through loading: it's still signed in.
  const signedIn = !!session?.user;
  const pending = !signedIn && status === 'loading';
  const username = session?.user?.username ?? null;
  // One reader for both badges, the tab bar's and the header link's.
  const unread = useUnreadNotifications();

  return (
    <>
      <header className="glass sticky top-0 z-40 border-b border-border">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-4 lg:gap-6">
            <BrandLink />
            {minimal ? null : signedIn ? (
              <HeaderNav
                username={username}
                unread={unread}
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
            {signedIn ? (
              <NoSpoilerSwitch compact={searchOpen} />
            ) : pending ? (
              // Its place while the session loads, where it's known to be signed in.
              <Skeleton
                className={`hidden h-10 w-[90px] flex-shrink-0 rounded-full session-hint:block ${
                  searchOpen ? 'lg:w-52' : 'md:w-52'
                }`}
              />
            ) : null}
            {search && !minimal && <GlobalSearch onOpenChange={setSearchOpen} />}
            {actions}
          </div>
        </div>
      </header>
      {minimal ? null : signedIn ? (
        <TabBar username={username} unread={unread} />
      ) : pending ? (
        <TabBar pending />
      ) : null}
    </>
  );
}
