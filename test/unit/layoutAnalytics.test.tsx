import { describe, it, expect, vi, afterEach } from 'vitest';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import Analytics from '@/components/Analytics';
import RootLayout from '@/app/layout';

const ID = '8f14e45f-ceea-467a-9575-0c3c1a4b2e6d';

afterEach(() => vi.unstubAllEnvs());

/** Whether the layout's tree renders <Analytics>, and with which id. */
function analyticsIn(node: ReactNode): string | null {
  let found: string | null = null;
  Children.forEach(node, (child) => {
    if (found || !isValidElement(child)) return;
    const el = child as ReactElement<{ children?: ReactNode; websiteId?: string }>;
    if (el.type === Analytics) found = el.props.websiteId ?? null;
    else found = analyticsIn(el.props.children);
  });
  return found;
}

// WIS-329: no script tag at all, so no request to Umami, unless analytics is on.
describe('the root layout', () => {
  const layout = () => RootLayout({ children: <p>page</p> });

  it('renders no analytics outside Production, whatever the id', () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('NEXT_PUBLIC_UMAMI_WEBSITE_ID', ID);
    expect(analyticsIn(layout())).toBeNull();
  });

  it('renders no analytics on Production without an id', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_UMAMI_WEBSITE_ID', undefined);
    expect(analyticsIn(layout())).toBeNull();
  });

  it('renders it on Production with the id', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_UMAMI_WEBSITE_ID', ID);
    expect(analyticsIn(layout())).toBe(ID);
  });
});
