'use client';

import Link from 'next/link';
import BrandLink from '@/components/BrandLink';
import Button from '@/components/Button';
import StatePanel from '@/components/StatePanel';
import { buttonClassName } from '@/components/buttonStyles';

/**
 * What a page shows when rendering it throws, inside the root layout (so in the
 * app's theme). Its header is only the brand, not `AppHeader`: what threw may
 * be in the header's own parts (search, notifications), and this page mustn't
 * throw the same way. Try again re-renders the page, reading its data afresh.
 */
export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="min-h-screen">
      <header className="glass sticky top-0 z-40 border-b border-border">
        <div className="mx-auto flex h-14 max-w-7xl items-center px-4 sm:px-6 lg:px-8">
          <BrandLink />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <StatePanel
          icon="alert"
          tone="error"
          level={1}
          title="Something went wrong"
          body="This page couldn’t be shown. Try again, or go home."
          actions={
            <>
              <Button onClick={() => retry()}>Try again</Button>
              <Link href="/" className={buttonClassName({ variant: 'secondary' })}>
                Go home
              </Link>
            </>
          }
        />
      </main>
    </div>
  );
}
