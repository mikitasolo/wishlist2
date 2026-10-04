// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// NEXTAUTH_URL's origin, which `getEnvVars` won't give a browser (jsdom has a `window`).
vi.mock('@/lib/env', () => ({ getEnvVars: () => ({ NEXTAUTH_URL: 'http://localhost:3000' }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import AuthErrorPage from '@/app/auth/error/page';

async function renderPage(query: Record<string, string>) {
  render(await AuthErrorPage({ searchParams: Promise.resolve(query) }));
}

const tryAgain = () => screen.getByRole('link', { name: 'Try again' });

beforeEach(() => cleanup());

describe('the auth error page', () => {
  it('says an expired or used link has expired', async () => {
    await renderPage({ error: 'Verification' });
    expect(
      screen.getByRole('heading', { name: 'That sign-in link has expired' })
    ).toBeInTheDocument();
  });

  it('keeps the generic title for other errors', async () => {
    await renderPage({ error: 'Configuration' });
    expect(screen.getByRole('heading', { name: 'Authentication error' })).toBeInTheDocument();
    cleanup();
    await renderPage({});
    expect(screen.getByRole('heading', { name: 'Authentication error' })).toBeInTheDocument();
  });

  // regression: Try again went to /auth/signin without the callbackUrl, so
  // someone whose old link came from a shared list ended up on the dashboard.
  it('keeps a callbackUrl on this site for Try again', async () => {
    await renderPage({
      error: 'Verification',
      callbackUrl: 'http://localhost:3000/wishlists/abc?show=available',
    });
    expect(tryAgain()).toHaveAttribute(
      'href',
      '/auth/signin?callbackUrl=%2Fwishlists%2Fabc%3Fshow%3Davailable'
    );
  });

  // regression: and it must not become an open redirect.
  it.each(['https://evil.example/phish', '//evil.example/x', '/auth/signin'])(
    'drops an unsafe callbackUrl (%s)',
    async (callbackUrl) => {
      await renderPage({ error: 'Verification', callbackUrl });
      expect(tryAgain()).toHaveAttribute('href', '/auth/signin');
    }
  );

  it('goes to plain sign-in without a callbackUrl', async () => {
    await renderPage({ error: 'Verification' });
    expect(tryAgain()).toHaveAttribute('href', '/auth/signin');
  });
});
