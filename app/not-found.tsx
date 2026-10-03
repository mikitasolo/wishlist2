import Link from 'next/link';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import GlobalSearch from '@/components/GlobalSearch';
import StatePanel from '@/components/StatePanel';
import { buttonClassName } from '@/components/buttonStyles';

/**
 * The 404 for a URL no route matches (and for any `notFound()`), inside the
 * root layout, so it has the app's header and theme. A list or profile that
 * can't be opened isn't this page: those routes exist, and say so in place
 * (`WishlistUnavailable`, the profile page's "No one goes by @name").
 */
export default function NotFound() {
  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <StatePanel
          icon="link-off"
          level={1}
          title="This page doesn’t exist"
          body="The link may be broken, or the page may have moved. Search for a person or a wishlist, or go home."
          actions={
            <Link href="/" className={buttonClassName()}>
              Go home
            </Link>
          }
        >
          <GlobalSearch variant="inline" />
        </StatePanel>
      </main>
    </div>
  );
}
