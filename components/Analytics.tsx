'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import {
  UMAMI_BEFORE_SEND,
  UMAMI_HOST_URL,
  UMAMI_SCRIPT_URL,
  installBeforeSend,
  trackPageView,
} from '@/lib/analytics';

// The scrub every send goes through, in place before the script can send
// anything (a no-op on the server).
installBeforeSend();

/**
 * Umami's tracker, with its own page views and click tracking off, and a page
 * view sent from here for each route, as its pattern (`lib/analytics.ts`).
 * Rendered by the root layout only when analytics is on (`getUmamiWebsiteId`):
 * otherwise there's no script tag and nothing is sent.
 */
export default function Analytics({ websiteId }: { websiteId: string }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready && pathname) trackPageView(pathname);
  }, [ready, pathname]);

  return (
    <Script
      src={UMAMI_SCRIPT_URL}
      strategy="afterInteractive"
      data-website-id={websiteId}
      data-host-url={UMAMI_HOST_URL}
      data-auto-track="false"
      data-exclude-search="true"
      data-exclude-hash="true"
      data-do-not-track="true"
      data-before-send={UMAMI_BEFORE_SEND}
      referrerPolicy="no-referrer"
      onReady={() => setReady(true)}
    />
  );
}
