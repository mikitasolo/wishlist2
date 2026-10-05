import type { Metadata } from 'next';
import Link from 'next/link';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import EmptyState from '@/components/EmptyState';
import UnsubscribeConfirm from '@/components/UnsubscribeConfirm';
import { buttonClassName } from '@/components/buttonStyles';
import { NOTIFICATION_EVENTS } from '@/lib/utils/notificationPrefs';
import { unsubscribeQuery, verifyUnsubscribe } from '@/lib/utils/unsubscribe';

export const metadata: Metadata = {
  title: 'Unsubscribe',
  // A signed link: keep it out of search results and away from other sites.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

interface UnsubscribeProps {
  searchParams: Promise<{ u?: string | string[]; e?: string | string[]; t?: string | string[] }>;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Where a notification email's "Unsubscribe" link lands (WIS-321), signed in or
 * not. A valid link shows which emails it stops and one button; the page load
 * itself changes nothing. It never names or hints at the account: an invalid
 * link and one for a deleted account read like any other.
 */
export default async function Unsubscribe({ searchParams }: UnsubscribeProps) {
  const query = await searchParams;
  const target = verifyUnsubscribe({ u: first(query.u), e: first(query.e), t: first(query.t) });

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {target ? (
          <UnsubscribeConfirm
            query={unsubscribeQuery(target)}
            label={NOTIFICATION_EVENTS[target.event].label}
          />
        ) : (
          <EmptyState
            framed={false}
            icon="link-off"
            level={1}
            title="This unsubscribe link doesn’t work"
            body="It may be incomplete or out of date. You can choose which emails you get in Settings."
            actions={
              <Link href="/settings#notifications" className={buttonClassName()}>
                Notification settings
              </Link>
            }
          />
        )}
      </main>
    </div>
  );
}
