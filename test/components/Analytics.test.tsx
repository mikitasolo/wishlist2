// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

const { nav, scriptProps } = vi.hoisted(() => ({
  nav: { pathname: '/l/AbCdEfGhIjKlMnOpQrStUv' },
  scriptProps: { current: null as null | Record<string, unknown> },
}));

vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
// next/script's loading is Next's; here, only what the tag says and its onReady.
vi.mock('next/script', () => ({
  default: (props: Record<string, unknown>) => {
    scriptProps.current = props;
    return null;
  },
}));
vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  trackPageView: vi.fn(() => true),
}));

import Analytics from '@/components/Analytics';
import {
  UMAMI_BEFORE_SEND,
  UMAMI_HOST_URL,
  UMAMI_SCRIPT_URL,
  trackPageView,
} from '@/lib/analytics';

const ID = '8f14e45f-ceea-467a-9575-0c3c1a4b2e6d';

beforeEach(() => {
  nav.pathname = '/l/AbCdEfGhIjKlMnOpQrStUv';
  scriptProps.current = null;
  vi.mocked(trackPageView).mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('Analytics', () => {
  it('loads Umami with its own tracking off and every send scrubbed', () => {
    render(<Analytics websiteId={ID} />);
    expect(scriptProps.current).toMatchObject({
      src: UMAMI_SCRIPT_URL,
      'data-website-id': ID,
      'data-host-url': UMAMI_HOST_URL,
      'data-auto-track': 'false',
      'data-exclude-search': 'true',
      'data-exclude-hash': 'true',
      'data-do-not-track': 'true',
      'data-before-send': UMAMI_BEFORE_SEND,
      referrerPolicy: 'no-referrer',
    });
    // The hook it names is in place before the script can load.
    expect(typeof window[UMAMI_BEFORE_SEND]).toBe('function');
  });

  it('sends a page view once the script is ready, then one per route', () => {
    const { rerender } = render(<Analytics websiteId={ID} />);
    expect(trackPageView).not.toHaveBeenCalled();

    act(() => (scriptProps.current!.onReady as () => void)());
    expect(trackPageView).toHaveBeenCalledTimes(1);
    expect(trackPageView).toHaveBeenLastCalledWith('/l/AbCdEfGhIjKlMnOpQrStUv');

    // A re-render on the same route sends nothing more.
    rerender(<Analytics websiteId={ID} />);
    expect(trackPageView).toHaveBeenCalledTimes(1);

    nav.pathname = '/wishlists/mine';
    rerender(<Analytics websiteId={ID} />);
    expect(trackPageView).toHaveBeenCalledTimes(2);
    expect(trackPageView).toHaveBeenLastCalledWith('/wishlists/mine');
  });
});
